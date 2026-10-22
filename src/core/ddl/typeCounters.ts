import { sqlType } from "../dbms/typeMapping";
import type { LogicalColumn, LogicalTable } from "../mld/logical";
import type { DataType } from "../model/datatype";
import { integerRange } from "../reverse/types";
import { MSG } from "../validation/messages";
import { activeConditions, type Context } from "./context";
import { valueBounds } from "./expressions";
import { columnRef } from "./naming";
import type { TypeResult, TypeStep } from "./typeStep";

/** Compteur (auto-incrément) : type natif de la cible, première valeur, pas et mode d'identité. */
export function counterType(
  step: TypeStep,
  effective: Extract<DataType, { kind: "counter" }>,
  inlinePrimaryKey: boolean,
): TypeResult {
  const { ctx, table, column, checks, source, same } = step;
  const { dbms, version } = ctx.target;
  const { counters } = ctx.dialect;
  let sql = sqlType(effective, dbms, version, ctx.target.custom?.types) ?? "INTEGER";
  // Oracle vers Oracle : le type d'origine du compteur (NUMBER(10)) est conservé (O-39).
  if (same && counters.keepSourceType) {
    sql = counters.keepSourceType(sql, source!.sql);
  }
  // Sans IDENTITY / SERIAL… (SQLite hors clé primaire simple, Oracle avant 12c) : simple entier.
  const native = /identity|serial|auto_?increment|counter/i.test(sql) || inlinePrimaryKey;
  if (!native) {
    step.loss("autoIncrement", MSG.lossAutoIncrement());
  }
  if (counters.narrowOnly && effective.bits === 64) {
    step.loss("type", MSG.lossType("BIGINT AUTOINCREMENT", counters.narrowOnly));
  }
  sql = identityStart(ctx, table, column, sql);
  if (ctx.dialect.types.unsigned && column.unsigned) {
    sql = sql.replace(/^(\w+)/, "$1 UNSIGNED");
  }
  sql = identityMode(step, sql);
  if (/^\s*number\b/i.test(source?.sql ?? "") || /^NUMBER\(/i.test(sql)) {
    integerLosses(ctx, table, column, sql, checks);
  }
  return { sql, checks };
}

/** GENERATED ALWAYS / BY DEFAULT ON NULL (O-39). MySQL : un NULL reçoit déjà une valeur. */
function identityMode(step: TypeStep, sql: string): string {
  const { ctx, column, source, same } = step;
  const { counters } = ctx.dialect;
  if (column.identity === "always") {
    // SQL Server : IDENTITY refuse déjà une valeur fournie (O-42).
    if (/BY DEFAULT AS IDENTITY/i.test(sql)) {
      return sql.replace(/BY DEFAULT AS IDENTITY/i, "ALWAYS AS IDENTITY");
    }
    if (!counters.rejectsExplicitValues) {
      step.loss("autoIncrement", MSG.lossIdentityAlways());
    }
    return sql;
  }
  if (counters.rejectsExplicitValues && /IDENTITY/i.test(sql) && source && !same) {
    // Vers SQL Server : IDENTITY refuse une valeur fournie, que la source acceptait (O-42).
    step.loss("autoIncrement", MSG.lossSqlServerIdentity());
    return sql;
  }
  if (column.identity === "on null" && !counters.nullTakesNextValue) {
    if (counters.onNullIdentity && /BY DEFAULT AS IDENTITY/i.test(sql)) {
      return sql.replace(/BY DEFAULT AS IDENTITY/i, "BY DEFAULT ON NULL AS IDENTITY");
    }
    step.loss("autoIncrement", MSG.lossIdentityOnNull());
  }
  return sql;
}

/** Première valeur du compteur (AUTO_INCREMENT = n, START WITH n). */
function identityStart(ctx: Context, table: LogicalTable, column: LogicalColumn, sql: string): string {
  const start = table.identityStart;
  // Pas du compteur : IDENTITY(100, 10), INCREMENT BY 10 (O-41).
  const step = table.identityStep;
  if ((start === undefined && step === undefined) || !table.primaryKey.includes(column.name)) {
    return sql;
  }
  const { counters } = ctx.dialect;
  if (/AS IDENTITY$/i.test(sql)) {
    return `${sql} (${[start === undefined ? "" : `START WITH ${start}`, step === undefined ? "" : `INCREMENT BY ${step}`].filter(Boolean).join(" ")})`;
  }
  const seeded = counters.seed?.(sql, start, step);
  if (seeded) {
    return seeded;
  }
  if (step !== undefined) {
    ctx.report.add("autoIncrement", table.name, MSG.lossIdentityStep(step), column.name);
  }
  if (start === undefined) {
    return sql;
  }
  if (counters.startOption) {
    ctx.script.tableOptions.set(table, counters.startOption(start));
    return sql;
  }
  ctx.report.add("autoIncrement", table.name, MSG.lossIdentityStart(start), column.name);
  return sql;
}

/**
 * Entier issu d'un NUMBER Oracle (O-39) : NUMBER sans précision devenu entier (séquence, identité,
 * clé qui la référence) ; plage élargie (NUMBER(4) → SMALLINT) sauf si un CHECK la borne.
 */
export function integerLosses(ctx: Context, table: LogicalTable, column: LogicalColumn, sql: string, checks: string[]) {
  const source = column.sourceType;
  // Clé étrangère : type et plage découlent de la clé référencée, qui seule porte l'entrée (O-40).
  if (!source || column.foreign) {
    return;
  }
  const emitted = sql.replace(/\s+(GENERATED|IDENTITY|AUTO_INCREMENT)\b.*$/i, "").trim();
  if (source.dialect === "oracle" && /^number$/i.test(source.sql.trim())) {
    const why = column.sequence ? "sequence" : column.type?.kind === "counter" ? "identity" : "reference";
    ctx.report.add("type", table.name, MSG.lossNumberInteger(source.sql, emitted, why), column.name);
    return;
  }
  rangeLosses(ctx, table, column, source, emitted, checks);
}

/** Plage élargie (NUMBER(4) → SMALLINT) : signalée, sauf si un CHECK la borne ; rétablie en option (O-40). */
function rangeLosses(
  ctx: Context,
  table: LogicalTable,
  column: LogicalColumn,
  source: NonNullable<LogicalColumn["sourceType"]>,
  emitted: string,
  checks: string[],
) {
  const from = integerRange(source.sql, source.dialect);
  const to = integerRange(emitted, ctx.target.dbms);
  if (!(from && to) || (to[0] >= from[0] && to[1] <= from[1])) {
    return;
  }
  // Bornes que les CHECK actifs de la colonne et de la table imposent à ses valeurs.
  const bounds = valueBounds({ kind: "and", items: activeConditions(table, column) }, column.name);
  if (bounds === "none") {
    return;
  }
  const lo = bounds.lo !== null && bounds.lo > to[0] ? bounds.lo : to[0];
  const hi = bounds.hi !== null && bounds.hi < to[1] ? bounds.hi : to[1];
  if (lo >= from[0] && hi <= from[1]) {
    return;
  }
  // Fidélité stricte (option) : la plage d'origine est rétablie par un CHECK (O-40).
  if (ctx.options.strictRanges) {
    checks.push(`${columnRef(ctx, table, column.name)} BETWEEN ${from[0]} AND ${from[1]}`);
    return;
  }
  ctx.report.add("type", table.name, MSG.lossRangeWidened(source.sql, emitted), column.name);
}
