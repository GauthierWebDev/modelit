import type { DataType } from "../model/datatype";
import type { SqlDialect } from "../model/physical";
import { type Token, tokenize } from "./tokenize";
import { sqlTypeToDataType } from "./types";

/**
 * Type d'une colonne calculée sans type déclaré (SQL Server `col AS expr`) (O-41), déduit de son
 * expression selon les règles de SQL Server : DATEDIFF → INT ; arithmétique selon la priorité des
 * types (réel > décimal > monétaire > entiers), précision et échelle des décimaux calculées comme
 * SQL Server (p1 + p2 + 1, s1 + s2 pour ×…). `undefined` si l'expression sort de ce sous-ensemble.
 */

type Inferred = DataType | undefined;

const INTEGER_DIGITS: Record<number, number> = { 8: 3, 16: 5, 32: 10, 64: 19 };

/** Équivalent décimal d'un type numérique (pour combiner avec un décimal). */
function asDecimal(t: DataType): { p: number; s: number } | undefined {
  if (t.kind === "decimal") {
    return { p: t.precision ?? 38, s: t.scale };
  }
  if (t.kind === "money") {
    return { p: 19, s: 4 };
  }
  if (t.kind === "integer") {
    return { p: INTEGER_DIGITS[t.bits]!, s: 0 };
  }
  if (t.kind === "boolean") {
    return { p: 1, s: 0 };
  }
  return undefined;
}

/** Décimal plafonné à 38 chiffres, l'échelle cédant d'abord (au moins 6, comme SQL Server). */
function capped(p: number, s: number): DataType {
  if (p <= 38) {
    return { kind: "decimal", precision: p, scale: s };
  }
  const scale = Math.max(Math.min(s, 6), s - (p - 38));
  return { kind: "decimal", precision: 38, scale };
}

function combine(op: string, a: Inferred, b: Inferred): Inferred {
  if (!(a && b)) {
    return undefined;
  }
  const numeric = (t: DataType) => ["integer", "decimal", "real", "money", "boolean"].includes(t.kind);
  if (op === "+" && (a.kind === "text" || b.kind === "text")) {
    return concatenated(a, b);
  }
  if (!(numeric(a) && numeric(b))) {
    return undefined;
  }
  if (a.kind === "real" || b.kind === "real") {
    return realResult(a, b);
  }
  if (a.kind === "decimal" || b.kind === "decimal") {
    return decimalResult(op, asDecimal(a)!, asDecimal(b)!);
  }
  if (a.kind === "money" || b.kind === "money") {
    return { kind: "money" };
  }
  const bits = (t: DataType) => (t.kind === "integer" ? t.bits : 8);
  return { kind: "integer", bits: Math.max(bits(a), bits(b), 32) as 32 | 64 };
}

/** Réel double si l'un des deux l'est, sinon simple. */
function realResult(a: DataType, b: DataType): DataType {
  const double = (a.kind === "real" && a.precision === "double") || (b.kind === "real" && b.precision === "double");
  return { kind: "real", precision: double ? "double" : "single" };
}

/** Concaténation de textes (+). */
function concatenated(a: DataType, b: DataType): Inferred {
  if (a.kind !== "text" || b.kind !== "text") {
    return undefined;
  }
  const unicode = a.encoding === "unicode" || b.encoding === "unicode";
  const encoding = unicode ? "unicode" : "ascii";
  const large = a.length === "large" || b.length === "large" || a.size === undefined || b.size === undefined;
  return large
    ? { kind: "text", encoding, length: "large" }
    : { kind: "text", encoding, length: "variable", size: a.size! + b.size! };
}

/** Précision et échelle d'une opération sur des décimaux, comme SQL Server. */
function decimalResult(op: string, x: { p: number; s: number }, y: { p: number; s: number }): Inferred {
  switch (op) {
    case "+":
    case "-": {
      const s = Math.max(x.s, y.s);
      return capped(Math.max(x.p - x.s, y.p - y.s) + s + 1, s);
    }
    case "*":
      return capped(x.p + y.p + 1, x.s + y.s);
    case "/": {
      const s = Math.max(6, x.s + y.p + 1);
      return capped(x.p - x.s + y.s + s, s);
    }
    default:
      return undefined;
  }
}

export function inferComputedType(
  expression: string,
  columnType: (name: string) => DataType | undefined,
  dialect?: SqlDialect,
): DataType | undefined {
  const inference = new Inference(
    tokenize(expression, { dialect }).filter((t) => t.type !== "end"),
    columnType,
    dialect,
  );
  try {
    const type = inference.sum();
    return inference.i === inference.tokens.length ? type : undefined;
  } catch {
    return undefined;
  }
}

/** Analyse descendante de l'expression : somme → produit → facteur. */
class Inference {
  readonly tokens: Token[];
  i = 0;
  private readonly columnType: (name: string) => DataType | undefined;
  private readonly dialect: SqlDialect | undefined;

  constructor(tokens: Token[], columnType: (name: string) => DataType | undefined, dialect: SqlDialect | undefined) {
    this.tokens = tokens;
    this.columnType = columnType;
    this.dialect = dialect;
  }

  private peek(o = 0) {
    return this.tokens[this.i + o];
  }

  private next() {
    const token = this.tokens[this.i];
    this.i += 1;
    return token;
  }

  private punct(v: string) {
    return this.peek()?.type === "punct" && this.peek()!.value === v;
  }

  sum(): Inferred {
    let left = this.product();
    while (this.punct("+") || this.punct("-")) {
      left = combine(this.next()!.value, left, this.product());
    }
    return left;
  }

  private product(): Inferred {
    let left = this.factor();
    while (this.punct("*") || this.punct("/") || this.punct("%")) {
      const op = this.next()!.value;
      left = op === "%" ? combine("*", left, this.factor()) && left : combine(op, left, this.factor());
    }
    return left;
  }

  private factor(): Inferred {
    const t = this.next();
    if (!t) {
      return undefined;
    }
    if (t.type === "number" || t.type === "string") {
      return literal(t);
    }
    if (t.type === "punct" && t.value === "(") {
      const inner = this.sum();
      if (!this.punct(")")) {
        return undefined;
      }
      this.next();
      return inner;
    }
    if (t.type === "punct" && t.value === "-") {
      return this.factor();
    }
    if (t.type === "quoted") {
      return this.columnType(t.value);
    }
    if (t.type !== "word") {
      return undefined;
    }
    if (!this.punct("(")) {
      return this.columnType(t.value);
    }
    return this.call(t.value.toLowerCase(), this.args());
  }

  /** Arguments d'un appel, séparés par les virgules de premier niveau. */
  private args(): Token[][] {
    const list: Token[][] = [];
    let depth = 0;
    let current: Token[] = [];
    this.next(); // (
    while (this.peek()) {
      const t = this.next()!;
      if (t.type === "punct" && t.value === "(") {
        depth += 1;
      }
      if (t.type === "punct" && t.value === ")") {
        // Parenthèse fermante au niveau 0 : fin de la liste (comparé avant la décrémentation).
        const closing = depth === 0;
        depth -= 1;
        if (closing) {
          break;
        }
      }
      if (t.type === "punct" && t.value === "," && depth === 0) {
        list.push(current);
        current = [];
      } else {
        current.push(t);
      }
    }
    if (current.length > 0) {
      list.push(current);
    }
    return list;
  }

  private sub(tokens: Token[]) {
    return inferComputedType(tokens.map((t) => t.raw).join(" "), this.columnType, this.dialect);
  }

  /** Type du résultat d'une fonction. */
  private call(name: string, list: Token[][]): Inferred {
    switch (name) {
      case "datediff":
      case "len":
      case "datalength":
      case "charindex":
      case "datepart":
        return { kind: "integer", bits: 32 };
      case "datediff_big":
        return { kind: "integer", bits: 64 };
      case "abs":
      case "round":
      case "floor":
      case "ceiling":
      case "upper":
      case "lower":
      case "ltrim":
      case "rtrim":
      case "trim":
      case "isnull":
      case "coalesce":
        return list[0] ? this.sub(list[0]) : undefined;
      case "cast": {
        const as = list[0]?.findIndex((x) => x.type === "word" && x.value.toLowerCase() === "as") ?? -1;
        return as > 0
          ? sqlTypeToDataType(
              list[0]!
                .slice(as + 1)
                .map((x) => x.raw)
                .join(""),
              false,
              this.dialect,
            )
          : undefined;
      }
      case "convert":
        return list[0] ? sqlTypeToDataType(list[0].map((x) => x.raw).join(""), false, this.dialect) : undefined;
      default:
        return undefined;
    }
  }
}

/** Nombre (entier ou décimal) ou chaîne littérale. */
function literal(t: Token): Inferred {
  if (t.type === "number") {
    if (!t.value.includes(".")) {
      return { kind: "integer", bits: 32 };
    }
    const [whole, fraction] = t.value.split(".");
    const digits = (whole!.replace(/^0+/, "") + fraction!).length || 1;
    return { kind: "decimal", precision: Math.max(digits, fraction!.length), scale: fraction!.length };
  }
  return {
    kind: "text",
    encoding: /^N'/i.test(t.raw) ? "unicode" : "ascii",
    length: "variable",
    size: Math.max(1, t.value.length),
  };
}
