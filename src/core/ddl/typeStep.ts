import type { LogicalColumn, LogicalTable } from "../mld/logical";
import type { Context } from "./context";
import { sameDialect } from "./dialects";
import { columnRef } from "./naming";
import { collationClause } from "./typeCollations";

/** Catégories du rapport de pertes qu'alimente le choix du type. */
export type TypeLoss = "type" | "domain" | "unsigned" | "autoIncrement";

/** Type émis pour une colonne, et CHECK qu'il implique. */
export interface TypeResult {
  sql: string | null;
  checks: string[];
}

/** Ce que partagent les étapes du choix du type d'une colonne (typeOf). */
export interface TypeStep {
  readonly ctx: Context;
  readonly table: LogicalTable;
  readonly column: LogicalColumn;
  /** CHECK impliqués par le type, dans l'ordre d'émission. */
  readonly checks: string[];
  readonly source: LogicalColumn["sourceType"];
  /** Source et cible du même dialecte : le type d'origine est réémis. */
  readonly same: boolean;
  /** Clause COLLATE (précédée de son espace), ou chaîne vide. */
  readonly collate: string;
  /** Colonne citée dans un CHECK. */
  readonly ref: () => string;
  /** Écart signalé au rapport, sur la colonne. */
  readonly loss: (category: TypeLoss, message: string) => void;
}

/** Contexte des étapes ; la clause COLLATE est calculée d'emblée (elle peut signaler une perte). */
export function typeStep(ctx: Context, table: LogicalTable, column: LogicalColumn): TypeStep {
  const source = column.sourceType;
  const same = Boolean(source && sameDialect(source.dialect, ctx.target.dbms));
  return {
    ctx,
    table,
    column,
    checks: [],
    source,
    same,
    collate: collationClause(ctx, table, column, same ? source?.dialect : column.sourceType?.dialect),
    ref: () => columnRef(ctx, table, column.name),
    loss: (category, message) => {
      ctx.report.add(category, table.name, message, column.name);
    },
  };
}
