import type { LogicalForeignKey, LogicalTable } from "../mld/logical";
import type { ConstraintState } from "../model/physical";
import { MSG } from "../validation/messages";
import type { Context } from "./context";
import { referentialAction } from "./dialects";
import { columnRef, constraintName, q, tableName, tableRef } from "./naming";
import type { ConstraintKind } from "./targets/dialect";

export type Placement = "inline" | "comment" | "after";

// ---------------------------------------------------------------------------------------------
// États des contraintes (O-39)

/** DEFERRABLE [INITIALLY …] pour la cible, ou rien (signalé si la source l'avait). */
export function stateClause(
  ctx: Context,
  table: LogicalTable,
  kind: ConstraintKind,
  label: string,
  state?: ConstraintState,
): string {
  if (!state?.deferrable || state.disabled) {
    return "";
  }
  if (!ctx.dialect.constraints.deferrable(kind)) {
    ctx.report.add(
      kind === "check" ? "check" : kind === "foreign" ? "action" : "index",
      table.name,
      kind === "check" ? MSG.lossDeferrableCheck(label) : MSG.lossDeferrable(label),
    );
    return "";
  }
  return state.deferrable === "deferred" ? " DEFERRABLE INITIALLY DEFERRED" : " DEFERRABLE INITIALLY IMMEDIATE";
}

/**
 * Place d'une contrainte selon son état : `inline` (dans le CREATE TABLE), `comment` (désactivée à
 * la source : émise en commentaire, signalée), `after` (non validée : ALTER TABLE … NOT VALID).
 */
export function placement(
  ctx: Context,
  table: LogicalTable,
  kind: ConstraintKind,
  label: string,
  state?: ConstraintState,
): Placement {
  const category = kind === "check" ? "check" : kind === "foreign" ? "action" : "index";
  if (state?.disabled) {
    ctx.report.add(category, table.name, MSG.lossDisabled(label, state.dialect));
    return "comment";
  }
  if (!state?.notValidated) {
    return "inline";
  }
  if (ctx.dialect.constraints.notValidated(kind)) {
    return "after";
  }
  ctx.report.add(category, table.name, MSG.lossNotValidated(label, state.dialect));
  return "inline";
}

/** Suffixe d'une contrainte ajoutée sans valider les lignes existantes. */
export const notValidatedSuffix = (ctx: Context) => ctx.dialect.constraints.notValidatedSuffix;

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
  if (where === "inline") {
    return definition;
  }
  if (where === "comment") {
    after.push(`-- ${definition} -- ${MSG.disabledComment(state?.dialect)}`);
  } else {
    const named = definition.startsWith("CONSTRAINT ") ? definition : `CONSTRAINT ${q(ctx, required())} ${definition}`;
    ctx.script.notValidated.push(`ALTER TABLE ${tableName(ctx, table)} ADD ${named}${notValidatedSuffix(ctx)};`);
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// Clés étrangères

function actions(
  ctx: Context,
  table: LogicalTable,
  fk: LogicalForeignKey,
  sqlServerGraph: CascadeGraph | null,
): string {
  const parts: string[] = [];
  for (const event of ["delete", "update"] as const) {
    const action = event === "delete" ? fk.onDelete : fk.onUpdate;
    if (action) {
      eventAction(ctx, table, fk, event, action, sqlServerGraph, parts);
    }
  }
  return parts.length > 0 ? ` ${parts.join(" ")}` : "";
}

/** ON DELETE / ON UPDATE pour la cible ; action dégradée ou chemin de cascade refusé signalés. */
function eventAction(
  ctx: Context,
  table: LogicalTable,
  fk: LogicalForeignKey,
  event: "delete" | "update",
  wanted: NonNullable<LogicalForeignKey["onDelete"]>,
  sqlServerGraph: CascadeGraph | null,
  parts: string[],
) {
  let action = wanted;
  // SQL Server refuse les chemins de cascade multiples ou cycliques.
  if (
    sqlServerGraph &&
    ["cascade", "set null", "set default"].includes(action) &&
    !sqlServerGraph.accept(event, fk.referencedTable, table.name)
  ) {
    ctx.report.add(
      "action",
      table.name,
      MSG.lossCascadePath(event.toUpperCase(), action.toUpperCase()),
      fk.columns.join(", "),
    );
    action = "no action";
  }
  const result = referentialAction(ctx.target, event, action);
  if (result.kind === "emit") {
    parts.push(result.sql);
  } else if (result.kind === "degraded") {
    if (result.sql) {
      parts.push(result.sql);
    }
    ctx.report.add(
      "action",
      table.name,
      MSG.lossAction(`ON ${event.toUpperCase()} ${action.toUpperCase()}`, result.fallback.toUpperCase()),
      fk.columns.join(", "),
    );
  }
}

export function foreignKey(
  ctx: Context,
  tables: LogicalTable[],
  table: LogicalTable,
  fk: LogicalForeignKey,
  graph: CascadeGraph | null,
): string {
  const name = constraintName(ctx, table, fk.name, "FK", [fk.referencedTable]);
  const referenced = tables.find((t) => t.name === fk.referencedTable);
  const columns = fk.columns.map((c) => columnRef(ctx, table, c)).join(", ");
  const refColumns = fk.referencedColumns
    .map((c) => (referenced ? columnRef(ctx, referenced, c) : q(ctx, c)))
    .join(", ");
  const constraint = name ? `CONSTRAINT ${q(ctx, name)} ` : "";
  const state = stateClause(ctx, table, "foreign", foreignKeyLabel(fk), fk.state);
  return `${constraint}FOREIGN KEY(${columns}) REFERENCES ${tableRef(ctx, tables, fk.referencedTable)}(${refColumns})${actions(ctx, table, fk, graph)}${state}`;
}

export const foreignKeyLabel = (fk: LogicalForeignKey) => fk.name ?? `FOREIGN KEY(${fk.columns.join(", ")})`;

/**
 * Graphe des cascades (SQL Server) : une nouvelle cascade est refusée si elle crée un second chemin
 * entre deux tables, ou un cycle (y compris réflexif).
 */
export class CascadeGraph {
  private readonly edges: Record<"delete" | "update", Map<string, Set<string>>> = {
    delete: new Map(),
    update: new Map(),
  };

  private reaches(event: "delete" | "update", from: string, to: string, seen = new Set<string>()): boolean {
    if (from === to) {
      return true;
    }
    if (seen.has(from)) {
      return false;
    }
    seen.add(from);
    for (const next of this.edges[event].get(from) ?? []) {
      if (this.reaches(event, next, to, seen)) {
        return true;
      }
    }
    return false;
  }

  accept(event: "delete" | "update", referenced: string, child: string): boolean {
    if (referenced === child || this.reaches(event, referenced, child) || this.reaches(event, child, referenced)) {
      return false;
    }
    const targets = this.edges[event].get(referenced) ?? new Set<string>();
    targets.add(child);
    this.edges[event].set(referenced, targets);
    return true;
  }
}
