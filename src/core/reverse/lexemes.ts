import type { Token, TokenizeOptions } from "./tokenize";

export const isWordStart = (c: string) => /[\p{L}_@#]/u.test(c);
export const isWordPart = (c: string) => /[\p{L}\p{N}_$@#]/u.test(c);

/** Aucun lexème depuis la dernière fin d'instruction. */
export const atStatementStart = (tokens: Token[]) => tokens.length === 0 || tokens.at(-1)!.type === "end";

/** Seuls des blancs depuis le début de la ligne. */
export function atLineStart(sql: string, i: number): boolean {
  const before = sql.lastIndexOf("\n", i - 1);
  return sql.slice(before + 1, i).trim() === "";
}

/** Ligne réduite à `mot` (ex. GO, /) : séparateur de lots. */
export function aloneOnLine(sql: string, start: number, length: number): boolean {
  const before = sql.lastIndexOf("\n", start - 1);
  const after = sql.indexOf("\n", start + length);
  const line = sql.slice(before + 1, after === -1 ? sql.length : after);
  return line.trim().length === length;
}

/** Numéro de ligne (à partir de 1) d'une position du script. */
export const lineOf = (sql: string, i: number) => sql.slice(0, i).split("\n").length;

/** Commandes SQL*Plus / SQLcl reconnues en début d'instruction. */
const SQL_PLUS =
  /^(set|prompt|rem|remark|spool|whenever|define|undefine|exit|quit|connect|conn|show|column|ttitle|btitle|pause|host|timing|clear|break|compute|var|variable|print|exec|execute|@@?)(?=[\s;]|$)/i;

/** Fin d'un commentaire /* … *\/ ouvert en `i` : imbriqué (SQL Server, PostgreSQL) ou fermé au premier *\/. */
export function blockCommentEnd(sql: string, i: number, nested: boolean): number {
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
  return nesting > 0 ? sql.length : j;
}

/** Chaîne '…' ouverte en `i` (préfixe N, E, X ou B compris) : contenu et position après la fermante. */
export function readString(sql: string, i: number, prefixed: boolean): { value: string; end: number } {
  let j = i + (prefixed ? 2 : 1);
  let value = "";
  while (j < sql.length) {
    const d = sql[j]!;
    if (d === "\\" && j + 1 < sql.length) {
      value += sql[j + 1];
      j += 2;
    } else if (d === "'" && sql[j + 1] === "'") {
      value += "'";
      j += 2;
    } else if (d === "'") {
      j += 1;
      break;
    } else {
      value += d;
      j += 1;
    }
  }
  return { value, end: j };
}

/** Identifiant entre délimiteurs ouvert en `i`, fermé par `close` : nom et position après la fermeture. */
export function readQuotedIdentifier(sql: string, i: number, close: string): { value: string; end: number } {
  let j = i + 1;
  let value = "";
  while (j < sql.length) {
    // MySQL : "…" est une chaîne, où \" échappe le guillemet (COMMENT "… \"VO\" …").
    if (close === '"' && sql[j] === "\\" && sql[j + 1] === '"') {
      value += '"';
      j += 2;
    } else if (sql[j] === close && sql[j + 1] === close) {
      // "" dans "…", `` dans `…`, ]] dans […] : délimiteur littéral (O-41).
      value += close;
      j += 2;
    } else if (sql[j] === close) {
      j += 1;
      break;
    } else {
      value += sql[j];
      j += 1;
    }
  }
  return { value, end: j };
}

/**
 * Ligne de commande SQL*Plus (`rest` commence en début de ligne d'une instruction), ou `undefined`.
 * SET … = … ; (PostgreSQL, MySQL, SQL Server) reste une instruction SQL normale ; EXEC / EXECUTE n'est
 * une commande SQL*Plus que si le script est Oracle (sinon T-SQL : EXEC proc …).
 */
export function sqlPlusLine(rest: string, dialect: TokenizeOptions["dialect"]): string | undefined {
  const command = SQL_PLUS.exec(rest);
  const line = rest.slice(0, (rest.indexOf("\n") + 1 || rest.length + 1) - 1);
  const exec = /^exec(ute)?$/i.test(command?.[1] ?? "") && dialect !== "oracle";
  if (command && !exec && !(command[1]!.toLowerCase() === "set" && /[=;]|\bto\b/i.test(line))) {
    return line;
  }
  return undefined;
}

/** Instruction en cours : CREATE TRIGGER / PROCEDURE / FUNCTION / PACKAGE (corps de routine). */
export function inRoutine(tokens: Token[], statementStart: number): boolean {
  const head = tokens
    .slice(statementStart, statementStart + 10)
    .filter((t) => t.type === "word")
    .map((t) => t.value.toLowerCase());
  return head[0] === "create" && head.some((w) => ["trigger", "procedure", "function", "package"].includes(w));
}
