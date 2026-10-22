import { Cursor, isPunct, isWord, joinRaw } from "./cursor";
import type { ParsedColumn } from "./parse";
import type { Token } from "./tokenize";

/** AUTO_INCREMENT, IDENTITY, GENERATED …, AS (colonne calculée). */
export function counterOption(c: Cursor, column: ParsedColumn): boolean {
  if (c.accept("auto_increment") || c.accept("autoincrement")) {
    column.autoIncrement = true;
    return true;
  }
  if (c.accept("identity")) {
    sqlServerIdentity(c, column);
    return true;
  }
  if (c.accept("generated")) {
    generated(c, column);
    return true;
  }
  if (c.accept("as")) {
    generatedColumn(c, column); // colonne calculée (MySQL, SQL Server)
    return true;
  }
  return false;
}

function sqlServerIdentity(c: Cursor, column: ParsedColumn) {
  column.autoIncrement = true;
  // SQL Server : IDENTITY refuse une valeur fournie (sauf IDENTITY_INSERT) — GENERATED ALWAYS (O-42).
  column.identity = "always";
  // SQL Server : IDENTITY(début, pas)
  const seed = c.group();
  if (seed?.[0]?.type === "number") {
    column.identityStart = Number(seed[0].value);
  }
  if (seed?.[2]?.type === "number" && Number(seed[2].value) !== 1) {
    column.identityIncrement = Number(seed[2].value);
  }
  if (c.accept("not", "for", "replication")) {
    addSqlServerOption(column, "NOT FOR REPLICATION");
  }
}

/** GENERATED { ALWAYS | BY DEFAULT [ON NULL] } AS { IDENTITY (…) | (expression) }. */
export function generated(c: Cursor, column: ParsedColumn) {
  let mode: "always" | "on null" | undefined;
  if (c.accept("always")) {
    mode = "always";
  } else if (c.accept("by", "default", "on", "null")) {
    mode = "on null";
  } else {
    c.accept("by", "default");
  }
  c.accept("as");
  if (c.accept("identity")) {
    column.autoIncrement = true;
    if (mode) {
      column.identity = mode;
    }
    identityOptions(c.group(), column);
  } else {
    generatedColumn(c, column);
  }
}

/** COLLATE, COMMENT, ON UPDATE, ON DELETE, options SQL Server, CHARACTER SET. */
export function otherOption(c: Cursor, column: ParsedColumn): boolean {
  if (c.accept("collate")) {
    column.collation = c.next()?.value;
    return true;
  }
  if (c.accept("comment")) {
    // MySQL accepte aussi "…" pour une chaîne.
    const t = c.next();
    if (t?.type === "string" || t?.type === "quoted") {
      column.comment = t.value;
    }
    return true;
  }
  if (c.accept("on", "update")) {
    // ON UPDATE CURRENT_TIMESTAMP[(n)] (MySQL)
    const t = c.next();
    const precision = c.group();
    if (t) {
      column.onUpdate = precision ? `${t.raw}(${joinRaw(precision)})` : t.raw;
    }
    return true;
  }
  if (c.accept("on", "delete")) {
    c.next();
    c.skipGroup();
    return true;
  }
  return sqlServerOption(c, column);
}

function sqlServerOption(c: Cursor, column: ParsedColumn): boolean {
  if (c.accept("rowguidcol")) {
    addSqlServerOption(column, "ROWGUIDCOL");
    return true;
  }
  if (c.accept("not", "for", "replication")) {
    addSqlServerOption(column, "NOT FOR REPLICATION");
    return true;
  }
  if (c.accept("character", "set") || c.accept("charset")) {
    c.next();
    return true;
  }
  return false;
}

/** Option de colonne SQL Server (ROWGUIDCOL, NOT FOR REPLICATION), réémise vers SQL Server (O-42). */
function addSqlServerOption(column: ParsedColumn, option: string) {
  column.sqlServerOptions ??= [];
  column.sqlServerOptions.push(option);
}

/** Expression d'une colonne calculée, puis STORED / VIRTUAL / PERSISTED. */
function generatedColumn(c: Cursor, column: ParsedColumn) {
  // Expression jusqu'au premier mot d'option ; SQL Server l'écrit sans parenthèses (`AS DATEDIFF(…)`) (O-41).
  const tokens: Token[] = [];
  let groups = 0;
  while (!(c.done() || (c.peek()!.type === "word" && GENERATED_STOP.has(c.peek()!.value.toLowerCase())))) {
    if (isPunct(c.peek(), "(")) {
      const group = c.group() ?? [];
      tokens.push({ type: "punct", value: "(", raw: "(" }, ...group, { type: "punct", value: ")", raw: ")" });
      groups += 1;
    } else {
      tokens.push(c.next()!);
    }
  }
  // (expr) : parenthèses englobantes retirées.
  const wrapped =
    groups === 1 &&
    isPunct(tokens[0], "(") &&
    isPunct(tokens.at(-1), ")") &&
    tokens.filter((t) => t.type === "punct" && t.value === "(").length > 0 &&
    tokens.length >= 2 &&
    wrapsAll(tokens);
  const expression = tokens.length > 0 ? (wrapped ? tokens.slice(1, -1) : tokens) : null;
  let stored = false;
  while (isWord(c.peek(), "stored", "virtual", "persisted")) {
    stored = !isWord(c.next(), "virtual") || stored;
  }
  if (expression) {
    column.generated = { expression: joinRaw(expression), stored };
  }
}

const GENERATED_STOP = new Set([
  "stored",
  "virtual",
  "persisted",
  "not",
  "null",
  "constraint",
  "primary",
  "unique",
  "check",
  "references",
  "default",
  "comment",
]);

/** La première parenthèse ferme-t-elle à la fin ? */
function wrapsAll(tokens: Token[]): boolean {
  let depth = 0;
  for (let k = 0; k < tokens.length; k += 1) {
    if (isPunct(tokens[k], "(")) {
      depth += 1;
    } else if (isPunct(tokens[k], ")")) {
      depth -= 1;
      if (depth === 0) {
        return k === tokens.length - 1;
      }
    }
  }
  return false;
}

/** Options d'une identité : (START WITH n INCREMENT BY m …). */
function identityOptions(options: Token[] | null, column: ParsedColumn) {
  if (!options) {
    return;
  }
  const c = new Cursor(options);
  while (!c.done()) {
    identityOption(c, column);
  }
}

function identityOption(c: Cursor, column: ParsedColumn) {
  if (c.accept("start", "with") || c.accept("start")) {
    const start = numberOf(c.next());
    if (start !== undefined) {
      column.identityStart = start;
    }
  } else if (c.accept("increment", "by") || c.accept("increment")) {
    const step = numberOf(c.next());
    if (step !== undefined && step !== 1) {
      column.identityIncrement = step;
    }
  } else {
    c.next();
  }
}

const numberOf = (t: Token | undefined) => (t?.type === "number" ? Number(t.value) : undefined);
