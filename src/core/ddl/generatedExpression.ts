import type { DataType } from "../model/datatype";
import type { SqlDialect } from "../model/physical";
import { type Token, tokenize } from "../reverse/tokenize";
import { quoteIdentifier, type Target } from "./dialects";

/**
 * Traduction des expressions de colonnes calculées (override O-35), sur un sous-ensemble sûr :
 * colonnes, nombres, chaînes, + − × ÷ %, parenthèses, fonctions usuelles (ROUND, ABS, COALESCE,
 * UPPER, LOWER, FLOOR), et pour PostgreSQL DATE(x) et `+ INTERVAL n unité` (MySQL).
 * Hors de ce sous-ensemble : `null` — la colonne devient ordinaire et la perte est signalée.
 */

type Node =
  | { kind: "column"; name: string; quoted: boolean }
  | { kind: "number"; value: string }
  | { kind: "string"; value: string }
  | { kind: "call"; name: string; args: Node[] }
  | { kind: "date"; arg: Node }
  | { kind: "interval"; amount: string; unit: string }
  | { kind: "negate"; arg: Node }
  | { kind: "binary"; op: string; left: Node; right: Node };

const FUNCTIONS = new Set(["round", "abs", "coalesce", "upper", "lower", "floor"]);
const UNITS = new Set(["day", "month", "year", "hour", "minute", "second", "week"]);

class Reader {
  i = 0;
  constructor(readonly tokens: Token[]) {}
  peek() {
    return this.tokens[this.i];
  }
  next() {
    return this.tokens[this.i++];
  }
  punct(value: string) {
    const t = this.peek();
    return t?.type === "punct" && t.value === value;
  }
  word(value: string) {
    const t = this.peek();
    return t?.type === "word" && t.value.toLowerCase() === value;
  }
}

function expression(r: Reader): Node {
  let left = term(r);
  while (r.punct("+") || r.punct("-")) {
    const op = r.next()!.value;
    left = { kind: "binary", op, left, right: term(r) };
  }
  return left;
}

function term(r: Reader): Node {
  let left = factor(r);
  while (r.punct("*") || r.punct("/") || r.punct("%")) {
    const op = r.next()!.value;
    left = { kind: "binary", op, left, right: factor(r) };
  }
  return left;
}

function factor(r: Reader): Node {
  const t = r.next();
  if (!t) {
    throw new Error("fin");
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
  if (t.type === "punct" && t.value === "-") {
    return { kind: "negate", arg: factor(r) };
  }
  if (t.type === "punct" && t.value === "(") {
    const inner = expression(r);
    if (!r.punct(")")) {
      throw new Error("parenthèse");
    }
    r.next();
    return inner;
  }
  if (t.type === "word") {
    const lower = t.value.toLowerCase();
    if (lower === "interval") {
      const amount = r.next();
      const unit = r.next();
      if (amount?.type !== "number" || unit?.type !== "word" || !UNITS.has(unit.value.toLowerCase())) {
        throw new Error("intervalle");
      }
      return { kind: "interval", amount: amount.value, unit: unit.value.toLowerCase() };
    }
    if (r.punct("(")) {
      r.next();
      const args: Node[] = [];
      while (!r.punct(")")) {
        args.push(expression(r));
        if (r.punct(",")) {
          r.next();
        } else if (!r.punct(")")) {
          throw new Error("arguments");
        }
      }
      r.next();
      if (lower === "date" && args.length === 1) {
        return { kind: "date", arg: args[0]! };
      }
      if (!FUNCTIONS.has(lower)) {
        throw new Error(`fonction ${lower}`);
      }
      return { kind: "call", name: lower, args };
    }
    return { kind: "column", name: t.value, quoted: false };
  }
  throw new Error("lexème");
}

/** Résultat de type date (DATE(x)) : `date + INTERVAL n DAY` devient `date + n` en PostgreSQL. */
const isDate = (n: Node) => n.kind === "date";

export interface TranslationContext {
  target: Target;
  /** Type d'une colonne de la table (immuabilité, casse). */
  columnType: (name: string) => DataType | undefined;
  caseSensitive: (name: string) => boolean;
}

/** Expression traduite pour la cible, ou `null` (non traduisible). */
export function translateGenerated(text: string, source: SqlDialect, context: TranslationContext): string | null {
  // Sous-ensemble commun à MySQL et Oracle (colonnes, + − × ÷, fonctions usuelles) (O-39).
  if (
    source !== "mysql" &&
    source !== "mariadb" &&
    source !== "oracle" &&
    source !== "sqlserver" &&
    source !== "generic" &&
    source !== context.target.dbms
  ) {
    return null;
  }
  let tree: Node;
  try {
    const r = new Reader(tokenize(text).filter((t) => t.type !== "end"));
    tree = expression(r);
    if (r.i !== r.tokens.length) {
      return null;
    }
  } catch {
    return null;
  }
  // Oracle : date ± nombre ajoute des jours, ce que PostgreSQL et les autres refusent (O-39).
  if (source === "oracle" && addsDaysToDate(tree, context)) {
    return null;
  }
  try {
    return render(tree, context);
  } catch {
    return null;
  }
}

function addsDaysToDate(n: Node, ctx: TranslationContext): boolean {
  if (n.kind !== "binary") {
    return n.kind === "call" || n.kind === "negate"
      ? (n.kind === "call" ? n.args : [n.arg]).some((a) => addsDaysToDate(a, ctx))
      : false;
  }
  const temporal = (x: Node) =>
    x.kind === "column" && ["date", "datetime"].includes(ctx.columnType(x.name)?.kind ?? "");
  const numeric = (x: Node) =>
    x.kind === "number" ||
    (x.kind === "column" && ["integer", "decimal", "real"].includes(ctx.columnType(x.name)?.kind ?? ""));
  if (
    (n.op === "+" || n.op === "-") &&
    ((temporal(n.left) && numeric(n.right)) || (numeric(n.left) && temporal(n.right)))
  ) {
    return true;
  }
  return addsDaysToDate(n.left, ctx) || addsDaysToDate(n.right, ctx);
}

function render(n: Node, ctx: TranslationContext): string {
  const { target } = ctx;
  const pg = target.dbms === "postgresql";
  switch (n.kind) {
    case "column":
      return quoteIdentifier(target, n.name, n.quoted || ctx.caseSensitive(n.name));
    case "number":
      return n.value;
    case "string":
      return `'${n.value.replaceAll("'", "''")}'`;
    case "negate":
      return `-${render(n.arg, ctx)}`;
    case "call":
      return `${n.name.toUpperCase()}(${n.args.map((a) => render(a, ctx)).join(", ")})`;
    case "date": {
      if (!pg) {
        throw new Error("DATE");
      }
      // timestamptz → date dépend du fuseau de session : interdit dans une colonne calculée.
      if (
        n.arg.kind === "column" &&
        ctx.columnType(n.arg.name)?.kind === "datetime" &&
        (ctx.columnType(n.arg.name) as { withTimeZone: boolean }).withTimeZone
      ) {
        throw new Error("non immuable");
      }
      const inner = render(n.arg, ctx);
      return n.arg.kind === "column" ? `${inner}::date` : `(${inner})::date`;
    }
    case "interval":
      if (!pg) {
        throw new Error("INTERVAL");
      }
      return `INTERVAL '${n.amount} ${n.unit}'`;
    case "binary": {
      // date ± INTERVAL n DAY → date ± n (reste une date) ; sinon intervalle PostgreSQL.
      if (pg && isDate(n.left) && n.right.kind === "interval" && n.right.unit === "day") {
        return `(${render(n.left, ctx)} ${n.op} ${n.right.amount})`;
      }
      if (n.right.kind === "interval" && !pg) {
        throw new Error("INTERVAL");
      }
      return `(${render(n.left, ctx)} ${n.op} ${render(n.right, ctx)})`;
    }
  }
}
