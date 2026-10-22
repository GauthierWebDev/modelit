import type { Catalog, CatalogKey, CatalogTable } from "./catalog";
import type { DifferenceCategory } from "./catalogDiff";

/** Règles de comparaison de deux catalogues. */
export interface Comparison {
  source: Catalog;
  /** Noms comparés sans la casse entre dialectes, à l'identique sinon. */
  name: (a: string, b: string) => boolean;
  crossDialect: boolean;
  /** SQLite : seule l'affinité du type compte (ni longueur, ni plage, ni booléen). */
  affinityOnly: boolean;
}

/** Différence relevée sur la table en cours. */
export type Push = (category: DifferenceCategory, detail: string, column?: string) => void;

/** Colonnes référencées par une colonne de clé étrangère, de proche en proche (O-40). */
export function referencesOf(
  catalog: Catalog,
  table: CatalogTable,
  column: string,
): { table: string; column: string }[] {
  const result: { table: string; column: string }[] = [];
  const queue: { table: CatalogTable; column: string }[] = [{ table, column }];
  const seen = new Set([`${table.name}.${column}`.toLowerCase()]);
  while (queue.length > 0) {
    const { table: t, column: c } = queue.shift()!;
    for (const fk of t.foreignKeys) {
      const index = fk.columns.findIndex((x) => x.toLowerCase() === c.toLowerCase());
      const next = index >= 0 ? catalog.find((x) => x.name.toLowerCase() === fk.table.toLowerCase()) : undefined;
      if (!next) {
        continue;
      }
      const referenced = fk.referencedColumns[index]!;
      const key = `${next.name}.${referenced}`.toLowerCase();
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      result.push({ table: next.name, column: referenced });
      queue.push({ table: next, column: referenced });
    }
  }
  return result;
}

/** Plage cible acceptable : même borne basse, borne haute au moins aussi grande (type élargi). */
export function rangeCovers(source?: string, target?: string): boolean {
  if (source === target) {
    return true;
  }
  if (!(source?.startsWith("[") && target?.startsWith("["))) {
    return false;
  }
  const [smin, smax] = source
    .slice(1, -1)
    .split(", ")
    .map((x) => BigInt(x));
  const [tmin, tmax] = target
    .slice(1, -1)
    .split(", ")
    .map((x) => BigInt(x));
  return smin === tmin && tmax! >= smax!;
}

export const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

export const sameList = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => same(x, b[i]!));

export const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.some((y) => same(x, y)));

export const sameKey = (a: CatalogKey, b: CatalogKey) =>
  sameSet(a.columns, b.columns) &&
  JSON.stringify(a.prefixes ?? null) === JSON.stringify(b.prefixes ?? null) &&
  (a.kind ?? "") === (b.kind ?? "") &&
  (a.expression ?? "") === (b.expression ?? "") &&
  (a.where ?? "") === (b.where ?? "");
