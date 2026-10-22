import type { SqlDialect } from "../model/physical";
import { MSG } from "../validation/messages";
import { key, type ResolvedFk, sameColumns, within } from "./buildState";
import type { ParsedSchema, ParsedTable } from "./parse";

/** État des contraintes : vocabulaire du dialecte d'origine dans le rapport (O-42). */
export function markStateDialect(schema: ParsedSchema, dialect: SqlDialect) {
  for (const t of schema.tables) {
    for (const x of [
      ...t.checks,
      ...t.columns.flatMap((c) => (c.check ? [c.check] : [])),
      ...t.foreignKeys,
      ...t.uniques,
    ]) {
      if (x.state) {
        x.state.dialect = dialect;
      }
    }
    if (t.primaryKeyState) {
      t.primaryKeyState.dialect = dialect;
    }
  }
}

/** 1. Clés étrangères résolues (table et colonnes référencées existantes). */
export function resolveForeignKeys(schema: ParsedSchema, warnings: string[]): Map<ParsedTable, ResolvedFk[]> {
  const tables = new Map(schema.tables.map((t) => [key(t.name), t]));
  const fks = new Map<ParsedTable, ResolvedFk[]>();
  for (const table of schema.tables) {
    const resolved: ResolvedFk[] = [];
    for (const fk of table.foreignKeys) {
      const target = tables.get(key(fk.table));
      if (!target) {
        warnings.push(MSG.reverseUnknownTable(table.name, fk.table));
        continue;
      }
      const targetColumns = fk.referencedColumns.length > 0 ? fk.referencedColumns : target.primaryKey;
      if (targetColumns.length !== fk.columns.length) {
        warnings.push(MSG.reverseColumnMismatch(table.name, fk.table));
        continue;
      }
      resolved.push({ ...fk, referencedColumns: targetColumns, target });
    }
    fks.set(table, resolved);
  }
  return fks;
}

/** 2. Table d'association : clé primaire = union de clés étrangères (au moins deux). */
export function isJoinTable(table: ParsedTable, fks: Map<ParsedTable, ResolvedFk[]>) {
  const list = fks.get(table)!;
  if (table.primaryKey.length === 0 || list.length < 2) {
    return false;
  }
  if (!list.every((fk) => within(fk.columns, table.primaryKey))) {
    return false;
  }
  return within(
    table.primaryKey,
    list.flatMap((fk) => fk.columns),
  );
}

/**
 * 3. Héritages : tables dont la clé primaire est exactement une clé étrangère vers la clé
 *    primaire d'une seule autre table (aucune colonne propre dans la clé) : entité spécialisée,
 *    même seule (O-36). Les noms de colonnes peuvent différer (adherent_premium.adherent_id → adherent.id).
 */
export function inheritanceCandidates(
  schema: ParsedSchema,
  fks: Map<ParsedTable, ResolvedFk[]>,
  joinTables: Set<ParsedTable>,
) {
  const childrenOf = new Map<ParsedTable, ParsedTable[]>();
  const inheritanceFk = new Map<ParsedTable, ResolvedFk>();
  for (const table of schema.tables) {
    if (joinTables.has(table)) {
      continue;
    }
    const candidate = fks
      .get(table)!
      .find(
        (fk) =>
          fk.target !== table &&
          !joinTables.has(fk.target) &&
          sameColumns(fk.columns, table.primaryKey) &&
          sameColumns(fk.referencedColumns, fk.target.primaryKey),
      );
    if (!candidate) {
      continue;
    }
    childrenOf.set(candidate.target, [...(childrenOf.get(candidate.target) ?? []), table]);
    inheritanceFk.set(table, candidate);
  }
  return { childrenOf, inheritanceFk };
}
