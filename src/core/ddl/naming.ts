import type { LogicalTable } from "../mld/logical";
import { MSG } from "../validation/messages";
import type { Context } from "./context";
import { fitName, quoteIdentifier } from "./dialects";

/** Identifiant écrit pour la cible (délimité si besoin). */
export function q(ctx: Context, name: string, caseSensitive = false) {
  return quoteIdentifier(ctx.target, name, caseSensitive);
}

export function columnRef(ctx: Context, table: LogicalTable, name: string) {
  const column = table.columns.find((c) => c.name === name);
  return q(ctx, name, column?.caseSensitive);
}

export function tableRef(ctx: Context, tables: LogicalTable[], name: string) {
  const table = tables.find((t) => t.name === name);
  return table ? tableName(ctx, table) : q(ctx, name);
}

/** Schéma de la cible pour un schéma source (dbo → public, selon l'option) ; `undefined` : schéma par défaut (O-42). */
export function schemaOf(ctx: Context, schema: string | undefined): string | undefined {
  const rules = ctx.dialect.schemas;
  if (!schema || !rules) return undefined;
  const lower = schema.toLowerCase();
  if (lower === "dbo") return rules.existing === "dbo" || ctx.options.dboSchema === "dbo" ? "dbo" : undefined;
  return lower === rules.omitted ? undefined : schema;
}

/** Nom qualifié par son schéma, s'il y en a un (ref.aeroport, ref.seq_client) (O-42). */
export function qualifiedName(ctx: Context, schema: string | undefined, name: string, caseSensitive = false): string {
  const target = schemaOf(ctx, schema);
  return `${target ? `${q(ctx, target)}.` : ""}${q(ctx, name, caseSensitive)}`;
}

export const tableName = (ctx: Context, table: LogicalTable) => qualifiedName(ctx, table.schema, table.name, table.caseSensitive);

/** Nom de contrainte : explicite (raccourci si besoin), ou généré selon l'option, ou aucun. */
export function constraintName(
  ctx: Context,
  table: LogicalTable,
  explicit: string | undefined,
  kind: "PK" | "FK" | "AK" | "CK" | "IX",
  parts: string[],
  required = false,
): string | undefined {
  const naming = ctx.options.constraintNaming;
  let name = explicit;
  if (!name && (naming !== "none" || required)) {
    const base = [table.name, ...parts].join("_");
    name = naming === "suffix" ? `${base}_${kind}` : `${kind}_${base}`;
    if (kind === "IX" && naming === "none") name = `idx_${base}`;
    let unique = name;
    for (let i = 2; ctx.used.names.has(unique.toLowerCase()); i++) unique = `${name}_${i}`;
    name = unique;
  }
  if (!name) return undefined;
  const fitted = fitName(name, ctx.maxName);
  if (fitted !== name && explicit) ctx.report.add("name", table.name, MSG.lossName(name, fitted, ctx.maxName));
  ctx.used.names.add(fitted.toLowerCase());
  return fitted;
}

/** CREATE SCHEMA en tête de script pour tout schéma source autre que celui par défaut (O-42). */
export function declareSchema(ctx: Context, schema: string | undefined, table: LogicalTable) {
  if (!schema) return;
  const rules = ctx.dialect.schemas;
  const target = schemaOf(ctx, schema);
  if (!rules || !target) {
    if (!rules && !["dbo", "public"].includes(schema.toLowerCase())) ctx.report.add("name", table.name, MSG.lossSchema(schema));
    return;
  }
  const lower = target.toLowerCase();
  if (ctx.used.schemas.has(lower) || lower === rules.existing) return;
  ctx.used.schemas.add(lower);
  ctx.script.schemas.push(rules.create(target, q(ctx, target)));
}
