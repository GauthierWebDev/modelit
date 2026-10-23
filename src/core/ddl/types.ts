import { sqlType } from "../dbms/typeMapping";
import type { LogicalColumn, LogicalTable } from "../mld/logical";
import type { DataType } from "../model/datatype";
import { sqlTypeToDataType } from "../sql/types";
import { MSG } from "../validation/messages";
import { activeConditions, type Context, describe } from "./context";
import { sqliteAffinity } from "./dialects";
import { excludesEmptyString } from "./expressions";
import { sourceLosses } from "./sources";
import { counterType, integerLosses } from "./typeCounters";
import { domainType, unsignedType } from "./typeDomains";
import { freeTypeFallback, sameType, usage } from "./typeEquivalents";
import { type TypeResult, type TypeStep, typeStep } from "./typeStep";

/**
 * Type de la colonne pour la cible, et CHECK qu'il implique (domaine ENUM / SET, non-signé).
 * Chaque écart avec la source est signalé une fois, avec ce qui est réellement émis (O-35).
 */
export function typeOf(
  ctx: Context,
  table: LogicalTable,
  column: LogicalColumn,
  inlinePrimaryKey: boolean,
): TypeResult {
  const step = typeStep(ctx, table, column);
  const { checks, source, same, collate } = step;
  const type = column.type && column.type.kind === "text" ? { ...column.type, collation: undefined } : column.type;

  // Type d'origine, réémis tel quel vers le même dialecte (UNSIGNED, ENUM, SET, YEAR compris).
  if (same && type?.kind !== "counter") {
    return { sql: source!.sql + collate, checks };
  }
  if (!type) {
    return { sql: null, checks };
  }
  const domain = domainType(step);
  if (domain) {
    return domain;
  }
  const effective = unsignedType(step, type);
  const oracleDate = oracleDateType(step, effective);
  if (oracleDate) {
    return oracleDate;
  }
  if (effective.kind === "counter") {
    return counterType(step, effective, inlinePrimaryKey);
  }
  return (
    decimalType(step, effective) ??
    freeType(step, effective) ??
    boundedTextType(step, effective) ??
    plainType(step, type, effective)
  );
}

/** Oracle DATE (date et heure à la seconde) : TIMESTAMP(0), ou DATE en option — heure perdue (O-39). */
function oracleDateType(step: TypeStep, effective: DataType): TypeResult | undefined {
  const { ctx, source, checks } = step;
  if (
    !(
      source?.dialect === "oracle" &&
      /^date$/i.test(source.sql.trim()) &&
      effective.kind === "datetime" &&
      ctx.options.oracleDates === "date"
    )
  ) {
    return undefined;
  }
  const sql = sqlType({ kind: "date" }, ctx.target.dbms, ctx.target.version, ctx.target.custom?.types) ?? "DATE";
  step.loss("type", MSG.lossOracleDate(sql));
  return { sql, checks };
}

/** Décimal (O-39) : sans précision (Oracle NUMBER, NUMERIC), échelle négative (NUMBER(12,-3)). */
function decimalType(step: TypeStep, effective: DataType): TypeResult | undefined {
  if (effective.kind !== "decimal") {
    return undefined;
  }
  const { ctx, source, checks } = step;
  const { dbms, version } = ctx.target;
  const d = ctx.dialect.types;
  const unbounded = d.unboundedDecimal;
  if (effective.precision === undefined && unbounded !== "native") {
    if ("sql" in unbounded) {
      return { sql: unbounded.sql, checks };
    }
    const bounded =
      sqlType({ kind: "decimal", ...unbounded }, dbms, version, ctx.target.custom?.types) ?? "DECIMAL(38,10)";
    step.loss("type", MSG.lossDecimalUnbounded(source?.sql ?? "NUMERIC", bounded));
    return { sql: bounded, checks };
  }
  if (effective.scale < 0 && !d.negativeScale) {
    const widened =
      sqlType(
        { kind: "decimal", precision: (effective.precision ?? 38) - effective.scale, scale: 0 },
        dbms,
        version,
        ctx.target.custom?.types,
      ) ?? "NUMERIC";
    step.loss("type", MSG.lossNegativeScale(source?.sql ?? describe(effective), widened));
    return { sql: widened, checks };
  }
  return undefined;
}

/** Type libre venu d'un autre dialecte : équivalents connus, sinon texte. */
function freeType(step: TypeStep, effective: DataType): TypeResult | undefined {
  const { ctx, source, checks, collate } = step;
  if (!(effective.kind === "free" && source)) {
    return undefined;
  }
  const fallback = freeTypeFallback(ctx, effective.sql);
  if (fallback.loss) {
    step.loss("type", fallback.loss);
  } else if (fallback.lossy) {
    step.loss("type", MSG.lossType(effective.sql, fallback.sql));
  }
  // RAW(16) DEFAULT SYS_GUID() lu comme UUID (O-39) : approximation.
  if (
    source.dialect === "oracle" &&
    /^raw\b/i.test(source.sql.trim()) &&
    /^(uuid|uniqueidentifier)$/i.test(fallback.sql)
  ) {
    step.loss("type", MSG.lossRawUuid());
  }
  return { sql: fallback.sql + collate, checks };
}

/** Texte long (LOB) là où la cible ne sait pas le comparer : borné, avec perte. */
function boundedTextType(step: TypeStep, effective: DataType): TypeResult | undefined {
  const { ctx, table, column, source, checks, collate } = step;
  const { dbms, version } = ctx.target;
  const bound =
    effective.kind === "text" && effective.length === "large" && effective.encoding !== "binary"
      ? ctx.dialect.types.boundedText(usage(table, column.name))
      : undefined;
  if (!(effective.kind === "text" && bound !== undefined)) {
    return undefined;
  }
  const bounded = sqlType({ ...effective, length: "variable", size: bound }, dbms, version, ctx.target.custom?.types)!;
  if (!column.foreign) {
    step.loss(
      "type",
      MSG.lossType(source?.sql ?? sqlType(effective, dbms, version, ctx.target.custom?.types) ?? "TEXT", bounded),
    );
  }
  return { sql: bounded + collate, checks };
}

/** Type de la cible pour le type conceptuel, et écarts qu'il entraîne. */
function plainType(step: TypeStep, type: DataType, effective: DataType): TypeResult {
  const { ctx, table, column, source, checks, collate } = step;
  const { dbms, version } = ctx.target;
  const d = ctx.dialect.types;
  let sql = sqlType(effective, dbms, version, ctx.target.custom?.types);
  if (d.boundedBinary && effective.kind === "text" && effective.encoding === "binary" && effective.length !== "large") {
    if (!column.foreign) {
      step.loss("type", MSG.lossType(source?.sql ?? describe(effective), d.boundedBinary));
    }
    return { sql: d.boundedBinary, checks };
  }
  if (sql === null) {
    step.loss("type", MSG.lossType(source?.sql ?? effective.kind, "—"));
    return { sql: null, checks };
  }
  typeLosses(step, type, effective, sql);
  if (d.unsigned && column.unsigned && (effective.kind === "integer" || effective.kind === "decimal")) {
    sql += " UNSIGNED";
  }
  // TINYINT(1) lu comme booléen : MySQL y accepte d'autres valeurs que 0 / 1 (−128 à 127) (O-38).
  if (source && /^tinyint\s*\(\s*1\s*\)/i.test(source.sql) && effective.kind === "boolean" && !d.tinyintBoolean) {
    step.loss("type", MSG.lossTinyintBoolean(sql));
  }
  // Ici, la source est d'un autre dialecte (le même dialecte a réémis le type d'origine).
  sourceLosses(ctx, table, column, sql, effective, checks);
  const spatial = spatialFallback(step, effective, sql);
  if (spatial) {
    return { sql: spatial, checks };
  }
  return { sql: oracleText(step, effective, sql) + collate, checks };
}

/** Écart entre le type émis et le type conceptuel (ou d'origine). */
function typeLosses(step: TypeStep, type: DataType, effective: DataType, sql: string) {
  const { ctx, table, column, source, checks } = step;
  const { domain } = column;
  // Entiers à plage décimale (Oracle NUMBER(p), NUMBER) : comparés par leur plage (O-39).
  const digits = effective.kind === "integer" && (/^\s*number\b/i.test(source?.sql ?? "") || /^NUMBER\(/i.test(sql));
  if (effective !== type) {
    // Élargi pour couvrir la plage, négatifs exclus (CHECK ou clé étrangère) : rien de perdu.
    return;
  }
  if (ctx.dialect.types.affinities) {
    // Affinités seules (SQLite : TEXT, INTEGER, NUMERIC…) : seul un changement d'affinité compte.
    if (source && !domain && sqliteAffinity(source.sql) !== sqliteAffinity(sql)) {
      step.loss("type", MSG.lossType(source.sql, sql));
    }
    return;
  }
  if (digits) {
    integerLosses(ctx, table, column, sql, checks);
    return;
  }
  if (column.foreign && (effective.kind === "integer" || effective.kind === "text")) {
    // Clé étrangère : plage et longueur découlent de la clé référencée, qui seule porte l'entrée (O-40).
    return;
  }
  if (effective.kind !== "free" && !domain && !sameType(sqlTypeToDataType(sql, false, ctx.target.dbms), effective)) {
    step.loss("type", MSG.lossType(source?.sql ?? describe(effective), sql));
  }
}

/**
 * Types spatiaux vers PostgreSQL (O-42) : CREATE EXTENSION postgis en tête (option par défaut), ou
 * repli sans extension — BYTEA (WKB) ou TEXT (WKT) —, signalé ; le script s'exécute sans PostGIS.
 */
function spatialFallback(step: TypeStep, effective: DataType, sql: string): string | undefined {
  const { ctx } = step;
  if (!((effective.kind === "geography" || effective.kind === "geometry") && ctx.dialect.types.postgis)) {
    return undefined;
  }
  if (ctx.options.spatial === "postgis") {
    const extension = "CREATE EXTENSION IF NOT EXISTS postgis;";
    if (!ctx.script.preamble.includes(extension)) {
      ctx.script.preamble.unshift(extension);
    }
    return undefined;
  }
  const fallback = ctx.options.spatial === "wkb" ? "BYTEA" : "TEXT";
  step.loss("type", MSG.lossSpatialFallback(sql, fallback));
  return fallback;
}

/** Vers Oracle (O-39) : longueur en caractères, comme à la source ; la chaîne vide y vaut NULL. */
function oracleText(step: TypeStep, effective: DataType, sql: string): string {
  const { ctx, table, column, source } = step;
  const d = ctx.dialect.types;
  if (!(d.emptyStringIsNull && source && effective.kind === "text" && effective.encoding !== "binary")) {
    return sql;
  }
  const text = d.textLength(sql);
  const rejected = activeConditions(table, column).some((c) => excludesEmptyString(c, column.name));
  const notNull = column.notNull || table.primaryKey.includes(column.name);
  if (!(rejected && notNull)) {
    step.loss("domain", MSG.lossToOracleEmptyString(notNull));
  }
  return text;
}
