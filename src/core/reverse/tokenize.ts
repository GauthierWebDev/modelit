import type { SqlDialect } from "../model/physical";

/**
 * Découpage lexical d'un script SQL, tous dialectes confondus (override O-28).
 *
 * Reconnaît : identifiants entre "…", `…` ou […] ; chaînes '…' (avec '' ou \' doublés), N'…',
 * E'…', $tag$…$tag$ (PostgreSQL) ; commentaires --, # et /* *\/ ; séparateurs d'instructions `;`,
 * `GO` seul sur sa ligne (SQL Server), `/` seul sur sa ligne (Oracle) et `DELIMITER` (MySQL).
 */

export type TokenType = "word" | "quoted" | "string" | "number" | "punct" | "end";

export interface Token {
  type: TokenType;
  /** Texte utile : identifiant sans guillemets, contenu d'une chaîne, ponctuation… */
  value: string;
  /** Texte d'origine (pour reconstituer une expression telle qu'écrite). */
  raw: string;
  /** Position dans le script (pour en extraire un passage tel qu'écrit : corps de déclencheur…). */
  pos?: number;
}

const isWordStart = (c: string) => /[\p{L}_@#]/u.test(c);
const isWordPart = (c: string) => /[\p{L}\p{N}_$@#]/u.test(c);

/** Aucun lexème depuis la dernière fin d'instruction. */
const atStatementStart = (tokens: Token[]) => tokens.length === 0 || tokens.at(-1)!.type === "end";

/** Seuls des blancs depuis le début de la ligne. */
function atLineStart(sql: string, i: number): boolean {
  const before = sql.lastIndexOf("\n", i - 1);
  return sql.slice(before + 1, i).trim() === "";
}

/** Ligne réduite à `mot` (ex. GO, /) : séparateur de lots. */
function aloneOnLine(sql: string, start: number, length: number): boolean {
  const before = sql.lastIndexOf("\n", start - 1);
  const after = sql.indexOf("\n", start + length);
  const line = sql.slice(before + 1, after === -1 ? sql.length : after);
  return line.trim().length === length;
}

export interface TokenizeOptions {
  /**
   * Dialecte source (O-41) : commentaires /* *\/ imbriqués (SQL Server, PostgreSQL) ou fermés au
   * premier *\/ (MySQL, Oracle, SQLite…) ; commandes SQL*Plus (Oracle, ou dialecte inconnu).
   */
  dialect?: SqlDialect;
  /** Avertissements de lecture (ex. *\/ orphelin), complétés au fil du découpage. */
  warnings?: string[];
}

/** Numéro de ligne (à partir de 1) d'une position du script. */
const lineOf = (sql: string, i: number) => sql.slice(0, i).split("\n").length;

export function tokenize(sql: string, options: TokenizeOptions = {}): Token[] {
  const { dialect, warnings } = options;
  const nested = dialect === "sqlserver" || dialect === "postgresql";
  const sqlPlus = dialect === "oracle" || dialect === undefined;
  const tokens: Token[] = [];
  let delimiter = ";";
  let i = 0;
  let start = 0;
  // Corps de routine (CREATE TRIGGER / PROCEDURE / FUNCTION … BEGIN … END) : les « ; » internes ne
  // terminent pas l'instruction (Oracle, SQLite, SQL Server) (O-39). Profondeur BEGIN / CASE … END.
  let statementStart = 0;
  let depth = 0;
  const push = (type: TokenType, value: string, raw: string) => {
    if (type === "end") {
      statementStart = tokens.length + 1;
      depth = 0;
    }
    tokens.push({ type, value, raw, pos: start });
  };
  const inRoutine = () => {
    const head = tokens
      .slice(statementStart, statementStart + 10)
      .filter((t) => t.type === "word")
      .map((t) => t.value.toLowerCase());
    return head[0] === "create" && head.some((w) => ["trigger", "procedure", "function", "package"].includes(w));
  };

  while (i < sql.length) {
    const c = sql[i]!;
    const rest = sql.slice(i);
    start = i;

    // Espaces
    if (/\s/.test(c)) {
      i += 1;
      continue;
    }
    // Commentaires
    if (rest.startsWith("--")) {
      const end = sql.indexOf("\n", i);
      i = end === -1 ? sql.length : end + 1;
      continue;
    }
    // Commentaire MySQL « # … » (un # suivi d'un mot est un identifiant : table temporaire SQL Server)
    if (c === "#" && (i + 1 >= sql.length || /\s/.test(sql[i + 1]!))) {
      const end = sql.indexOf("\n", i);
      i = end === -1 ? sql.length : end + 1;
      continue;
    }
    if (rest.startsWith("/*")) {
      // SQL Server, PostgreSQL : les commentaires s'imbriquent (profondeur) ; ailleurs, le premier */ ferme.
      let nesting = 1;
      let j = i + 2;
      while (j < sql.length && nesting > 0) {
        if (nested && sql.startsWith("/*", j)) {
          nesting += 1;
          j += 2;
        } else if (sql.startsWith("*/", j)) {
          nesting -= 1;
          j += 2;
        } else {
          j += 1;
        }
      }
      i = nesting > 0 ? sql.length : j;
      continue;
    }
    // */ hors commentaire : commentaire mal imbriqué pour ce dialecte (O-41).
    if (rest.startsWith("*/")) {
      warnings?.push(`ligne ${lineOf(sql, i)}`);
      i += 2;
      continue;
    }
    // Commandes SQL*Plus / SQLcl (SET, PROMPT, REM…) : en début d'instruction, terminées par la fin
    // de ligne et non par « ; » — sans quoi elles avaleraient l'instruction suivante (O-39).
    if (sqlPlus && atStatementStart(tokens) && atLineStart(sql, i)) {
      const command =
        /^(set|prompt|rem|remark|spool|whenever|define|undefine|exit|quit|connect|conn|show|column|ttitle|btitle|pause|host|timing|clear|break|compute|var|variable|print|exec|execute|@@?)(?=[\s;]|$)/i.exec(
          rest,
        );
      // SET … = … ; (PostgreSQL, MySQL, SQL Server) reste une instruction SQL normale.
      const line = rest.slice(0, (rest.indexOf("\n") + 1 || rest.length + 1) - 1);
      // EXEC / EXECUTE : commande SQL*Plus seulement si le script est Oracle (sinon T-SQL : EXEC proc …).
      const exec = /^exec(ute)?$/i.test(command?.[1] ?? "") && dialect !== "oracle";
      if (command && !exec && !(command[1]!.toLowerCase() === "set" && /[=;]|\bto\b/i.test(line))) {
        push("end", ";", line);
        i += line.length;
        continue;
      }
    }
    // DELIMITER (client MySQL) : change le séparateur jusqu'au prochain DELIMITER
    if (/^delimiter\s+\S+/i.test(rest) && aloneOnLine(sql, i, /^delimiter\s+\S+/i.exec(rest)![0].length)) {
      const match = /^delimiter\s+(\S+)/i.exec(rest)!;
      delimiter = match[1]!;
      push("end", ";", match[0]);
      i += match[0].length;
      continue;
    }
    // Séparateur personnalisé
    if (delimiter !== ";" && rest.startsWith(delimiter)) {
      push("end", ";", delimiter);
      i += delimiter.length;
      continue;
    }
    if (c === ";") {
      push(delimiter === ";" && depth === 0 ? "end" : "punct", ";", ";");
      i += 1;
      continue;
    }
    // GO (SQL Server) et / (Oracle) seuls sur leur ligne
    if (/^go\b/i.test(rest) && aloneOnLine(sql, i, 2)) {
      push("end", ";", rest.slice(0, 2));
      i += 2;
      continue;
    }
    if (c === "/" && aloneOnLine(sql, i, 1)) {
      push("end", ";", "/");
      i += 1;
      continue;
    }
    // Chaînes dollar (PostgreSQL) : corps de fonctions, ignorés en bloc
    const dollar = /^\$([A-Za-z_]\w*)?\$/.exec(rest);
    if (dollar) {
      const tag = dollar[0];
      const end = sql.indexOf(tag, i + tag.length);
      const stop = end === -1 ? sql.length : end + tag.length;
      push("string", sql.slice(i + tag.length, end === -1 ? sql.length : end), sql.slice(i, stop));
      i = stop;
      continue;
    }
    // Chaînes Oracle q'[…]', q'{…}', q'<…>', q'(…)', q'!…!' (aussi nq'…') : apostrophes libres dedans (O-39)
    const alternative = /^(n?q)'(.)/i.exec(rest);
    if (alternative) {
      const open = alternative[2]!;
      const close = ({ "[": "]", "{": "}", "<": ">", "(": ")" } as Record<string, string>)[open] ?? open;
      const startText = i + alternative[0].length;
      const end = sql.indexOf(`${close}'`, startText);
      const stop = end === -1 ? sql.length : end + 2;
      push("string", sql.slice(startText, end === -1 ? sql.length : end), sql.slice(i, stop));
      i = stop;
      continue;
    }
    // Chaînes '…' (préfixes N, E, X, B acceptés)
    const prefixed = /^[NnEeXxBb]'/.test(rest);
    if (c === "'" || prefixed) {
      const from = i;
      i += prefixed ? 2 : 1;
      let value = "";
      while (i < sql.length) {
        const d = sql[i]!;
        if (d === "\\" && i + 1 < sql.length) {
          value += sql[i + 1];
          i += 2;
        } else if (d === "'" && sql[i + 1] === "'") {
          value += "'";
          i += 2;
        } else if (d === "'") {
          i += 1;
          break;
        } else {
          value += d;
          i += 1;
        }
      }
      push("string", value, sql.slice(from, i));
      continue;
    }
    // Identifiants entre délimiteurs
    if (c === '"' || c === "`" || c === "[") {
      const close = c === "[" ? "]" : c;
      const from = i;
      i += 1;
      let value = "";
      while (i < sql.length) {
        // MySQL : "…" est une chaîne, où \" échappe le guillemet (COMMENT "… \"VO\" …").
        if (close === '"' && sql[i] === "\\" && sql[i + 1] === '"') {
          value += '"';
          i += 2;
        } else if (sql[i] === close && sql[i + 1] === close) {
          // "" dans "…", `` dans `…`, ]] dans […] : délimiteur littéral (O-41).
          value += close;
          i += 2;
        } else if (sql[i] === close) {
          i += 1;
          break;
        } else {
          value += sql[i];
          i += 1;
        }
      }
      push("quoted", value, sql.slice(from, i));
      continue;
    }
    // Nombres
    const number = /^\d+(\.\d+)?([eE][+-]?\d+)?/.exec(rest);
    if (number) {
      push("number", number[0], number[0]);
      i += number[0].length;
      continue;
    }
    // Opérateurs de tableau PostgreSQL (avant les mots : « @ » commence aussi un identifiant SQL Server)
    if (rest.startsWith("<@") || rest.startsWith("@>")) {
      push("punct", rest.slice(0, 2), rest.slice(0, 2));
      i += 2;
      continue;
    }
    // Mots
    if (isWordStart(c)) {
      let j = i + 1;
      while (j < sql.length && isWordPart(sql[j]!)) {
        j += 1;
      }
      const word = sql.slice(i, j).toLowerCase();
      if (delimiter === ";" && (word === "begin" || word === "case") && inRoutine()) {
        depth += 1;
      } else if (word === "end" && depth > 0) {
        // END IF / END LOOP / END WHILE ferment un bloc non compté ; END [CASE] ferme BEGIN ou CASE.
        const following = /^\s+(\w+)/.exec(sql.slice(j))?.[1]?.toLowerCase();
        if (!["if", "loop", "while", "repeat", "for"].includes(following ?? "")) {
          depth -= 1;
        }
      }
      push("word", sql.slice(i, j), sql.slice(i, j));
      i = j;
      continue;
    }
    // Opérateurs de deux caractères puis ponctuation simple
    const two = rest.slice(0, 2);
    if (["::", "<=", ">=", "<>", "!=", "||", ":="].includes(two)) {
      push("punct", two, two);
      i += 2;
      continue;
    }
    push("punct", c, c);
    i += 1;
  }
  return tokens;
}

/** Instructions : suites de lexèmes séparées par les fins d'instruction. */
export function splitStatements(tokens: Token[]): Token[][] {
  const statements: Token[][] = [];
  let current: Token[] = [];
  for (const token of tokens) {
    if (token.type === "end") {
      if (current.length > 0) {
        statements.push(current);
      }
      current = [];
    } else {
      current.push(token);
    }
  }
  if (current.length > 0) {
    statements.push(current);
  }
  return statements;
}
