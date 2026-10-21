import { collationClass, defaultCollationClass } from "../ddl/collation";
import { parseCondition } from "../ddl/expressions";
import type { DataType } from "../model/datatype";
import type { ConstraintState, SequenceDefinition, SqlDialect } from "../model/physical";
import type { NamedExpression, ParsedColumn, ParsedKey, ParsedTable } from "../reverse/parse";
import { tokenize } from "../reverse/tokenize";
import type { CatalogKey } from "./catalog";

/** État d'une contrainte en texte stable (`undefined` : active, validée, immédiate). */
export const stateText = (s?: ConstraintState) => {
  // Le dialecte ne sert qu'au vocabulaire du rapport (O-42).
  const entries = Object.entries(s ?? {}).filter(([k]) => k !== "dialect");
  return entries.length > 0 ? JSON.stringify(Object.fromEntries(entries.sort())) : undefined;
};

/** Nom effectif après repli de casse des identifiants non quotés. */
export function effective(name: string, quoted: boolean, dialect: SqlDialect) {
  if (quoted) {
    return name;
  }
  if (dialect === "postgresql") {
    return name.toLowerCase();
  }
  if (dialect === "oracle" || dialect === "db2") {
    return name.toUpperCase();
  }
  return name;
}

export const byText = <T>(list: T[]) => [...list].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));

/** Domaine d'une colonne d'après son type (ENUM / SET MySQL, type énuméré PostgreSQL). */
export function typeDomain(column: ParsedColumn, enumTypes: Map<string, string[]>): string | undefined {
  const match = /^\s*(enum|set)\s*\(/i.exec(column.type);
  if (match) {
    return `${match[1]!.toLowerCase()}:${tokenize(column.type)
      .filter((t) => t.type === "string")
      .map((t) => t.value)
      .join("|")}`;
  }
  const named = enumTypes.get(column.type.trim().replace(/^"|"$/g, "").toLowerCase());
  return named ? `enum:${named.join("|")}` : undefined;
}

/**
 * CHECK anonyme qui ne fait qu'exprimer le domaine ou la positivité d'une colonne (forme émise
 * pour ENUM, SET, UNSIGNED) : `col IN (…)`, `col <@ ARRAY[…]`, `col >= 0`.
 */
export function domainCheck(
  check: NamedExpression,
): { column: string; domain?: string; nonNegative?: boolean; nonEmpty?: boolean } | null {
  if (check.name) {
    return null;
  }
  const set = /^\s*"?([\w$]+)"?\s*<@\s*ARRAY\s*\[(.*)\]\s*(::\s*text\s*\[\s*\])?\s*$/is.exec(check.expression);
  if (set) {
    return {
      column: set[1]!,
      domain: `set:${tokenize(set[2]!)
        .filter((t) => t.type === "string")
        .map((t) => t.value)
        .join("|")}`,
    };
  }
  const condition = parseCondition(check.expression);
  if (
    condition?.kind === "in" &&
    !condition.negated &&
    condition.operand.kind === "column" &&
    condition.values.every((v) => v.kind === "string")
  ) {
    return {
      column: condition.operand.name,
      domain: `enum:${condition.values.map((v) => (v as { value: string }).value).join("|")}`,
    };
  }
  if (
    condition?.kind === "compare" &&
    condition.op === ">=" &&
    condition.left.kind === "column" &&
    condition.right.kind === "number" &&
    Number(condition.right.value) === 0
  ) {
    return { column: condition.left.name, nonNegative: true };
  }
  // col <> '' : chaîne vide refusée (forme émise pour un texte Oracle NOT NULL) (O-39).
  if (
    condition?.kind === "compare" &&
    condition.op === "<>" &&
    condition.left.kind === "column" &&
    condition.right.kind === "string" &&
    condition.right.value === ""
  ) {
    return { column: condition.left.name, nonEmpty: true };
  }
  return null;
}

/** Plage d'un type numérique : bornes d'un entier, positivité d'un décimal. */
export function rangeOf(
  concept: DataType | undefined,
  unsigned: boolean,
  nonNegative: boolean,
  bounds?: [bigint | null, bigint | null],
  digits?: [bigint, bigint],
): string | undefined {
  if (!concept) {
    return undefined;
  }
  const bits =
    concept.kind === "integer" ? concept.bits : concept.kind === "counter" ? (concept.bits ?? 32) : undefined;
  if (bits !== undefined) {
    return integerRangeText(bits, unsigned, nonNegative, bounds, digits);
  }
  if (concept.kind === "decimal" || concept.kind === "real" || concept.kind === "money") {
    return unsigned || nonNegative ? "≥ 0" : "ℝ";
  }
  return undefined;
}

/** Plage d'un entier : celle du type (ou décimale, Oracle NUMBER(p)), intersectée avec les bornes. */
function integerRangeText(
  bits: number,
  unsigned: boolean,
  nonNegative: boolean,
  bounds?: [bigint | null, bigint | null],
  digits?: [bigint, bigint],
): string {
  // Oracle NUMBER(p) : plage décimale ±(10^p − 1) (O-39).
  const max = digits ? digits[1] : unsigned ? 2n ** BigInt(bits) - 1n : 2n ** BigInt(bits - 1) - 1n;
  const min = unsigned || nonNegative ? 0n : digits ? digits[0] : -(2n ** BigInt(bits - 1));
  // Bornes explicites (CHECK … BETWEEN, YEAR) : intersection avec la plage du type.
  const [lo, hi] = bounds ?? [null, null];
  return `[${lo !== null && lo > min ? lo : min}, ${hi !== null && hi < max ? hi : max}]`;
}

/** Type conceptuel, à la collation, au jeu de caractères et à la largeur des entiers près (comparée par la plage). */
export function conceptOf(t: DataType | undefined, domain: string | undefined): string {
  if (domain) {
    return JSON.stringify({ kind: "domain" });
  }
  if (!t) {
    return "null";
  }
  if (t.kind === "text") {
    return JSON.stringify({ ...t, collation: undefined, encoding: t.encoding === "binary" ? "binary" : "char" });
  }
  // Entiers, et décimaux d'échelle nulle (NUMBER(20), NUMERIC(20)) : comparés par leur plage (O-39).
  if (
    t.kind === "integer" ||
    t.kind === "counter" ||
    (t.kind === "decimal" && t.scale === 0 && t.precision !== undefined)
  ) {
    return JSON.stringify({ kind: "integer" });
  }
  // MONEY ≡ DECIMAL(19,4) (O-42).
  if (t.kind === "money") {
    return JSON.stringify({ kind: "decimal", precision: 19, scale: 4 });
  }
  if (t.kind === "free" && /^jsonb?$/i.test(t.sql.trim())) {
    return JSON.stringify({ kind: "free", sql: "json" });
  }
  // UNIQUEIDENTIFIER (SQL Server) ≡ UUID (O-41).
  if (t.kind === "free" && /^(uuid|uniqueidentifier)$/i.test(t.sql.trim())) {
    return JSON.stringify({ kind: "free", sql: "uuid" });
  }
  return JSON.stringify(t);
}

/** Classe de collation effective d'une colonne de texte, et celle que le SGBD applique par défaut. */
export function collationOf(
  c: ParsedColumn,
  table: ParsedTable,
  database: { collation?: string; collations: Map<string, Record<string, string>> },
  concept: DataType | undefined,
  domain: string | undefined,
  dialect: SqlDialect,
): { collation?: string; defaultCollation?: string } {
  const textual = Boolean(domain) || (concept?.kind === "text" && concept.encoding !== "binary");
  if (!textual) {
    return {};
  }
  const name = c.collation ?? table.collation ?? database.collation;
  const klass = name ? collationClass(name, database.collations) : undefined;
  return {
    ...(klass ? { collation: klass === "other" ? name!.toLowerCase() : klass } : {}),
    ...(defaultCollationClass(dialect) ? { defaultCollation: defaultCollationClass(dialect) } : {}),
  };
}

export const keyOf = (key: ParsedKey, columnName: (n: string) => string): CatalogKey => ({
  name: key.name,
  columns: key.columns.map(columnName),
  ...(key.prefixes ? { prefixes: key.prefixes } : {}),
  ...(key.method && key.method !== "btree" ? { method: key.method } : {}),
  ...(key.kind ? { kind: key.kind } : {}),
});

/** Schéma hors schéma par défaut : dbo (SQL Server) et public (PostgreSQL) se valent (O-42). */
export const schemaName = (schema?: string) =>
  schema && !["dbo", "public"].includes(schema.toLowerCase()) ? schema.toLowerCase() : undefined;

/** Expression sans ses parenthèses englobantes : ((lower(email))) ≡ lower(email) (MySQL). */
export function unwrap(source: string): string {
  let text = source;
  while (text.startsWith("(") && text.endsWith(")")) {
    let depth = 0;
    const inner = [...text.slice(1, -1)].every((ch) => {
      depth += ch === "(" ? 1 : ch === ")" ? -1 : 0;
      return depth >= 0;
    });
    if (!inner || depth !== 0) {
      break;
    }
    text = text.slice(1, -1);
  }
  return text;
}

/** Séquences utilisées par les colonnes d'une table, en texte stable (O-39). */
export function sequencesOf(table: ParsedTable, sequences: Map<string, SequenceDefinition>): string[] {
  return table.columns
    .map((c) => c.sequence && sequences.get(c.sequence.name.toLowerCase()))
    .filter((s): s is SequenceDefinition => Boolean(s))
    .map(({ name, start, increment, min, max, cache, cycle, type, schema }) =>
      JSON.stringify({
        name: name.toLowerCase(),
        schema: schemaName(schema),
        start,
        increment,
        min,
        max,
        cache,
        cycle: cycle ?? false,
        type: type && ({ int: "integer" } as Record<string, string>)[type] ? "integer" : type,
      }),
    );
}

/** Longueur d'un texte en octets, en caractères, ou selon NLS_LENGTH_SEMANTICS (Oracle) (O-39). */
export function lengthSemanticsOf(type: string, dialect: SqlDialect): "byte" | "char" | "nls" {
  if (dialect !== "oracle") {
    return "char";
  }
  if (/\bbyte\s*\)/i.test(type)) {
    return "byte";
  }
  if (/\bchar\s*\)/i.test(type) || /^\s*n(var)?char/i.test(type)) {
    return "char";
  }
  return "nls";
}
