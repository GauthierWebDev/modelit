import { DBMS_LIST } from "../dbms/dbms";
import { sqlType } from "../dbms/typeMapping";
import { GENERIC_VERSION } from "../dbms/versions";
import { hasErrors, type LogicalColumn, type LogicalForeignKey, type LogicalModel, type LogicalTable } from "../mld/logical";
import type { DdlOptions } from "../model/settings";
import { MSG } from "../validation/messages";
import { CascadeGraph, foreignKey, foreignKeyLabel, notValidatedSuffix, placement } from "./constraints";
import { createContext, DEFAULT_OPTIONS, type Context } from "./context";
import { sameDialect, supportsAlterForeignKey, type Target } from "./dialects";
import { keyIndex } from "./indexes";
import { formatLossGroup, groupLosses, type Loss } from "./losses";
import { tableName } from "./naming";
import { countSequenceUsers } from "./sequences";
import { createTable } from "./tables";

export { sameDialect } from "./dialects";
export { formatLossGroup, groupLosses, type Loss, type LossCategory, type LossGroup } from "./losses";

/**
 * Script LDD (override O-29).
 *
 *  - Tables triées selon leurs clés étrangères ; une clé étrangère qui ferme un cycle (hors
 *    réflexive) est ajoutée en fin de script par ALTER TABLE (ou toutes, en option).
 *  - Annotations physiques réappliquées quand la cible le permet : types et défauts d'origine,
 *    CHECK, identifiants alternatifs (UNIQUE), index, noms de contraintes, actions référentielles,
 *    identifiants entre guillemets (casse significative, caractères spéciaux, mots réservés).
 *  - Tout ce que la cible ne sait pas exprimer est abandonné ou dégradé, jamais en silence :
 *    rapport de pertes en tête de script et sous forme structurée (`losses`).
 *
 * Le script est assemblé ici ; chaque partie a son module : types des colonnes (types.ts),
 * colonnes (columns.ts), CHECK (checks.ts), contraintes (constraints.ts), index (indexes.ts),
 * séquences (sequences.ts), tables (tables.ts), noms (naming.ts), pertes (losses.ts).
 */

export type DdlResult = { ok: true; sql: string; losses: Loss[] } | { ok: false; error: string };

export interface SqlTarget extends Target {}

/**
 * Type affiché dans le MPD (O-59) : celui que le script émet le plus souvent — type de la colonne pour
 * ce dialecte (« type d'origine »), sinon type redéfini du SGBD personnalisé, sinon type du SGBD.
 * Les conversions fines du script (domaines, non-signés…) n'y figurent pas.
 */
export function displayedSqlType(column: Pick<LogicalColumn, "type" | "sourceType">, target: Target): string | null {
  if (column.sourceType && sameDialect(column.sourceType.dialect, target.dbms) && column.type?.kind !== "counter") return column.sourceType.sql;
  return column.type ? sqlType(column.type, target.dbms, target.version, target.custom?.types) : null;
}

/**
 * Tables triées selon les dépendances, de façon stable : à chaque étape, la première table (dans
 * l'ordre du modèle) dont toutes les tables référencées sont déjà créées. En cas de cycle, la
 * première table restante est créée quand même et ses références en avant sont différées
 * (ALTER TABLE en fin de script) — c'est ce qu'un script écrit à la main fait d'ordinaire.
 */
export function planOrder(tables: LogicalTable[], allInAlter: boolean): { order: LogicalTable[]; deferred: Set<LogicalForeignKey> } {
  const byName = new Map(tables.map((t) => [t.name.toLowerCase(), t]));
  const order: LogicalTable[] = [];
  const created = new Set<LogicalTable>();
  const deferred = new Set<LogicalForeignKey>(allInAlter ? tables.flatMap((t) => t.foreignKeys) : []);
  const pending = (table: LogicalTable) =>
    table.foreignKeys.filter((fk) => {
      const referenced = byName.get(fk.referencedTable.toLowerCase());
      return referenced && referenced !== table && !created.has(referenced);
    });
  while (order.length < tables.length) {
    const remaining = tables.filter((t) => !created.has(t));
    const next = remaining.find((t) => pending(t).length === 0) ?? remaining[0]!;
    pending(next).forEach((fk) => deferred.add(fk));
    created.add(next);
    order.push(next);
  }
  return { order, deferred };
}

/** Compatibilité : ordre des tables seul. */
export const orderByDependencies = (tables: LogicalTable[]) => planOrder(tables, false).order;

/** Corps du script : préambule, tables, clés étrangères différées, index, épilogue. */
function script(ctx: Context, model: LogicalModel): string {
  const tables = model.tables;
  countSequenceUsers(ctx, tables);
  const alterAll = ctx.options.foreignKeysInAlter;
  const canAlter = supportsAlterForeignKey(ctx.target);
  if (alterAll && !canAlter) ctx.report.add("option", "", MSG.lossAlterUnsupported());
  const { order, deferred } = planOrder(tables, alterAll && canAlter);
  // SQLite accepte les références vers des tables créées plus loin : tout reste en ligne.
  if (!canAlter) deferred.clear();
  const graph = ctx.target.dbms === "sqlserver" ? new CascadeGraph() : null;

  const statements = order.map((t) => createTable(ctx, tables, t, deferred, graph));
  for (const table of order) {
    for (const fk of table.foreignKeys) {
      if (!deferred.has(fk)) continue;
      const where = placement(ctx, table, "foreign", foreignKeyLabel(fk), fk.state);
      const alter = `ALTER TABLE ${tableName(ctx, table)} ADD ${foreignKey(ctx, tables, table, fk, graph)}`;
      if (where === "comment") statements.push(`-- ${alter}; -- ${MSG.disabledComment(fk.state?.dialect)}`);
      else statements.push(`${alter}${where === "after" ? notValidatedSuffix(ctx) : ""};`);
    }
  }
  // Clauses de stockage : une ligne du rapport pour toutes les tables concernées (O-39).
  const storage = [...new Set(order.flatMap((t) => t.storage ?? []))];
  if (storage.length) for (const table of order) if (table.storage?.length) ctx.report.add("physical", table.name, MSG.lossStorage(storage.join(", ")));
  const indexes = ctx.options.indexes ? order.flatMap((table) => table.indexes.flatMap((index) => keyIndex(ctx, table, index, false))) : [];
  // Extensions et collations d'abord, puis schémas, séquences et tables (O-42).
  const { preamble, schemas, notValidated, epilogue } = ctx.script;
  const head = preamble.filter((p) => /^CREATE (EXTENSION|COLLATION)/.test(p));
  const rest = preamble.filter((p) => !head.includes(p));
  return [...head, ...schemas, ...rest, ...statements, ...notValidated, ...indexes, ...epilogue].join("\n\n");
}

/** En-tête du script : rapport de pertes en commentaire SQL. */
function header(target: Target, losses: Loss[]): string {
  const label = `${DBMS_LIST.find((d) => d.id === target.dbms)?.label ?? target.dbms}${target.version && target.version !== GENERIC_VERSION ? ` ${target.version}` : ""}`;
  // SGBD personnalisé : toujours annoncé, pour qu'on sache que ce n'est plus le SGBD tel quel (O-59).
  const custom = target.custom ? [`-- ${MSG.customDbmsHeader(target.custom.name, label)}`, ""] : [];
  if (!losses.length) return custom.length ? [...custom, ""].join("\n") : "";
  const lines = groupLosses(losses).map((g) => `--   • ${formatLossGroup(g)}`);
  return [...custom, `-- ${MSG.lossHeader(target.custom?.name ?? label, losses.length)}`, ...lines, "", ""].join("\n");
}

export function generateDdl(model: LogicalModel, target: SqlTarget, options: Partial<DdlOptions> = {}): DdlResult {
  if (hasErrors(model)) return { ok: false, error: MSG.sqlBlocked };
  const ctx = createContext(target, { ...DEFAULT_OPTIONS, ...options });
  const body = script(ctx, model);
  const losses = ctx.report.entries;
  const sql = body ? `${header(target, losses)}${body}\n` : "";
  return { ok: true, sql, losses };
}
