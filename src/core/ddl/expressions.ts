import { isAtLeast } from "../dbms/versions";
import { type Token, tokenize } from "../reverse/tokenize";
import {
  type DateFunction,
  dateFunction,
  hasBooleanLiterals,
  quoteIdentifier,
  type SpecialFunction,
  specialFunction,
  type Target,
} from "./dialects";

/**
 * Expressions SQL simples des CHECK et des DEFAULT (override O-29) : lues sous forme structurée
 * pour être réécrites dans un autre dialecte.
 *
 * Forme structurée reconnue : comparaisons à une constante ou à une colonne, IN (liste),
 * BETWEEN, IS [NOT] NULL, LIKE, combinées par AND / OR / NOT et parenthèses ; littéraux
 * (nombres, chaînes, booléens, NULL) et fonctions de date courantes. Toute autre expression
 * (fonctions, calculs…) reste brute : réémise telle quelle vers le même dialecte seulement.
 */

export type Operand =
  | { kind: "column"; name: string; quoted: boolean }
  | { kind: "number"; value: string }
  | { kind: "string"; value: string }
  | { kind: "boolean"; value: boolean }
  | { kind: "null" }
  | { kind: "date"; fn: DateFunction }
  /** Utilisateur courant, identifiant universel (O-39). */
  | { kind: "function"; fn: SpecialFunction }
  /** Longueur en caractères : LEN (SQL Server), LENGTH, CHAR_LENGTH (O-42). */
  | { kind: "length"; arg: Operand };

export type Condition =
  | { kind: "and" | "or"; items: Condition[] }
  | { kind: "not"; item: Condition }
  | { kind: "compare"; left: Operand; op: string; right: Operand }
  | { kind: "in"; operand: Operand; values: Operand[]; negated: boolean }
  | { kind: "between"; operand: Operand; low: Operand; high: Operand; negated: boolean }
  | { kind: "isNull"; operand: Operand; negated: boolean }
  | { kind: "like"; operand: Operand; pattern: Operand; negated: boolean }
  /**
   * Expression rationnelle ancrée (PostgreSQL ~, ~*), traduction d'un LIKE SQL Server à classes
   * [..] / [^..] ; `insensitive` : sous collation insensible à la casse (~*) (O-42).
   */
  | { kind: "regex"; operand: Operand; pattern: string; negated: boolean; insensitive: boolean; collateC?: boolean }
  /** ISJSON(x) = 1 (SQL Server), x IS JSON (PostgreSQL 16+, Oracle) (O-42). */
  | { kind: "isJson"; operand: Operand; negated: boolean };

const COMPARATORS = new Set(["=", "<>", "!=", "<", "<=", ">", ">="]);
const KEYWORDS = new Set(["and", "or", "not", "in", "between", "is", "null", "like", "true", "false"]);

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

class Reader {
  i = 0;
  constructor(readonly tokens: Token[]) {}
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

function operand(r: Reader): Operand {
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
      if (!special.call && !r.punct("(")) {
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

function orExpression(r: Reader): Condition {
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

/**
 * Motif LIKE SQL Server à classes ([A-Z], [^A-Z]) → expression rationnelle ancrée équivalente :
 * % → .*, _ → ., classes recopiées, autres caractères spéciaux échappés. `null` sans classe (O-42).
 */
export function likeToRegex(pattern: string): string | null {
  if (!/\[[^\]]*\]/.test(pattern)) {
    return null;
  }
  let out = "^";
  for (let i = 0; i < pattern.length; i += 1) {
    const ch = pattern[i]!;
    if (ch === "%") {
      out += ".*";
    } else if (ch === "_") {
      out += ".";
    } else if (ch === "[") {
      const end = pattern.indexOf("]", i + 2);
      if (end < 0) {
        return null;
      }
      out += `[${pattern.slice(i + 1, end).replace(/\\/g, "\\\\")}]`;
      i = end;
    } else {
      out += /[.^$*+?(){}|\\]/.test(ch) ? `\\${ch}` : ch;
    }
  }
  return `${out}$`;
}

/** Forme structurée d'une condition CHECK, ou `null` si elle sort du sous-ensemble reconnu. */
export function parseCondition(expression: string): Condition | null {
  try {
    const r = new Reader(tokenize(expression).filter((t) => t.type !== "end"));
    const condition = orExpression(r);
    return r.i === r.tokens.length ? condition : null;
  } catch {
    return null;
  }
}

/** Forme structurée d'une valeur par défaut (littéral ou fonction de date), ou `null`. */
export function parseDefault(expression: string): Operand | null {
  // (now() AT TIME ZONE 'UTC') / CURRENT_TIMESTAMP AT TIME ZONE 'UTC' : heure UTC (O-42).
  if (/^\(*\s*(now\s*\(\s*\)|current_timestamp)\s+at\s+time\s+zone\s+'utc'\s*\)*$/i.test(expression.trim())) {
    return { kind: "date", fn: "utc_timestamp" };
  }
  try {
    let tokens = tokenize(expression).filter((t) => t.type !== "end");
    // (CURRENT_DATE) : parenthèses englobantes (MySQL)
    while (tokens.length >= 3 && tokens[0]!.value === "(" && tokens.at(-1)!.value === ")") {
      tokens = tokens.slice(1, -1);
    }
    const r = new Reader(tokens);
    const value = operand(r);
    return r.i === r.tokens.length && value.kind !== "column" ? value : null;
  } catch {
    return null;
  }
}

/** Colonnes citées par une expression (pour rattacher un CHECK à une colonne). */
export function referencedColumns(expression: string): string[] {
  const tokens = tokenize(expression);
  const names = new Set<string>();
  tokens.forEach((t, i) => {
    if (t.type === "quoted") {
      names.add(t.value);
    } else if (t.type === "word" && !KEYWORDS.has(t.value.toLowerCase()) && tokens[i + 1]?.value !== "(") {
      names.add(t.value);
    }
  });
  return [...names];
}

// ---------------------------------------------------------------------------------------------
// Écriture

const sqlString = (value: string) => `'${value.replaceAll("'", "''")}'`;

/** Opérande écrit pour la cible ; `null` si la cible n'a pas d'équivalent. */
export function renderOperand(
  o: Operand,
  target: Target,
  columnCase: (name: string) => boolean = () => false,
): string | null {
  switch (o.kind) {
    case "column":
      return quoteIdentifier(target, o.name, o.quoted || columnCase(o.name));
    case "number":
      return o.value;
    case "string":
      return sqlString(o.value);
    case "null":
      return "NULL";
    case "boolean":
      return hasBooleanLiterals(target) ? (o.value ? "TRUE" : "FALSE") : o.value ? "1" : "0";
    case "date":
      return dateFunction(target, o.fn);
    case "function":
      return specialFunction(target, o.fn);
    case "length": {
      const arg = renderOperand(o.arg, target, columnCase);
      const fn = {
        postgresql: "char_length",
        sqlserver: "LEN",
        sybase: "LEN",
        mysql: "CHAR_LENGTH",
        mariadb: "CHAR_LENGTH",
        oracle: "LENGTH",
        db2: "LENGTH",
        sqlite: "length",
        access: "Len",
      }[target.dbms];
      return arg && `${fn}(${arg})`;
    }
  }
}

export function renderCondition(c: Condition, target: Target, columnCase?: (name: string) => boolean): string | null {
  const op = (o: Operand) => renderOperand(o, target, columnCase);
  const all = (parts: (string | null)[]) => (parts.every((p) => p !== null) ? (parts as string[]) : null);
  const not = (negated: boolean) => (negated ? "NOT " : "");
  switch (c.kind) {
    case "and":
    case "or": {
      const parts = all(
        c.items.map((item) => {
          const text = renderCondition(item, target, columnCase);
          return text && (item.kind === "and" || item.kind === "or") ? `(${text})` : text;
        }),
      );
      return parts?.join(` ${c.kind.toUpperCase()} `) ?? null;
    }
    case "not": {
      const inner = renderCondition(c.item, target, columnCase);
      return inner && `NOT (${inner})`;
    }
    case "compare": {
      const parts = all([op(c.left), op(c.right)]);
      return parts && `${parts[0]} ${c.op} ${parts[1]}`;
    }
    case "in": {
      const parts = all([op(c.operand), ...c.values.map(op)]);
      return parts && `${parts[0]} ${not(c.negated)}IN (${parts.slice(1).join(", ")})`;
    }
    case "between": {
      const parts = all([op(c.operand), op(c.low), op(c.high)]);
      return parts && `${parts[0]} ${not(c.negated)}BETWEEN ${parts[1]} AND ${parts[2]}`;
    }
    case "isNull": {
      const operandText = op(c.operand);
      return operandText && `${operandText} IS ${not(c.negated)}NULL`;
    }
    case "like": {
      const parts = all([op(c.operand), op(c.pattern)]);
      return parts && `${parts[0]} ${not(c.negated)}LIKE ${parts[1]}`;
    }
    case "regex": {
      if (target.dbms !== "postgresql") {
        return null;
      }
      const operandText = op(c.operand);
      return (
        operandText &&
        `${operandText}${c.collateC ? ' COLLATE "C"' : ""} ${c.negated ? "!" : ""}~${c.insensitive ? "*" : ""} ${sqlString(c.pattern)}`
      );
    }
    case "isJson": {
      const operandText = op(c.operand);
      if (!operandText) {
        return null;
      }
      switch (target.dbms) {
        case "postgresql":
          return isAtLeast("postgresql", target.version, "16") ? `${operandText} IS ${not(c.negated)}JSON` : null;
        case "oracle":
          return `${operandText} IS ${not(c.negated)}JSON`;
        case "sqlserver":
          return `ISJSON(${operandText}) = ${c.negated ? 0 : 1}`;
        case "mysql":
        case "mariadb":
          return `JSON_VALID(${operandText}) = ${c.negated ? 0 : 1}`;
        case "sqlite":
          return `json_valid(${operandText}) = ${c.negated ? 0 : 1}`;
        default:
          return null;
      }
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Cohérence des types (override O-35)

/** Famille de type d'une colonne, pour vérifier qu'un CHECK reste valide après conversion. */
export type TypeFamily = "number" | "text" | "temporal" | "boolean";

const operandFamily = (
  o: Operand,
  family: (column: string) => TypeFamily | undefined,
): TypeFamily | "any" | undefined => {
  switch (o.kind) {
    case "column":
      return family(o.name);
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    case "date":
      return "temporal";
    case "function":
      return o.fn === "current_user" ? "text" : undefined;
    case "length":
      return "number";
    // Une chaîne littérale s'adapte au type comparé (PostgreSQL : littéral de type inconnu).
    case "string":
    case "null":
      return "any";
  }
};

/**
 * Première incohérence de types d'une condition (ex. `annee >= 1901` sur une colonne texte), pour
 * les SGBD qui n'acceptent pas de comparer des familles différentes (PostgreSQL, DB2) ; `null` sinon.
 */
export function typeConflict(c: Condition, family: (column: string) => TypeFamily | undefined): string | null {
  const fam = (o: Operand) => operandFamily(o, family);
  const clash = (a: Operand, b: Operand) => {
    const x = fam(a);
    const y = fam(b);
    return x && y && x !== "any" && y !== "any" && x !== y
      ? `${describeOperand(a)} (${x}) / ${describeOperand(b)} (${y})`
      : null;
  };
  switch (c.kind) {
    case "and":
    case "or":
      for (const item of c.items) {
        const problem = typeConflict(item, family);
        if (problem) {
          return problem;
        }
      }
      return null;
    case "not":
      return typeConflict(c.item, family);
    case "compare":
      return clash(c.left, c.right);
    case "in":
      for (const v of c.values) {
        const problem = clash(c.operand, v);
        if (problem) {
          return problem;
        }
      }
      return null;
    case "between":
      return clash(c.operand, c.low) ?? clash(c.operand, c.high);
    case "like":
    case "regex": {
      const f = fam(c.operand);
      return f && f !== "any" && f !== "text" ? `${describeOperand(c.operand)} (${f}) LIKE` : null;
    }
    case "isJson":
      return null;
    case "isNull":
      return null;
  }
}

const describeOperand = (o: Operand): string =>
  o.kind === "column"
    ? o.name
    : o.kind === "string"
      ? `'${o.value}'`
      : o.kind === "number"
        ? o.value
        : o.kind === "boolean"
          ? String(o.value)
          : o.kind === "date" || o.kind === "function"
            ? o.fn
            : o.kind === "length"
              ? `LEN(${describeOperand(o.arg)})`
              : "NULL";

/**
 * La condition interdit-elle les valeurs négatives de `column` ? (conjonction de premier niveau :
 * `col >= n`, `col > n` avec n ≥ 0, `col BETWEEN a AND b` avec a ≥ 0, `col IN (…)` de nombres ≥ 0).
 */
export function impliesNonNegative(c: Condition, column: string): boolean {
  const isColumn = (o: Operand) => o.kind === "column" && o.name.toLowerCase() === column.toLowerCase();
  const number = (o: Operand) => (o.kind === "number" ? Number(o.value) : NaN);
  switch (c.kind) {
    case "and":
      return c.items.some((item) => impliesNonNegative(item, column));
    case "compare":
      if (isColumn(c.left)) {
        return (
          (c.op === ">=" && number(c.right) >= 0) ||
          (c.op === ">" && number(c.right) >= -1) ||
          (c.op === "=" && number(c.right) >= 0)
        );
      }
      if (isColumn(c.right)) {
        return (c.op === "<=" && number(c.left) >= 0) || (c.op === "<" && number(c.left) >= -1);
      }
      return false;
    case "between":
      return !c.negated && isColumn(c.operand) && number(c.low) >= 0;
    case "in":
      return !c.negated && isColumn(c.operand) && c.values.every((v) => number(v) >= 0);
    default:
      return false;
  }
}

/**
 * Bornes des valeurs (non NULL) que la condition laisse à `column` (O-39) : `null` pour une borne
 * absente ; `"none"` si seule la valeur NULL est permise. Conjonctions : intersection ; disjonctions :
 * enveloppe. Toute autre forme ne borne rien.
 */
export type ValueBounds = { lo: bigint | null; hi: bigint | null } | "none";

export function valueBounds(c: Condition, column: string): ValueBounds {
  const isColumn = (o: Operand) => o.kind === "column" && o.name.toLowerCase() === column.toLowerCase();
  const integer = (o: Operand) => (o.kind === "number" && /^-?\d+$/.test(o.value) ? BigInt(o.value) : null);
  const free: ValueBounds = { lo: null, hi: null };
  switch (c.kind) {
    case "and": {
      let lo: bigint | null = null;
      let hi: bigint | null = null;
      for (const item of c.items) {
        const b = valueBounds(item, column);
        if (b === "none") {
          return "none";
        }
        if (b.lo !== null && (lo === null || b.lo > lo)) {
          lo = b.lo;
        }
        if (b.hi !== null && (hi === null || b.hi < hi)) {
          hi = b.hi;
        }
      }
      return { lo, hi };
    }
    case "or": {
      const parts = c.items
        .map((item) => valueBounds(item, column))
        .filter((b): b is Exclude<ValueBounds, "none"> => b !== "none");
      if (!parts.length) {
        return "none";
      }
      const lo = parts.some((b) => b.lo === null)
        ? null
        : parts.reduce((m, b) => (b.lo! < m ? b.lo! : m), parts[0]!.lo!);
      const hi = parts.some((b) => b.hi === null)
        ? null
        : parts.reduce((m, b) => (b.hi! > m ? b.hi! : m), parts[0]!.hi!);
      return { lo, hi };
    }
    case "isNull":
      return isColumn(c.operand) && !c.negated ? "none" : free;
    case "between": {
      const lo = integer(c.low);
      const hi = integer(c.high);
      return !c.negated && isColumn(c.operand) && lo !== null && hi !== null ? { lo, hi } : free;
    }
    case "in": {
      const values = c.values.map(integer);
      if (c.negated || !isColumn(c.operand) || !values.length || values.some((v) => v === null)) {
        return free;
      }
      const list = values as bigint[];
      return { lo: list.reduce((m, v) => (v < m ? v : m)), hi: list.reduce((m, v) => (v > m ? v : m)) };
    }
    case "compare": {
      const flip: Record<string, string> = { "<": ">", "<=": ">=", ">": "<", ">=": "<=", "=": "=" };
      const [op, n] = isColumn(c.left)
        ? [c.op, integer(c.right)]
        : isColumn(c.right)
          ? [flip[c.op], integer(c.left)]
          : [undefined, null];
      if (n === null || !op) {
        return free;
      }
      if (op === ">=") {
        return { lo: n, hi: null };
      }
      if (op === ">") {
        return { lo: n + 1n, hi: null };
      }
      if (op === "<=") {
        return { lo: null, hi: n };
      }
      if (op === "<") {
        return { lo: null, hi: n - 1n };
      }
      if (op === "=") {
        return { lo: n, hi: n };
      }
      return free;
    }
    default:
      return free;
  }
}

/** La condition limite-t-elle `column` à une liste de valeurs toutes ASCII (`col IN ('O', 'N')`) ? (O-40) */
export function asciiDomain(c: Condition, column: string): boolean {
  if (c.kind === "and") {
    return c.items.some((item) => asciiDomain(item, column));
  }
  return (
    c.kind === "in" &&
    !c.negated &&
    c.operand.kind === "column" &&
    c.operand.name.toLowerCase() === column.toLowerCase() &&
    c.values.every((v) => v.kind === "string" && /^\p{ASCII}*$/u.test(v.value))
  );
}

/**
 * La condition refuse-t-elle la chaîne vide pour `column` ? (O-39) : `col <> ''`, `col IN (…)` sans
 * '', `col LIKE '_%'`… en conjonction de premier niveau.
 */
export function excludesEmptyString(c: Condition, column: string): boolean {
  const isColumn = (o: Operand) => o.kind === "column" && o.name.toLowerCase() === column.toLowerCase();
  switch (c.kind) {
    case "and":
      return c.items.some((item) => excludesEmptyString(item, column));
    case "compare":
      return (
        (isColumn(c.left) && c.op === "<>" && c.right.kind === "string" && c.right.value === "") ||
        (isColumn(c.right) && c.op === "<>" && c.left.kind === "string" && c.left.value === "")
      );
    case "in":
      return !c.negated && isColumn(c.operand) && c.values.every((v) => v.kind === "string" && v.value !== "");
    default:
      return false;
  }
}
