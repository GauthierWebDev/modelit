import type { LogicalKey, LogicalTable } from "../mld/logical";
import { MSG } from "../validation/messages";
import { place, placement, stateClause } from "./constraints";
import { type Context, describeKey } from "./context";
import { expressionIndex, include, keyColumns, keyIndex } from "./indexes";
import { columnRef, constraintName, q, tableName } from "./naming";

// Identifiants alternatifs (UNIQUE).

/**
 * Contrainte UNIQUE dans le CREATE TABLE, ou `null` si elle devient un index unique en fin de
 * script (préfixe : sur expression) ou si la cible ne sait pas l'exprimer (signalé) (O-35).
 */
export function uniqueLine(ctx: Context, table: LogicalTable, unique: LogicalKey, after: string[]): string | null {
  const d = ctx.dialect;
  const label = describeKey(unique);
  if (unique.method && unique.method !== "btree" && !d.uniques.methods) {
    // Une méthode autre que B-tree ne garantit pas l'unicité (PostgreSQL : HASH non unique).
    ctx.report.add("index", table.name, MSG.lossIndexMethod(unique.name ?? label, unique.method.toUpperCase()));
  }
  if (uniqueIndex(ctx, table, unique)) {
    return null;
  }
  const where = placement(ctx, table, "unique", unique.name ?? label, unique.state);
  const name = constraintName(ctx, table, unique.name, "AK", unique.columns);
  const columns = keyColumns(ctx, table, unique);
  const method = d.uniques.methods && unique.method ? ` USING ${unique.method.toUpperCase()}` : "";
  const equalNulls = unique.nulls === "not distinct" || unique.nulls === "oracle";
  const nulls = equalNulls ? nullsClause(ctx, table, unique) : "";
  if (!equalNulls) {
    distinctNullLosses(ctx, table, unique, label);
  }
  const covering = coveringClause(ctx, table, unique, label);
  const state = stateClause(ctx, table, "unique", unique.name ?? label, unique.state);
  const definition = `${name ? `CONSTRAINT ${q(ctx, name)} ` : ""}UNIQUE${nulls}(${columns})${covering}${method}${state}`;
  return place(
    ctx,
    table,
    definition,
    where,
    after,
    unique.state,
    () => constraintName(ctx, table, undefined, "AK", unique.columns, true)!,
  );
}

/** INCLUDE sur une contrainte UNIQUE (O-42) ; perte signalée si la cible ne l'admet pas. */
function coveringClause(ctx: Context, table: LogicalTable, unique: LogicalKey, label: string): string {
  const supported = ctx.dialect.uniques.include;
  const covering = unique.include?.length && supported ? include(ctx, table, unique) : "";
  // Sinon, include() a déjà signalé la perte s'il y en a une.
  if (unique.include?.length && !supported) {
    ctx.report.add("index", table.name, MSG.lossInclude(unique.name ?? label));
  }
  return covering;
}

/**
 * UNIQUE émis comme index unique en fin de script : sur expression ou conditionnel (O-39), sur préfixe
 * sans préfixes natifs, ou à plusieurs NULL admis là où UNIQUE n'en admet qu'un (index filtré, O-41).
 */
function uniqueIndex(ctx: Context, table: LogicalTable, unique: LogicalKey): boolean {
  const d = ctx.dialect;
  if (unique.expression || unique.where) {
    ctx.script.epilogue.push(...expressionIndex(ctx, table, unique));
    return true;
  }
  if (unique.prefixes && !d.indexes.nativePrefixes) {
    ctx.script.epilogue.push(...keyIndex(ctx, table, unique, true));
    return true;
  }
  if (unique.nulls === "distinct" && d.uniques.singleNull) {
    const filter = unique.columns.map((c) => `${columnRef(ctx, table, c)} IS NOT NULL`).join(" AND ");
    const indexName = q(ctx, constraintName(ctx, table, unique.name, "AK", unique.columns, true)!);
    ctx.script.epilogue.push(
      `CREATE UNIQUE INDEX ${indexName} ON ${tableName(ctx, table)}(${keyColumns(ctx, table, unique)}) WHERE ${filter};`,
    );
    return true;
  }
  return false;
}

/** NULL distincts demandés : un seul NULL admis par la cible, ou NULL égaux dans une clé composée Oracle (O-39). */
function distinctNullLosses(ctx: Context, table: LogicalTable, unique: LogicalKey, label: string) {
  singleNullLoss(ctx, table, unique.columns, unique.name ?? label);
  if (
    ctx.dialect.uniques.equalNulls === "composite" &&
    unique.columns.length > 1 &&
    unique.columns.some((c) => nullable(table, c))
  ) {
    ctx.report.add("index", table.name, MSG.lossOracleCompositeNulls(unique.name ?? label));
  }
}

/** Colonne qui admet NULL (ni NOT NULL ni membre de la clé primaire). */
const nullable = (table: LogicalTable, name: string) =>
  !(table.primaryKey.includes(name) || table.columns.find((c) => c.name === name)?.notNull);

/**
 * NULL égaux dans une clé composée (Oracle) ou NULLS NOT DISTINCT (PostgreSQL) (O-39) : exprimés
 * nativement ou par une clause, sinon signalés. Une ligne entièrement NULL, qu'Oracle ignore,
 * devient un doublon ailleurs : signalé si possible.
 */
function nullsClause(ctx: Context, table: LogicalTable, unique: LogicalKey): string {
  const equal = ctx.dialect.uniques.equalNulls;
  const label = unique.name ?? describeKey(unique);
  const allNullable = unique.columns.every((c) => nullable(table, c));
  if (equal === "composite") {
    if (unique.nulls === "not distinct" && allNullable) {
      ctx.report.add("index", table.name, MSG.lossNullsAllNull(label));
    }
    return "";
  }
  // Seulement si les NULL deviennent égaux ici : sans NULLS NOT DISTINCT, les lignes entièrement
  // NULL restent admises en double, comme dans Oracle.
  const equalized = equal === "native" || (equal !== null && equal.clause !== null);
  if (unique.nulls === "oracle" && allNullable && equalized) {
    ctx.report.add("index", table.name, MSG.lossNullsAllNull(label));
  }
  if (equal === "native") {
    return "";
  }
  if (equal?.clause) {
    return equal.clause;
  }
  ctx.report.add("index", table.name, MSG.lossNullsNotDistinct(label));
  return "";
}

/** Une contrainte UNIQUE n'y admet qu'un seul NULL, contrairement aux autres SGBD (SQL Server) (O-39). */
export function singleNullLoss(ctx: Context, table: LogicalTable, columns: string[], label: string) {
  if (!ctx.dialect.uniques.singleNull) {
    return;
  }
  if (columns.some((name) => nullable(table, name))) {
    ctx.report.add("index", table.name, MSG.lossSqlServerNulls(label));
  }
}
