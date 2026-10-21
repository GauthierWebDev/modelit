import type { Token } from "../reverse/tokenize";
import type { DateFunction, SpecialFunction } from "./dialects";
import type { Condition, Operand } from "./expressions";

const COMPARATORS = new Set(["=", "<>", "!=", "<", "<=", ">", ">="]);

export const KEYWORDS = new Set(["and", "or", "not", "in", "between", "is", "null", "like", "true", "false"]);

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
  if (t.type === "word") {
    const lower = t.value.toLowerCase();
    if (lower === "null") {
      return { kind: "null" };
    }
    // CAST(GETDATE() AS DATE) / CAST(CURRENT_TIMESTAMP AS TIME) (SQL Server)
    if (lower === "cast" && r.punct("(")) {
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
    if (lower === "true" || lower === "false") {
      return { kind: "boolean", value: lower === "true" };
    }
    // CURRENT DATE / CURRENT TIMESTAMP (DB2)
    if (lower === "current" && r.word("date", "time", "timestamp")) {
      return { kind: "date", fn: `current_${r.next()!.value.toLowerCase()}` as DateFunction };
    }
    // datetime('now'), date('now') (SQLite)
    if (
      (lower === "datetime" || lower === "date") &&
      r.punct("(") &&
      r.peek(1)?.type === "string" &&
      r.peek(1)!.value.toLowerCase() === "now"
    ) {
      // datetime('now', 'localtime') : heure locale (O-39).
      const local =
        r.peek(2)?.value === "," &&
        r.peek(3)?.type === "string" &&
        r.peek(3)!.value.toLowerCase() === "localtime" &&
        r.peek(4)?.value === ")";
      r.i += local ? 5 : 3;
      return { kind: "date", fn: lower === "date" ? "current_date" : local ? "localtimestamp" : "current_timestamp" };
    }
    // LEN(x) / LENGTH(x) / CHAR_LENGTH(x) : longueur en caractères (O-42).
    if (["len", "length", "char_length", "character_length"].includes(lower) && r.punct("(")) {
      r.next();
      const arg = withCollate(r, operand(r));
      if (!r.punct(")")) {
        throw new Error("LEN");
      }
      r.next();
      return { kind: "length", arg };
    }
    const special = SPECIAL_FUNCTIONS[lower];
    if (special) {
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
    }
    if (lower in DATE_FUNCTIONS) {
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
    if (r.punct("(")) {
      throw new Error("fonction non reconnue");
    }
    if (KEYWORDS.has(lower)) {
      throw new Error("mot-clé inattendu");
    }
    return { kind: "column", name: t.value, quoted: false };
  }
  throw new Error("opérande inattendu");
}

function predicate(r: Reader): Condition {
  if (r.punct("(")) {
    r.next();
    const inner = orExpression(r);
    if (!r.punct(")")) {
      throw new Error("parenthèse");
    }
    r.next();
    return inner;
  }
  // ISJSON(x) = 1 / = 0 (SQL Server) (O-42).
  if (r.word("isjson") && r.peek(1)?.value === "(") {
    r.i += 2;
    const arg = operand(r);
    if (!r.punct(")")) {
      throw new Error("ISJSON");
    }
    r.next();
    const op = r.next();
    const value = operand(r);
    if (op?.value !== "=" || value.kind !== "number" || !["0", "1"].includes(value.value)) {
      throw new Error("ISJSON");
    }
    return { kind: "isJson", operand: arg, negated: value.value === "0" };
  }
  const left = withCollate(r, operand(r));
  // x IS [NOT] JSON (PostgreSQL 16+, Oracle).
  if (
    r.word("is") &&
    (r.peek(1)?.value.toLowerCase() === "json" ||
      (r.peek(1)?.value.toLowerCase() === "not" && r.peek(2)?.value.toLowerCase() === "json"))
  ) {
    r.next();
    const not = r.word("not");
    if (not) {
      r.next();
    }
    r.next();
    return { kind: "isJson", operand: left, negated: not };
  }
  // x ~ 'motif', x ~* …, x !~ …, x !~* … (PostgreSQL).
  if (r.punct("~") || (r.punct("!") && r.peek(1)?.value === "~")) {
    const negatedRegex = r.punct("!");
    if (negatedRegex) {
      r.next();
    }
    r.next();
    const insensitive = r.punct("*");
    if (insensitive) {
      r.next();
    }
    const pattern = r.next();
    if (pattern?.type !== "string") {
      throw new Error("motif");
    }
    return { kind: "regex", operand: left, pattern: pattern.value, negated: negatedRegex, insensitive };
  }
  const negated =
    r.word("not") &&
    (r.peek(1)?.value.toLowerCase() === "in" ||
      r.peek(1)?.value.toLowerCase() === "between" ||
      r.peek(1)?.value.toLowerCase() === "like");
  if (negated) {
    r.next();
  }
  if (r.word("in")) {
    r.next();
    if (!r.punct("(")) {
      throw new Error("IN");
    }
    r.next();
    const values: Operand[] = [];
    while (!r.punct(")")) {
      values.push(operand(r));
      if (r.punct(",")) {
        r.next();
      } else if (!r.punct(")")) {
        throw new Error("liste");
      }
    }
    r.next();
    return { kind: "in", operand: left, values, negated };
  }
  if (r.word("between")) {
    r.next();
    const low = operand(r);
    r.expect("and");
    return { kind: "between", operand: left, low, high: operand(r), negated };
  }
  if (r.word("like")) {
    r.next();
    return { kind: "like", operand: left, pattern: operand(r), negated };
  }
  if (r.word("is")) {
    r.next();
    const not = r.word("not");
    if (not) {
      r.next();
    }
    r.expect("null");
    return { kind: "isNull", operand: left, negated: not };
  }
  const op = r.peek();
  if (op?.type === "punct" && COMPARATORS.has(op.value)) {
    r.next();
    return { kind: "compare", left, op: op.value === "!=" ? "<>" : op.value, right: operand(r) };
  }
  throw new Error("prédicat");
}

function notExpression(r: Reader): Condition {
  if (r.word("not") && !["in", "between", "like"].includes(r.peek(1)?.value.toLowerCase() ?? "")) {
    r.next();
    return { kind: "not", item: notExpression(r) };
  }
  return predicate(r);
}

function andExpression(r: Reader): Condition {
  const items = [notExpression(r)];
  while (r.word("and")) {
    r.next();
    items.push(notExpression(r));
  }
  return items.length === 1 ? items[0]! : { kind: "and", items };
}

export function orExpression(r: Reader): Condition {
  const items = [andExpression(r)];
  while (r.word("or")) {
    r.next();
    items.push(andExpression(r));
  }
  return items.length === 1 ? items[0]! : { kind: "or", items };
}

/** x COLLATE "C" : la collation est ignorée par la forme structurée (relue par le générateur) (O-42). */
function withCollate(r: Reader, o: Operand): Operand {
  if (r.word("collate")) {
    r.next();
    r.next();
  }
  return o;
}
