import type { SqlDialect } from "../model/physical";
import type { Catalog, CatalogTable } from "./catalog";
import { type Comparison, type Push, referencesOf, same, sameList } from "./catalogCompare";
import { diffColumn } from "./catalogDiffColumns";
import { diffChecks, diffForeignKeys, diffIndexes, diffUniques } from "./catalogDiffKeys";

export type DifferenceCategory =
  | "table"
  | "column"
  | "columnOrder"
  | "type"
  | "autoIncrement"
  | "notNull"
  | "default"
  | "primaryKey"
  | "foreignKey"
  | "action"
  | "unique"
  | "check"
  | "index"
  | "name"
  | "domain"
  | "range"
  | "collation"
  | "generated"
  | "onUpdate"
  | "comment"
  | "trigger"
  // O-39
  | "state"
  | "physical"
  | "sequence"
  | "emptyString";

export interface Difference {
  category: DifferenceCategory;
  table: string;
  column?: string;
  detail: string;
  /**
   * Colonne de clé étrangère : colonnes référencées, de proche en proche. Un écart de type ou de
   * plage y découle de la clé référencée, dont l'entrée du rapport le justifie (O-40).
   */
  references?: { table: string; column: string }[];
}

/**
 * Différences entre deux catalogues. `crossDialect` : les types sont comparés selon leur type
 * conceptuel, les noms sans tenir compte de la casse (le repli de casse diffère d'un SGBD à l'autre).
 */
export function diffCatalogs(
  source: Catalog,
  target: Catalog,
  crossDialect = false,
  targetDialect?: SqlDialect,
): Difference[] {
  const diffs: Difference[] = [];
  const cmp: Comparison = {
    source,
    crossDialect,
    affinityOnly: targetDialect === "sqlite",
    name: (a, b) => (crossDialect ? same(a, b) : a === b),
  };
  for (const s of source) {
    const t = target.find((x) => cmp.name(x.name, s.name));
    if (!t) {
      diffs.push({ category: "table", table: s.name, detail: "absente" });
      continue;
    }
    const push: Push = (category, detail, column) => {
      const references = column && (category === "type" || category === "range") ? referencesOf(source, s, column) : [];
      diffs.push({ category, table: s.name, column, detail, ...(references.length > 0 ? { references } : {}) });
    };
    diffTable(cmp, s, t, push);
  }
  for (const t of target) {
    if (!source.some((s) => cmp.name(s.name, t.name))) {
      diffs.push({ category: "table", table: t.name, detail: "en trop" });
    }
  }
  return diffs;
}

function diffTable(cmp: Comparison, s: CatalogTable, t: CatalogTable, push: Push) {
  const tColumns = t.columns.filter((c) => s.columns.some((x) => cmp.name(x.name, c.name)));
  if (
    !sameList(
      s.columns.map((c) => c.name),
      tColumns.map((c) => c.name),
    )
  ) {
    push("columnOrder", "ordre des colonnes");
  }
  for (const c of s.columns) {
    const d = t.columns.find((x) => cmp.name(x.name, c.name));
    if (d) {
      diffColumn(cmp, c, d, push);
    } else {
      push("column", "absente", c.name);
    }
  }
  diffTableProperties(s, t, push);
  diffTableContents(cmp, s, t, push);
  diffForeignKeys(cmp, s, t, push);
  diffUniques(cmp, s, t, push);
  diffChecks(cmp, s, t, push);
  diffIndexes(cmp, s, t, push);
}

/** Colonnes en trop, commentaire, déclencheurs, clé primaire. */
function diffTableContents(cmp: Comparison, s: CatalogTable, t: CatalogTable, push: Push) {
  for (const c of t.columns) {
    if (!s.columns.some((x) => cmp.name(x.name, c.name))) {
      push("column", "en trop", c.name);
    }
  }
  if ((s.comment ?? "") !== (t.comment ?? "")) {
    push("comment", "commentaire de table");
  }
  for (const trigger of s.triggers) {
    if (!t.triggers.includes(trigger)) {
      push("trigger", `déclencheur ${trigger} absent`);
    }
  }
  if (!sameList(s.primaryKey.columns, t.primaryKey.columns)) {
    push("primaryKey", `${s.primaryKey.columns} → ${t.primaryKey.columns}`);
  } else if (s.primaryKey.name && !cmp.name(s.primaryKey.name, t.primaryKey.name ?? "")) {
    push("name", `PK ${s.primaryKey.name} → ${t.primaryKey.name}`);
  }
}

function diffTableProperties(s: CatalogTable, t: CatalogTable, push: Push) {
  if (s.primaryKeyState !== t.primaryKeyState) {
    push("state", `PK ${s.primaryKeyState} → ${t.primaryKeyState}`);
  }
  if (s.schema !== t.schema) {
    push("name", `schéma ${s.schema} → ${t.schema}`);
  }
  if (JSON.stringify(s.storage ?? []) !== JSON.stringify(t.storage ?? [])) {
    push("physical", `stockage ${s.storage} → ${t.storage}`);
  }
  if ((s.partition ?? "") !== (t.partition ?? "")) {
    push("physical", `partitionnement ${s.partition} → ${t.partition}`);
  }
  if (JSON.stringify(s.sequences ?? []) !== JSON.stringify(t.sequences ?? [])) {
    push("sequence", `séquences ${s.sequences} → ${t.sequences}`);
  }
}
