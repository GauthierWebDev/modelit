import type { Condition, Operand } from "./expressions";

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

function describeOperand(o: Operand): string {
  switch (o.kind) {
    case "column":
      return o.name;
    case "string":
      return `'${o.value}'`;
    case "number":
      return o.value;
    case "boolean":
      return String(o.value);
    case "date":
    case "function":
      return o.fn;
    case "length":
      return `LEN(${describeOperand(o.arg)})`;
    default:
      return "NULL";
  }
}

/**
 * La condition interdit-elle les valeurs négatives de `column` ? (conjonction de premier niveau :
 * `col >= n`, `col > n` avec n ≥ 0, `col BETWEEN a AND b` avec a ≥ 0, `col IN (…)` de nombres ≥ 0).
 */
export function impliesNonNegative(c: Condition, column: string): boolean {
  const isColumn = (o: Operand) => o.kind === "column" && o.name.toLowerCase() === column.toLowerCase();
  const number = (o: Operand) => (o.kind === "number" ? Number(o.value) : Number.NaN);
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
  const free: ValueBounds = { lo: null, hi: null };
  switch (c.kind) {
    case "and":
      return andBounds(c.items.map((item) => valueBounds(item, column)));
    case "or":
      return orBounds(c.items.map((item) => valueBounds(item, column)));
    case "isNull":
      return isColumn(c.operand) && !c.negated ? "none" : free;
    case "between": {
      const lo = integer(c.low);
      const hi = integer(c.high);
      return !c.negated && isColumn(c.operand) && lo !== null && hi !== null ? { lo, hi } : free;
    }
    case "in": {
      const values = c.values.map(integer);
      if (c.negated || !isColumn(c.operand) || values.length === 0 || values.some((v) => v === null)) {
        return free;
      }
      const list = values as bigint[];
      return { lo: list.reduce((m, v) => (v < m ? v : m)), hi: list.reduce((m, v) => (v > m ? v : m)) };
    }
    case "compare":
      return compareBounds(c, isColumn);
    default:
      return free;
  }
}

const integer = (o: Operand) => (o.kind === "number" && /^-?\d+$/.test(o.value) ? BigInt(o.value) : null);

/** Conjonction : intersection des bornes (« none » si l'un des termes ne permet que NULL). */
function andBounds(items: ValueBounds[]): ValueBounds {
  let lo: bigint | null = null;
  let hi: bigint | null = null;
  for (const b of items) {
    if (b === "none") {
      return "none";
    }
    if (b.lo !== null && (lo === null || b.lo > lo)) {
      // biome-ignore lint/style/useDestructuring: borne retenue sous condition, après comparaison
      lo = b.lo;
    }
    if (b.hi !== null && (hi === null || b.hi < hi)) {
      // biome-ignore lint/style/useDestructuring: borne retenue sous condition, après comparaison
      hi = b.hi;
    }
  }
  return { lo, hi };
}

/** Disjonction : enveloppe des bornes. */
function orBounds(items: ValueBounds[]): ValueBounds {
  const parts = items.filter((b): b is Exclude<ValueBounds, "none"> => b !== "none");
  if (parts.length === 0) {
    return "none";
  }
  const lo = parts.some((b) => b.lo === null) ? null : parts.reduce((m, b) => (b.lo! < m ? b.lo! : m), parts[0]!.lo!);
  const hi = parts.some((b) => b.hi === null) ? null : parts.reduce((m, b) => (b.hi! > m ? b.hi! : m), parts[0]!.hi!);
  return { lo, hi };
}

function compareBounds(c: Extract<Condition, { kind: "compare" }>, isColumn: (o: Operand) => boolean): ValueBounds {
  const flip: Record<string, string> = { "<": ">", "<=": ">=", ">": "<", ">=": "<=", "=": "=" };
  const [op, n] = isColumn(c.left)
    ? [c.op, integer(c.right)]
    : isColumn(c.right)
      ? [flip[c.op], integer(c.left)]
      : [undefined, null];
  if (n === null || !op) {
    return { lo: null, hi: null };
  }
  switch (op) {
    case ">=":
      return { lo: n, hi: null };
    case ">":
      return { lo: n + 1n, hi: null };
    case "<=":
      return { lo: null, hi: n };
    case "<":
      return { lo: null, hi: n - 1n };
    case "=":
      return { lo: n, hi: n };
    default:
      return { lo: null, hi: null };
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
