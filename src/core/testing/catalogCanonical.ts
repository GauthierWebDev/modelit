import { type Condition, likeToRegex, type Operand, parseCondition, parseDefault } from "../ddl/expressions";
import type { DataType } from "../model/datatype";
import type { SqlDialect } from "../model/physical";
import { tokenize } from "../reverse/tokenize";

export const compact = (text: string) =>
  text
    .replace(/\s+/g, " ")
    .replace(/\s*([(),])\s*/g, "$1")
    .trim();

function canonicalOperand(o: Operand): unknown {
  if (o.kind === "length") {
    return { kind: "length", arg: canonicalOperand(o.arg) };
  }
  // Booléen ≡ 0 / 1 (BIT SQL Server, TINYINT(1) MySQL comparés à 0 / 1) (O-41).
  if (o.kind === "boolean") {
    return { kind: "number", value: o.value ? "1" : "0" };
  }
  return o.kind === "column" ? { kind: "column", name: o.name.toLowerCase() } : o;
}

/** Contexte d'une forme canonique : LIKE SQL Server à classes lu comme expression rationnelle (O-42). */
export interface CanonicalContext {
  dialect?: SqlDialect;
  /** Colonne sous collation insensible à la casse (déclarée ou par défaut du SGBD). */
  insensitive?: (column: string) => boolean;
}

export function canonicalCondition(c: Condition, context: CanonicalContext = {}): unknown {
  const recurse = (x: Condition) => canonicalCondition(x, context);
  switch (c.kind) {
    case "and":
    case "or":
      return { kind: c.kind, items: c.items.map(recurse) };
    case "not":
      return { kind: "not", item: recurse(c.item) };
    case "regex":
      return {
        kind: "regex",
        operand: canonicalOperand(c.operand),
        pattern: c.pattern,
        negated: c.negated,
        insensitive: c.insensitive,
      };
    case "isJson":
      return { kind: "isJson", operand: canonicalOperand(c.operand), negated: c.negated };
    case "compare":
      return { ...c, left: canonicalOperand(c.left), right: canonicalOperand(c.right) };
    case "in":
      return { ...c, operand: canonicalOperand(c.operand), values: c.values.map(canonicalOperand) };
    case "between":
      return {
        ...c,
        operand: canonicalOperand(c.operand),
        low: canonicalOperand(c.low),
        high: canonicalOperand(c.high),
      };
    case "isNull":
      return { ...c, operand: canonicalOperand(c.operand) };
    case "like": {
      // SQL Server : [A-Z] / [^A-Z] sont des classes ≡ expression rationnelle ancrée (O-42).
      const regex =
        context.dialect === "sqlserver" && c.pattern.kind === "string" ? likeToRegex(c.pattern.value) : null;
      if (regex) {
        const column = c.operand.kind === "column" ? c.operand.name : "";
        return {
          kind: "regex",
          operand: canonicalOperand(c.operand),
          pattern: regex,
          negated: c.negated,
          insensitive: Boolean(context.insensitive?.(column)),
        };
      }
      return { ...c, operand: canonicalOperand(c.operand), pattern: canonicalOperand(c.pattern) };
    }
  }
}

/** Forme canonique d'une condition CHECK (structurée si possible, sinon texte compacté). */
export function canonicalCheck(expression: string, context: CanonicalContext = {}): string {
  const condition = parseCondition(expression);
  return condition ? JSON.stringify(canonicalCondition(condition, context)) : compact(expression).toLowerCase();
}

/** Forme canonique d'une valeur par défaut ; `undefined` pour DEFAULT NULL (aucun défaut). */
export function canonicalDefault(expression: string, concept?: DataType): string | undefined {
  const value = parseDefault(expression);
  if (value?.kind === "null") {
    return undefined;
  }
  // Dans une colonne sans fuseau, l'horodatage courant y est converti en heure locale (O-39).
  if (
    value?.kind === "date" &&
    (value.fn === "localtimestamp" || value.fn === "localtimestamp_seconds") &&
    !(concept?.kind === "datetime" && concept.withTimeZone)
  ) {
    return JSON.stringify({ kind: "date", fn: "current_timestamp" });
  }
  if (value?.kind === "number" && concept?.kind === "boolean" && (value.value === "0" || value.value === "1")) {
    return JSON.stringify({ kind: "boolean", value: value.value === "1" });
  }
  // ARRAY['a', 'b']::text[] (SET en tableau) ≡ 'a,b'
  const array = /^ARRAY\s*\[(.*)\]\s*(::\s*text\s*\[\s*\])?$/i.exec(expression.trim());
  if (array) {
    return JSON.stringify({
      kind: "string",
      value: tokenize(array[1]!)
        .filter((t) => t.type === "string")
        .map((t) => t.value)
        .join(","),
    });
  }
  return value ? JSON.stringify(value) : compact(expression);
}
