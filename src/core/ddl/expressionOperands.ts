import { KEYWORDS } from "../sql/references";
import type { Token } from "../sql/tokenize";
import type { DateFunction, SpecialFunction } from "./dialects";
import type { Operand } from "./expressions";

/** Fonctions de date de tous les dialectes → forme canonique. */
const DATE_FUNCTIONS: Record<string, DateFunction> = {
  current_date: "current_date",
  curdate: "current_date",
  date: "current_date", // Access Date()
  current_time: "current_time",
  curtime: "current_time",
  time: "current_time", // Access Time()
  current_timestamp: "current_timestamp",
  now: "current_timestamp",
  // SQL Server (O-42) : GETDATE / SYSDATETIME = heure locale ; SYSUTCDATETIME / GETUTCDATE = heure UTC.
  getdate: "localtimestamp",
  sysdatetime: "localtimestamp",
  sysutcdatetime: "utc_timestamp",
  getutcdate: "utc_timestamp",
  utc_timestamp: "utc_timestamp",
  sysdatetimeoffset: "current_timestamp",
  // Oracle SYSDATE : heure locale à la seconde (O-39).
  sysdate: "localtimestamp_seconds",
  systimestamp: "current_timestamp",
  localtimestamp: "localtimestamp",
};

/** Fonctions spéciales de DEFAULT : avec parenthèses (`uuid`) ou sans (`current_user`) (O-39). */
const SPECIAL_FUNCTIONS: Record<string, { fn: SpecialFunction; call: boolean }> = {
  user: { fn: "current_user", call: false },
  current_user: { fn: "current_user", call: false },
  sys_guid: { fn: "uuid", call: true },
  gen_random_uuid: { fn: "uuid", call: true },
  newid: { fn: "uuid", call: true },
  newsequentialid: { fn: "uuid_sequential", call: true },
  uuidv7: { fn: "uuid_sequential", call: true },
  uuid: { fn: "uuid", call: true },
};

export class Reader {
  readonly tokens: Token[];
  i = 0;
  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }
  peek(o = 0) {
    return this.tokens[this.i + o];
  }
  next() {
    const token = this.tokens[this.i];
    this.i += 1;
    return token;
  }
  word(...words: string[]) {
    const t = this.peek();
    return t?.type === "word" && words.includes(t.value.toLowerCase());
  }
  punct(value: string) {
    const t = this.peek();
    return t?.type === "punct" && t.value === value;
  }
  expect(...words: string[]) {
    for (const w of words) {
      if (!this.word(w)) {
        throw new Error(`attendu ${w}`);
      }
      this.i += 1;
    }
  }
}

export function operand(r: Reader): Operand {
  const t = r.next();
  if (!t) {
    throw new Error("fin inattendue");
  }
  // (3) : opérande entre parenthèses (SQL Server les écrit autour des constantes) (O-42).
  if (t.type === "punct" && t.value === "(") {
    const inner = operand(r);
    if (!r.punct(")")) {
      throw new Error("parenthèse");
    }
    r.next();
    return inner;
  }
  const literal = literalOperand(r, t);
  if (literal) {
    return literal;
  }
  if (t.type === "word") {
    return wordOperand(r, t);
  }
  throw new Error("opérande inattendu");
}

/** Nombre, chaîne, colonne entre guillemets, nombre négatif. */
function literalOperand(r: Reader, t: Token): Operand | undefined {
  if (t.type === "number") {
    return { kind: "number", value: t.value };
  }
  if (t.type === "string") {
    return { kind: "string", value: t.value };
  }
  if (t.type === "quoted") {
    return { kind: "column", name: t.value, quoted: true };
  }
  if (t.type === "punct" && t.value === "-" && r.peek()?.type === "number") {
    return { kind: "number", value: `-${r.next()!.value}` };
  }
  return undefined;
}

/** Mot : NULL, booléen, fonction reconnue ou nom de colonne. */
function wordOperand(r: Reader, t: Token): Operand {
  const lower = t.value.toLowerCase();
  const keyword = keywordOperand(r, lower);
  if (keyword) {
    return keyword;
  }
  // datetime('now'), date('now') (SQLite)
  if ((lower === "datetime" || lower === "date") && isNow(r)) {
    return sqliteNow(r, lower);
  }
  // LEN(x) / LENGTH(x) / CHAR_LENGTH(x) : longueur en caractères (O-42).
  if (["len", "length", "char_length", "character_length"].includes(lower) && r.punct("(")) {
    return lengthOperand(r);
  }
  const special = SPECIAL_FUNCTIONS[lower] ? specialOperand(r, lower, SPECIAL_FUNCTIONS[lower]) : undefined;
  if (special) {
    return special;
  }
  if (lower in DATE_FUNCTIONS) {
    return dateOperand(r, t, lower);
  }
  if (r.punct("(")) {
    throw new Error("fonction non reconnue");
  }
  if (KEYWORDS.has(lower)) {
    throw new Error("mot-clé inattendu");
  }
  return { kind: "column", name: t.value, quoted: false };
}

/** NULL, CAST(…), TRUE / FALSE, CURRENT DATE (mots distincts : l'ordre est indifférent). */
function keywordOperand(r: Reader, lower: string): Operand | undefined {
  if (lower === "null") {
    return { kind: "null" };
  }
  // CAST(GETDATE() AS DATE) / CAST(CURRENT_TIMESTAMP AS TIME) (SQL Server)
  if (lower === "cast" && r.punct("(")) {
    return castOperand(r);
  }
  if (lower === "true" || lower === "false") {
    return { kind: "boolean", value: lower === "true" };
  }
  // CURRENT DATE / CURRENT TIMESTAMP (DB2)
  if (lower === "current" && r.word("date", "time", "timestamp")) {
    return { kind: "date", fn: `current_${r.next()!.value.toLowerCase()}` as DateFunction };
  }
  return undefined;
}

function castOperand(r: Reader): Operand {
  r.next();
  const inner = operand(r);
  r.expect("as");
  const type = r.next()?.value.toLowerCase();
  // DATETIME2(0) : précision ignorée.
  if (r.punct("(") && r.peek(1)?.type === "number" && r.peek(2)?.value === ")") {
    r.i += 3;
  }
  if (!r.punct(")")) {
    throw new Error("CAST");
  }
  r.next();
  if (inner.kind === "date" && (type === "date" || type === "time")) {
    return { kind: "date", fn: `current_${type}` };
  }
  if (inner.kind === "date" && (type === "datetime2" || type === "datetime")) {
    return { kind: "date", fn: "localtimestamp" };
  }
  throw new Error("CAST non reconnu");
}

const isNow = (r: Reader) => r.punct("(") && r.peek(1)?.type === "string" && r.peek(1)!.value.toLowerCase() === "now";

/** datetime('now', 'localtime') : heure locale (O-39). */
function sqliteNow(r: Reader, lower: string): Operand {
  const local =
    r.peek(2)?.value === "," &&
    r.peek(3)?.type === "string" &&
    r.peek(3)!.value.toLowerCase() === "localtime" &&
    r.peek(4)?.value === ")";
  r.i += local ? 5 : 3;
  return { kind: "date", fn: lower === "date" ? "current_date" : local ? "localtimestamp" : "current_timestamp" };
}

function lengthOperand(r: Reader): Operand {
  r.next();
  const arg = withCollate(r, operand(r));
  if (!r.punct(")")) {
    throw new Error("LEN");
  }
  r.next();
  return { kind: "length", arg };
}

/** Fonction sans argument (CURRENT_USER, UUID()…), avec ou sans parenthèses selon le SGBD. */
function specialOperand(
  r: Reader,
  lower: string,
  special: { fn: SpecialFunction; call: boolean },
): Operand | undefined {
  const empty = r.punct("(") && r.peek(1)?.type === "punct" && r.peek(1)!.value === ")";
  if (special.call && empty) {
    r.i += 2;
    return { kind: "function", fn: special.fn };
  }
  if (!(special.call || r.punct("("))) {
    return { kind: "function", fn: special.fn };
  }
  if (!special.call && empty && lower === "current_user") {
    r.i += 2;
    return { kind: "function", fn: special.fn };
  }
  return undefined;
}

function dateOperand(r: Reader, t: Token, lower: string): Operand {
  const fn = DATE_FUNCTIONS[lower]!;
  if (r.punct("(") && r.peek(1)?.type === "punct" && r.peek(1)!.value === ")") {
    r.i += 2;
  }
  // Précision des fractions de seconde : LOCALTIMESTAMP(0), CURRENT_TIMESTAMP(3), SYSTIMESTAMP(6).
  else if (r.punct("(") && r.peek(1)?.type === "number" && r.peek(2)?.value === ")" && /timestamp/.test(lower)) {
    r.i += 3;
  } else if (r.punct("(")) {
    throw new Error("fonction avec arguments");
  } else if (["date", "time", "now", "getdate", "curdate", "curtime", "sysdatetime"].includes(lower)) {
    // sans parenthèses, ces mots sont des noms de colonnes
    return { kind: "column", name: t.value, quoted: false };
  }
  return { kind: "date", fn };
}

/** x COLLATE "C" : la collation est ignorée par la forme structurée (relue par le générateur) (O-42). */
export function withCollate(r: Reader, o: Operand): Operand {
  if (r.word("collate")) {
    r.next();
    r.next();
  }
  return o;
}
