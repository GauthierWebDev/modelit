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
  if (!a || !b) {
    return undefined;
  }
  const numeric = (t: DataType) => ["integer", "decimal", "real", "money", "boolean"].includes(t.kind);
  if (op === "+" && (a.kind === "text" || b.kind === "text")) {
    if (a.kind !== "text" || b.kind !== "text") {
      return undefined;
    }
    const unicode = a.encoding === "unicode" || b.encoding === "unicode";
    const large = a.length === "large" || b.length === "large" || a.size === undefined || b.size === undefined;
    return large
      ? { kind: "text", encoding: unicode ? "unicode" : "ascii", length: "large" }
      : { kind: "text", encoding: unicode ? "unicode" : "ascii", length: "variable", size: a.size! + b.size! };
  }
  if (!numeric(a) || !numeric(b)) {
    return undefined;
  }
  if (a.kind === "real" || b.kind === "real") {
    return {
      kind: "real",
      precision:
        a.kind === "real" && a.precision === "double"
          ? "double"
          : b.kind === "real" && b.precision === "double"
            ? "double"
            : "single",
    };
  }
  if (a.kind === "decimal" || b.kind === "decimal") {
    const x = asDecimal(a)!;
    const y = asDecimal(b)!;
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
  if (a.kind === "money" || b.kind === "money") {
    return { kind: "money" };
  }
  const bits = (t: DataType) => (t.kind === "integer" ? t.bits : 8);
  return { kind: "integer", bits: Math.max(bits(a), bits(b), 32) as 32 | 64 };
}

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
  punct(v: string) {
    return this.peek()?.type === "punct" && this.peek()!.value === v;
  }
}

export function inferComputedType(
  expression: string,
  columnType: (name: string) => DataType | undefined,
  dialect?: SqlDialect,
): DataType | undefined {
  const r = new Reader(tokenize(expression, { dialect }).filter((t) => t.type !== "end"));
  const sum = (): Inferred => {
    let left = product();
    while (r.punct("+") || r.punct("-")) {
      left = combine(r.next()!.value, left, product());
    }
    return left;
  };
  const product = (): Inferred => {
    let left = factor();
    while (r.punct("*") || r.punct("/") || r.punct("%")) {
      const op = r.next()!.value;
      left = op === "%" ? combine("*", left, factor()) && left : combine(op, left, factor());
    }
    return left;
  };
  const args = (): Token[][] => {
    const list: Token[][] = [];
    let depth = 0;
    let current: Token[] = [];
    r.next(); // (
    while (r.peek()) {
      const t = r.next()!;
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
  };
  const sub = (tokens: Token[]) => inferComputedType(tokens.map((t) => t.raw).join(" "), columnType, dialect);
  const factor = (): Inferred => {
    const t = r.next();
    if (!t) {
      return undefined;
    }
    if (t.type === "number") {
      if (!t.value.includes(".")) {
        return { kind: "integer", bits: 32 };
      }
      const [whole, fraction] = t.value.split(".");
      const digits = (whole!.replace(/^0+/, "") + fraction!).length || 1;
      return { kind: "decimal", precision: Math.max(digits, fraction!.length), scale: fraction!.length };
    }
    if (t.type === "string") {
      return {
        kind: "text",
        encoding: /^N'/i.test(t.raw) ? "unicode" : "ascii",
        length: "variable",
        size: Math.max(1, t.value.length),
      };
    }
    if (t.type === "punct" && t.value === "(") {
      const inner = sum();
      if (!r.punct(")")) {
        return undefined;
      }
      r.next();
      return inner;
    }
    if (t.type === "punct" && t.value === "-") {
      return factor();
    }
    if (t.type === "quoted") {
      return columnType(t.value);
    }
    if (t.type !== "word") {
      return undefined;
    }
    const name = t.value.toLowerCase();
    if (!r.punct("(")) {
      return columnType(t.value);
    }
    const list = args();
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
        return list[0] ? sub(list[0]) : undefined;
      case "cast": {
        const as = list[0]?.findIndex((x) => x.type === "word" && x.value.toLowerCase() === "as") ?? -1;
        return as > 0
          ? sqlTypeToDataType(
              list[0]!
                .slice(as + 1)
                .map((x) => x.raw)
                .join(""),
              false,
              dialect,
            )
          : undefined;
      }
      case "convert":
        return list[0] ? sqlTypeToDataType(list[0].map((x) => x.raw).join(""), false, dialect) : undefined;
      default:
        return undefined;
    }
  };
  try {
    const type = sum();
    return r.i === r.tokens.length ? type : undefined;
  } catch {
    return undefined;
  }
}
