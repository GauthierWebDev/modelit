import type { LogicalColumn, LogicalTable } from "../mld/logical";
import type { DataType } from "../model/datatype";
import { MSG } from "../validation/messages";
import { collationClass } from "./collation";
import { activeConditions, type Context, describe } from "./context";
import { fitName } from "./dialects";
import { impliesNonNegative } from "./expressions";
import { q } from "./naming";
import type { TypeResult, TypeStep } from "./typeStep";

/** Domaine énuméré (O-35) : le domaine Merise, exprimé selon la cible ; sinon `undefined` (suite du choix). */
export function domainType(step: TypeStep): TypeResult | undefined {
  const { ctx, column, checks, collate } = step;
  const { domain } = column;
  if (!domain) {
    return undefined;
  }
  const d = ctx.dialect.types;
  const list = domain.values.map((v) => `'${v.replaceAll("'", "''")}'`).join(", ");
  if (d.nativeDomains) {
    return { sql: `${domain.kind.toUpperCase()}(${list})${collate}`, checks };
  }
  if (domain.kind === "enum") {
    return enumDomain(step, list);
  }
  if (d.setArrays && ctx.options.sets === "array") {
    checks.push(`${step.ref()} <@ ARRAY[${list}]::text[]`);
    // MySQL ordonne les membres d'un SET et en retire les doublons ; un tableau les garde (O-38).
    step.loss("domain", MSG.lossSetArray());
    return { sql: `TEXT[]${collate}`, checks };
  }
  step.loss("domain", MSG.lossSet(domain.values.join(", ")));
  return undefined;
}

/** ENUM : type énuméré (PostgreSQL, option « type ») ou CHECK IN (…). */
function enumDomain(step: TypeStep, list: string): TypeResult | undefined {
  const { ctx, table, column, checks, collate } = step;
  if (ctx.dialect.types.enumTypes && ctx.options.enums === "type") {
    return { sql: enumType(ctx, table, column, list), checks };
  }
  checks.push(`${step.ref()} IN (${list})`);
  // MySQL ramène une valeur saisie dans une autre casse (ACTIF) à la valeur de l'ENUM (actif) (O-38).
  const klass =
    column.type?.kind === "text" && column.type.collation ? collationClass(column.type.collation) : undefined;
  if (klass === "ci" || klass === "ai_ci") {
    const insensitive = collate.trim() !== "" && ctx.options.collations !== "deterministic";
    step.loss("domain", MSG.lossEnumCase(insensitive));
  }
  return undefined;
}

/** Type énuméré PostgreSQL (option « type ») : déclaré avant les tables. */
function enumType(ctx: Context, table: LogicalTable, column: LogicalColumn, list: string): string {
  const name = fitName(`${table.name}_${column.name}`.toLowerCase(), ctx.maxName);
  ctx.script.preamble.push(`CREATE TYPE ${q(ctx, name)} AS ENUM (${list});`);
  return q(ctx, name);
}

/** Non signé (O-35) : MySQL l'exprime ; ailleurs, type élargi ou CHECK (>= 0), selon l'option. */
export function unsignedType(step: TypeStep, type: DataType): DataType {
  const { ctx, column, checks, source } = step;
  if (!column.unsigned || ctx.dialect.types.unsigned) {
    return type;
  }
  if (type.kind === "decimal" || type.kind === "real" || type.kind === "money") {
    checks.push(`${step.ref()} >= 0`);
    return type;
  }
  if (type.kind !== "integer" && type.kind !== "counter") {
    return type;
  }
  if (ctx.options.unsigned === "check") {
    checks.push(`${step.ref()} >= 0`);
    // Clé étrangère : sa plage découle de la clé référencée, qui seule porte l'entrée (O-40).
    if (!column.foreign) {
      step.loss("unsigned", MSG.lossUnsignedCheck(source?.sql ?? describe(type)));
    }
    return type;
  }
  nonNegativeCheck(step);
  return widenedInteger(type);
}

/**
 * Type élargi : plage couverte. Les négatifs restent interdits par un CHECK (>= 0), sauf
 * sur une clé étrangère (bornée par la colonne référencée) ou si un CHECK les exclut déjà (O-37).
 * TINYINT SQL Server : 0 à 255, toujours rétabli par un CHECK, même si un autre CHECK existe (O-42).
 */
function nonNegativeCheck(step: TypeStep) {
  const { table, column, checks, source } = step;
  if (!column.foreign && source?.dialect === "sqlserver" && /^\s*tinyint\b/i.test(source.sql)) {
    checks.push(`${step.ref()} BETWEEN 0 AND 255`);
  } else if (!(column.foreign || alreadyNonNegative(table, column))) {
    checks.push(`${step.ref()} >= 0`);
  }
}

/** Entier ou compteur non signé, élargi pour en couvrir la plage. */
function widenedInteger(type: Extract<DataType, { kind: "integer" | "counter" }>): DataType {
  const bits = type.kind === "integer" ? type.bits : (type.bits ?? 32);
  return bits >= 64
    ? type.kind === "counter"
      ? { kind: "counter", bits: 64 }
      : { kind: "decimal", precision: 20, scale: 0 }
    : type.kind === "counter"
      ? { kind: "counter", bits: 64 }
      : { kind: "integer", bits: (bits * 2) as 16 | 32 | 64 };
}

/** Un CHECK de la colonne (ou de la table, ne portant que sur elle) exclut-il déjà les négatifs ? */
function alreadyNonNegative(table: LogicalTable, column: LogicalColumn): boolean {
  return activeConditions(table, column).some((c) => impliesNonNegative(c, column.name));
}
