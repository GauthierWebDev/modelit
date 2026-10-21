import {
  aloneOnLine,
  atLineStart,
  atStatementStart,
  blockCommentEnd,
  inRoutine,
  isWordPart,
  isWordStart,
  lineOf,
  readQuotedIdentifier,
  readString,
  sqlPlusLine,
} from "./lexemes";
import type { Token, TokenizeOptions, TokenType } from "./tokenize";

/**
 * État du découpage lexical (tokenize) : position, séparateur courant (DELIMITER), profondeur
 * BEGIN / CASE … END dans un corps de routine. Chaque lecteur reconnaît une forme à la position
 * courante, la consomme et répond `true` ; ils sont essayés dans un ordre fixe (step).
 */
export class Lexer {
  readonly tokens: Token[] = [];
  i = 0;
  private readonly sql: string;
  private readonly dialect: TokenizeOptions["dialect"];
  private readonly warnings: string[] | undefined;
  /** Commentaires /* *\/ imbriqués (SQL Server, PostgreSQL). */
  private readonly nested: boolean;
  /** Commandes SQL*Plus (Oracle, ou dialecte inconnu). */
  private readonly sqlPlus: boolean;
  private delimiter = ";";
  private start = 0;
  // Corps de routine (CREATE TRIGGER / PROCEDURE / FUNCTION … BEGIN … END) : les « ; » internes ne
  // terminent pas l'instruction (Oracle, SQLite, SQL Server) (O-39). Profondeur BEGIN / CASE … END.
  private statementStart = 0;
  private depth = 0;

  constructor(sql: string, options: TokenizeOptions) {
    this.sql = sql;
    this.dialect = options.dialect;
    this.warnings = options.warnings;
    this.nested = options.dialect === "sqlserver" || options.dialect === "postgresql";
    this.sqlPlus = options.dialect === "oracle" || options.dialect === undefined;
  }

  get done() {
    return this.i >= this.sql.length;
  }

  /** Un lexème (ou un blanc, un commentaire) à la position courante. */
  step() {
    const c = this.sql[this.i]!;
    const rest = this.sql.slice(this.i);
    this.start = this.i;
    const read =
      this.space(c) ||
      this.comment(c, rest) ||
      this.sqlPlusCommand(rest) ||
      this.separator(c, rest) ||
      this.dollarString(rest) ||
      this.alternativeString(rest) ||
      this.string(c, rest) ||
      this.quotedIdentifier(c) ||
      this.number(rest) ||
      this.arrayOperator(rest) ||
      this.word(c);
    if (!read) {
      this.punctuation(c, rest);
    }
  }

  private push(type: TokenType, value: string, raw: string) {
    if (type === "end") {
      this.statementStart = this.tokens.length + 1;
      this.depth = 0;
    }
    this.tokens.push({ type, value, raw, pos: this.start });
  }

  /** Jusqu'à la fin de la ligne (incluse). */
  private skipLine() {
    const end = this.sql.indexOf("\n", this.i);
    this.i = end === -1 ? this.sql.length : end + 1;
  }

  // Espaces
  private space(c: string) {
    if (!/\s/.test(c)) {
      return false;
    }
    this.i += 1;
    return true;
  }

  private comment(c: string, rest: string) {
    // Commentaires
    if (rest.startsWith("--")) {
      this.skipLine();
      return true;
    }
    // Commentaire MySQL « # … » (un # suivi d'un mot est un identifiant : table temporaire SQL Server)
    if (c === "#" && (this.i + 1 >= this.sql.length || /\s/.test(this.sql[this.i + 1]!))) {
      this.skipLine();
      return true;
    }
    if (rest.startsWith("/*")) {
      this.i = blockCommentEnd(this.sql, this.i, this.nested);
      return true;
    }
    // */ hors commentaire : commentaire mal imbriqué pour ce dialecte (O-41).
    if (rest.startsWith("*/")) {
      this.warnings?.push(`ligne ${lineOf(this.sql, this.i)}`);
      this.i += 2;
      return true;
    }
    return false;
  }

  /**
   * Commandes SQL*Plus / SQLcl (SET, PROMPT, REM…) : en début d'instruction, terminées par la fin
   * de ligne et non par « ; » — sans quoi elles avaleraient l'instruction suivante (O-39).
   */
  private sqlPlusCommand(rest: string) {
    if (!(this.sqlPlus && atStatementStart(this.tokens) && atLineStart(this.sql, this.i))) {
      return false;
    }
    const line = sqlPlusLine(rest, this.dialect);
    if (line === undefined) {
      return false;
    }
    this.push("end", ";", line);
    this.i += line.length;
    return true;
  }

  /** Fins d'instruction : DELIMITER, séparateur personnalisé, « ; », GO et / seuls sur leur ligne. */
  private separator(c: string, rest: string) {
    // DELIMITER (client MySQL) : change le séparateur jusqu'au prochain DELIMITER
    if (/^delimiter\s+\S+/i.test(rest) && aloneOnLine(this.sql, this.i, /^delimiter\s+\S+/i.exec(rest)![0].length)) {
      const match = /^delimiter\s+(\S+)/i.exec(rest)!;
      this.delimiter = match[1]!;
      this.push("end", ";", match[0]);
      this.i += match[0].length;
      return true;
    }
    // Séparateur personnalisé
    if (this.delimiter !== ";" && rest.startsWith(this.delimiter)) {
      this.push("end", ";", this.delimiter);
      this.i += this.delimiter.length;
      return true;
    }
    if (c === ";") {
      this.push(this.delimiter === ";" && this.depth === 0 ? "end" : "punct", ";", ";");
      this.i += 1;
      return true;
    }
    return this.batchSeparator(c, rest);
  }

  // GO (SQL Server) et / (Oracle) seuls sur leur ligne
  private batchSeparator(c: string, rest: string) {
    if (/^go\b/i.test(rest) && aloneOnLine(this.sql, this.i, 2)) {
      this.push("end", ";", rest.slice(0, 2));
      this.i += 2;
      return true;
    }
    if (c === "/" && aloneOnLine(this.sql, this.i, 1)) {
      this.push("end", ";", "/");
      this.i += 1;
      return true;
    }
    return false;
  }

  // Chaînes dollar (PostgreSQL) : corps de fonctions, ignorés en bloc
  private dollarString(rest: string) {
    const dollar = /^\$([A-Za-z_]\w*)?\$/.exec(rest);
    if (!dollar) {
      return false;
    }
    const { sql, i } = this;
    const [tag] = dollar;
    const end = sql.indexOf(tag, i + tag.length);
    const stop = end === -1 ? sql.length : end + tag.length;
    this.push("string", sql.slice(i + tag.length, end === -1 ? sql.length : end), sql.slice(i, stop));
    this.i = stop;
    return true;
  }

  // Chaînes Oracle q'[…]', q'{…}', q'<…>', q'(…)', q'!…!' (aussi nq'…') : apostrophes libres dedans (O-39)
  private alternativeString(rest: string) {
    const alternative = /^(n?q)'(.)/i.exec(rest);
    if (!alternative) {
      return false;
    }
    const { sql, i } = this;
    const open = alternative[2]!;
    const close = ({ "[": "]", "{": "}", "<": ">", "(": ")" } as Record<string, string>)[open] ?? open;
    const startText = i + alternative[0].length;
    const end = sql.indexOf(`${close}'`, startText);
    const stop = end === -1 ? sql.length : end + 2;
    this.push("string", sql.slice(startText, end === -1 ? sql.length : end), sql.slice(i, stop));
    this.i = stop;
    return true;
  }

  // Chaînes '…' (préfixes N, E, X, B acceptés)
  private string(c: string, rest: string) {
    const prefixed = /^[NnEeXxBb]'/.test(rest);
    if (!(c === "'" || prefixed)) {
      return false;
    }
    const from = this.i;
    const { value, end } = readString(this.sql, from, prefixed);
    this.i = end;
    this.push("string", value, this.sql.slice(from, end));
    return true;
  }

  // Identifiants entre délimiteurs
  private quotedIdentifier(c: string) {
    if (!(c === '"' || c === "`" || c === "[")) {
      return false;
    }
    const from = this.i;
    const { value, end } = readQuotedIdentifier(this.sql, from, c === "[" ? "]" : c);
    this.i = end;
    this.push("quoted", value, this.sql.slice(from, end));
    return true;
  }

  // Nombres
  private number(rest: string) {
    const number = /^\d+(\.\d+)?([eE][+-]?\d+)?/.exec(rest);
    if (!number) {
      return false;
    }
    this.push("number", number[0], number[0]);
    this.i += number[0].length;
    return true;
  }

  // Opérateurs de tableau PostgreSQL (avant les mots : « @ » commence aussi un identifiant SQL Server)
  private arrayOperator(rest: string) {
    if (!(rest.startsWith("<@") || rest.startsWith("@>"))) {
      return false;
    }
    this.push("punct", rest.slice(0, 2), rest.slice(0, 2));
    this.i += 2;
    return true;
  }

  // Mots
  private word(c: string) {
    if (!isWordStart(c)) {
      return false;
    }
    const { sql, i } = this;
    let j = i + 1;
    while (j < sql.length && isWordPart(sql[j]!)) {
      j += 1;
    }
    this.routineDepth(sql.slice(i, j).toLowerCase(), j);
    this.push("word", sql.slice(i, j), sql.slice(i, j));
    this.i = j;
    return true;
  }

  /** BEGIN / CASE ouvrent un bloc d'une routine ; END le ferme. */
  private routineDepth(word: string, j: number) {
    if (
      this.delimiter === ";" &&
      (word === "begin" || word === "case") &&
      inRoutine(this.tokens, this.statementStart)
    ) {
      this.depth += 1;
    } else if (word === "end" && this.depth > 0) {
      // END IF / END LOOP / END WHILE ferment un bloc non compté ; END [CASE] ferme BEGIN ou CASE.
      const following = /^\s+(\w+)/.exec(this.sql.slice(j))?.[1]?.toLowerCase();
      if (!["if", "loop", "while", "repeat", "for"].includes(following ?? "")) {
        this.depth -= 1;
      }
    }
  }

  // Opérateurs de deux caractères puis ponctuation simple
  private punctuation(c: string, rest: string) {
    const two = rest.slice(0, 2);
    if (["::", "<=", ">=", "<>", "!=", "||", ":="].includes(two)) {
      this.push("punct", two, two);
      this.i += 2;
      return;
    }
    this.push("punct", c, c);
    this.i += 1;
  }
}
