import { isAtLeast } from "../dbms/versions";
import type { LogicalForeignKey, LogicalKey, LogicalTable } from "../mld/logical";
import type { ConstraintState } from "../model/physical";
import { MSG } from "../validation/messages";
import { describeKey, type Context } from "./context";
import { referentialAction } from "./dialects";
import { expressionIndex, include, keyColumns, keyIndex } from "./indexes";
import { columnRef, constraintName, q, tableName, tableRef } from "./naming";

export type ConstraintKind = "check" | "unique" | "primary" | "foreign";
export type Placement = "inline" | "comment" | "after";

// ---------------------------------------------------------------------------------------------
// États des contraintes (O-39)

/**
 * DEFERRABLE [INITIALLY …] pour la cible, ou rien (signalé si la source l'avait). PostgreSQL et
 * SQLite ne diffèrent pas les CHECK ; MySQL, SQL Server, DB2 ne diffèrent rien.
 */
export function stateClause(ctx: Context, table: LogicalTable, kind: ConstraintKind, label: string, state?: ConstraintState): string {
  if (!state?.deferrable || state.disabled) return "";
  const { dbms } = ctx.target;
  const supported = dbms === "oracle" || (kind !== "check" && dbms === "postgresql") || (kind === "foreign" && dbms === "sqlite");
  if (!supported) {
    ctx.report.add(kind === "check" ? "check" : kind === "foreign" ? "action" : "index", table.name, kind === "check" ? MSG.lossDeferrableCheck(label) : MSG.lossDeferrable(label));
    return "";
  }
  return state.deferrable === "deferred" ? " DEFERRABLE INITIALLY DEFERRED" : " DEFERRABLE INITIALLY IMMEDIATE";
}

/**
 * Place d'une contrainte selon son état : `inline` (dans le CREATE TABLE), `comment` (désactivée à
 * la source : émise en commentaire, signalée), `after` (non validée : ALTER TABLE … NOT VALID).
 */
export function placement(ctx: Context, table: LogicalTable, kind: ConstraintKind, label: string, state?: ConstraintState): Placement {
  const category = kind === "check" ? "check" : kind === "foreign" ? "action" : "index";
  if (state?.disabled) {
    ctx.report.add(category, table.name, MSG.lossDisabled(label, state.dialect));
    return "comment";
  }
  if (!state?.notValidated) return "inline";
  const { dbms } = ctx.target;
  if (dbms === "oracle" || (dbms === "postgresql" && (kind === "check" || kind === "foreign"))) return "after";
  ctx.report.add(category, table.name, MSG.lossNotValidated(label, state.dialect));
  return "inline";
}

/** Suffixe d'une contrainte ajoutée sans valider les lignes existantes. */
export const notValidatedSuffix = (ctx: Context) => (ctx.target.dbms === "oracle" ? " ENABLE NOVALIDATE" : " NOT VALID");

/**
 * Contrainte placée selon son état ; renvoie la ligne à mettre dans le CREATE TABLE, ou `null`
 * (commentaire dans `after`, ou ALTER TABLE … NOT VALID / ENABLE NOVALIDATE après les tables).
 */
export function place(
  ctx: Context,
  table: LogicalTable,
  definition: string,
  where: Placement,
  after: string[],
  state: ConstraintState | undefined,
  required: () => string,
): string | null {
  if (where === "inline") return definition;
  if (where === "comment") after.push(`-- ${definition} -- ${MSG.disabledComment(state?.dialect)}`);
  else {
    const named = definition.startsWith("CONSTRAINT ") ? definition : `CONSTRAINT ${q(ctx, required())} ${definition}`;
    ctx.script.notValidated.push(`ALTER TABLE ${tableName(ctx, table)} ADD ${named}${notValidatedSuffix(ctx)};`);
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// Clés étrangères

function actions(ctx: Context, table: LogicalTable, fk: LogicalForeignKey, sqlServerGraph: CascadeGraph | null): string {
  const parts: string[] = [];
  for (const event of ["delete", "update"] as const) {
    let action = event === "delete" ? fk.onDelete : fk.onUpdate;
    if (!action) continue;
    // SQL Server refuse les chemins de cascade multiples ou cycliques.
    if (sqlServerGraph && ["cascade", "set null", "set default"].includes(action)) {
      if (!sqlServerGraph.accept(event, fk.referencedTable, table.name)) {
        ctx.report.add("action", table.name, MSG.lossCascadePath(event.toUpperCase(), action.toUpperCase()), fk.columns.join(", "));
        action = "no action";
      }
    }
    const result = referentialAction(ctx.target, event, action);
    if (result.kind === "emit") parts.push(result.sql);
    else if (result.kind === "degraded") {
      if (result.sql) parts.push(result.sql);
      ctx.report.add("action", table.name, MSG.lossAction(`ON ${event.toUpperCase()} ${action.toUpperCase()}`, result.fallback.toUpperCase()), fk.columns.join(", "));
    }
  }
  return parts.length ? ` ${parts.join(" ")}` : "";
}

export function foreignKey(ctx: Context, tables: LogicalTable[], table: LogicalTable, fk: LogicalForeignKey, graph: CascadeGraph | null): string {
  const name = constraintName(ctx, table, fk.name, "FK", [fk.referencedTable]);
  const referenced = tables.find((t) => t.name === fk.referencedTable);
  const columns = fk.columns.map((c) => columnRef(ctx, table, c)).join(", ");
  const refColumns = fk.referencedColumns.map((c) => (referenced ? columnRef(ctx, referenced, c) : q(ctx, c))).join(", ");
  const constraint = name ? `CONSTRAINT ${q(ctx, name)} ` : "";
  const state = stateClause(ctx, table, "foreign", foreignKeyLabel(fk), fk.state);
  return `${constraint}FOREIGN KEY(${columns}) REFERENCES ${tableRef(ctx, tables, fk.referencedTable)}(${refColumns})${actions(ctx, table, fk, graph)}${state}`;
}

export const foreignKeyLabel = (fk: LogicalForeignKey) => fk.name ?? `FOREIGN KEY(${fk.columns.join(", ")})`;

/**
 * Graphe des cascades SQL Server : une nouvelle cascade est refusée si elle crée un second chemin
 * entre deux tables, ou un cycle (y compris réflexif).
 */
export class CascadeGraph {
  private readonly edges: Record<"delete" | "update", Map<string, Set<string>>> = { delete: new Map(), update: new Map() };

  private reaches(event: "delete" | "update", from: string, to: string, seen = new Set<string>()): boolean {
    if (from === to) return true;
    if (seen.has(from)) return false;
    seen.add(from);
    for (const next of this.edges[event].get(from) ?? []) if (this.reaches(event, next, to, seen)) return true;
    return false;
  }

  accept(event: "delete" | "update", referenced: string, child: string): boolean {
    if (referenced === child || this.reaches(event, referenced, child) || this.reaches(event, child, referenced)) return false;
    const targets = this.edges[event].get(referenced) ?? new Set<string>();
    targets.add(child);
    this.edges[event].set(referenced, targets);
    return true;
  }
}

// ---------------------------------------------------------------------------------------------
// Identifiants alternatifs (UNIQUE)

/**
 * Contrainte UNIQUE dans le CREATE TABLE, ou `null` si elle devient un index unique en fin de
 * script (préfixe : sur expression) ou si la cible ne sait pas l'exprimer (signalé) (O-35).
 */
export function uniqueLine(ctx: Context, table: LogicalTable, unique: LogicalKey, after: string[]): string | null {
  const { dbms } = ctx.target;
  const mysql = dbms === "mysql" || dbms === "mariadb";
  const label = describeKey(unique);
  if (unique.method && unique.method !== "btree" && !mysql) {
    // Hors MySQL, une méthode autre que B-tree ne garantit pas l'unicité (PostgreSQL : HASH non unique).
    ctx.report.add("index", table.name, MSG.lossIndexMethod(unique.name ?? label, unique.method.toUpperCase()));
  }
  // Sur expression ou conditionnelle : index unique en fin de script (O-39).
  if (unique.expression || unique.where) {
    ctx.script.epilogue.push(...expressionIndex(ctx, table, unique));
    return null;
  }
  if (unique.prefixes && !mysql) {
    ctx.script.epilogue.push(...keyIndex(ctx, table, unique, true));
    return null;
  }
  // Plusieurs NULL admis (index filtré SQL Server « IS NOT NULL ») : vers SQL Server, même index filtré (O-41).
  if (unique.nulls === "distinct" && dbms === "sqlserver") {
    const filter = unique.columns.map((c) => `${columnRef(ctx, table, c)} IS NOT NULL`).join(" AND ");
    const indexName = q(ctx, constraintName(ctx, table, unique.name, "AK", unique.columns, true)!);
    ctx.script.epilogue.push(`CREATE UNIQUE INDEX ${indexName} ON ${tableName(ctx, table)}(${keyColumns(ctx, table, unique)}) WHERE ${filter};`);
    return null;
  }
  const where = placement(ctx, table, "unique", unique.name ?? label, unique.state);
  const name = constraintName(ctx, table, unique.name, "AK", unique.columns);
  const columns = keyColumns(ctx, table, unique);
  const method = mysql && unique.method ? ` USING ${unique.method.toUpperCase()}` : "";
  const equalNulls = unique.nulls === "not distinct" || unique.nulls === "oracle";
  const nulls = equalNulls ? nullsClause(ctx, table, unique) : "";
  if (!equalNulls) sqlServerNulls(ctx, table, unique.columns, unique.name ?? label);
  // Oracle : dans une clé composée, les NULL sont égaux entre eux (O-39).
  if (!equalNulls && dbms === "oracle" && unique.columns.length > 1 && unique.columns.some((c) => nullable(table, c))) {
    ctx.report.add("index", table.name, MSG.lossOracleCompositeNulls(unique.name ?? label));
  }
  // INCLUDE sur une contrainte UNIQUE : PostgreSQL 11+ seulement (O-42).
  const covering = unique.include?.length && dbms === "postgresql" ? include(ctx, table, unique) : "";
  if (unique.include?.length && !covering) ctx.report.add("index", table.name, MSG.lossInclude(unique.name ?? label));
  const state = stateClause(ctx, table, "unique", unique.name ?? label, unique.state);
  const definition = `${name ? `CONSTRAINT ${q(ctx, name)} ` : ""}UNIQUE${nulls}(${columns})${covering}${method}${state}`;
  return place(ctx, table, definition, where, after, unique.state, () => constraintName(ctx, table, undefined, "AK", unique.columns, true)!);
}

/** Colonne qui admet NULL (ni NOT NULL ni membre de la clé primaire). */
const nullable = (table: LogicalTable, name: string) => !table.primaryKey.includes(name) && !table.columns.find((c) => c.name === name)?.notNull;

/**
 * NULL égaux dans une clé composée (Oracle) ou NULLS NOT DISTINCT (PostgreSQL) (O-39) : PostgreSQL
 * 15+ l'exprime ; SQL Server et Oracle le font nativement ; ailleurs, signalé. Une ligne
 * entièrement NULL, qu'Oracle ignore, devient un doublon ailleurs : signalé si possible.
 */
function nullsClause(ctx: Context, table: LogicalTable, unique: LogicalKey): string {
  const { dbms, version } = ctx.target;
  const label = unique.name ?? describeKey(unique);
  const allNullable = unique.columns.every((c) => nullable(table, c));
  if (dbms === "oracle") {
    if (unique.nulls === "not distinct" && allNullable) ctx.report.add("index", table.name, MSG.lossNullsAllNull(label));
    return "";
  }
  if (unique.nulls === "oracle" && allNullable && (dbms === "postgresql" || dbms === "sqlserver")) ctx.report.add("index", table.name, MSG.lossNullsAllNull(label));
  if (dbms === "sqlserver") return "";
  if (dbms === "postgresql" && isAtLeast("postgresql", version, "15")) return " NULLS NOT DISTINCT";
  ctx.report.add("index", table.name, MSG.lossNullsNotDistinct(label));
  return "";
}

/** SQL Server : une contrainte UNIQUE n'admet qu'un seul NULL, contrairement aux autres SGBD (O-39). */
export function sqlServerNulls(ctx: Context, table: LogicalTable, columns: string[], label: string) {
  if (ctx.target.dbms !== "sqlserver") return;
  if (columns.some((name) => nullable(table, name))) ctx.report.add("index", table.name, MSG.lossSqlServerNulls(label));
}
