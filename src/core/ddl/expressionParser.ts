import { operand, type Reader, withCollate } from "./expressionOperands";
import type { Condition, Operand } from "./expressions";

const COMPARATORS = new Set(["=", "<>", "!=", "<", "<=", ">", ">="]);

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
    return isJsonCall(r);
  }
  const left = withCollate(r, operand(r));
  return jsonOrRegex(r, left) ?? comparison(r, left);
}

function isJsonCall(r: Reader): Condition {
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

/** x IS [NOT] JSON (PostgreSQL 16+, Oracle) ; x ~ 'motif', x ~* …, x !~ …, x !~* … (PostgreSQL). */
function jsonOrRegex(r: Reader, left: Operand): Condition | undefined {
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
  if (r.punct("~") || (r.punct("!") && r.peek(1)?.value === "~")) {
    return regex(r, left);
  }
  return undefined;
}

function regex(r: Reader, left: Operand): Condition {
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

/** [NOT] IN / BETWEEN / LIKE, IS [NOT] NULL, comparaison. */
function comparison(r: Reader, left: Operand): Condition {
  const negated =
    r.word("not") &&
    (r.peek(1)?.value.toLowerCase() === "in" ||
      r.peek(1)?.value.toLowerCase() === "between" ||
      r.peek(1)?.value.toLowerCase() === "like");
  if (negated) {
    r.next();
  }
  if (r.word("in")) {
    return { kind: "in", operand: left, values: inList(r), negated };
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

/** IN (a, b, …) */
function inList(r: Reader): Operand[] {
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
  return values;
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
