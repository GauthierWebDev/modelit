import type { SqlDialect } from "../model/physical";
import type { Catalog, CatalogKey, CatalogTable } from "./catalog";

/** Colonnes référencées par une colonne de clé étrangère, de proche en proche (O-40). */
function referencesOf(catalog: Catalog, table: CatalogTable, column: string): { table: string; column: string }[] {
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
function rangeCovers(source?: string, target?: string): boolean {
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

// ---------------------------------------------------------------------------------------------
// Différences

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

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

const sameList = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => same(x, b[i]!));

const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.some((y) => same(x, y)));

const sameKey = (a: CatalogKey, b: CatalogKey) =>
  sameSet(a.columns, b.columns) &&
  JSON.stringify(a.prefixes ?? null) === JSON.stringify(b.prefixes ?? null) &&
  (a.kind ?? "") === (b.kind ?? "") &&
  (a.expression ?? "") === (b.expression ?? "") &&
  (a.where ?? "") === (b.where ?? "");

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
  // SQLite : seule l'affinité du type compte (ni longueur, ni plage, ni booléen).
  const affinityOnly = targetDialect === "sqlite";
  const name = (a: string, b: string) => (crossDialect ? same(a, b) : a === b);
  for (const s of source) {
    const t = target.find((x) => name(x.name, s.name));
    if (!t) {
      diffs.push({ category: "table", table: s.name, detail: "absente" });
      continue;
    }
    const push = (category: DifferenceCategory, detail: string, column?: string) => {
      const references = column && (category === "type" || category === "range") ? referencesOf(source, s, column) : [];
      diffs.push({ category, table: s.name, column, detail, ...(references.length > 0 ? { references } : {}) });
    };
    const tColumns = t.columns.filter((c) => s.columns.some((x) => name(x.name, c.name)));
    if (
      !sameList(
        s.columns.map((c) => c.name),
        tColumns.map((c) => c.name),
      )
    ) {
      push("columnOrder", "ordre des colonnes");
    }
    for (const c of s.columns) {
      const d = t.columns.find((x) => name(x.name, c.name));
      if (!d) {
        push("column", "absente", c.name);
        continue;
      }
      // Colonne calculée sans type déclaré (SQL Server) : son type découle de l'expression (O-41).
      const typeless = Boolean(c.generated) && c.concept === "null";
      const typeOk =
        typeless ||
        (affinityOnly
          ? c.affinity === d.affinity || Boolean(c.domain && d.domain)
          : crossDialect
            ? c.concept === d.concept
            : c.type === d.type);
      if (!typeOk) {
        push("type", `${c.type} → ${d.type}`, c.name);
      }
      if (c.autoIncrement !== d.autoIncrement && !(crossDialect && /serial|identity/i.test(d.type))) {
        push("autoIncrement", `${c.autoIncrement} → ${d.autoIncrement}`, c.name);
      }
      if (c.notNull !== d.notNull) {
        push("notNull", `${c.notNull} → ${d.notNull}`, c.name);
      }
      if (c.default !== d.default) {
        push("default", `${c.default} → ${d.default}`, c.name);
      }
      if (c.domain !== d.domain) {
        push("domain", `${c.domain} → ${d.domain}`, c.name);
      }
      if (crossDialect && !affinityOnly && !typeless && !rangeCovers(c.range, d.range)) {
        push("range", `${c.range} → ${d.range}`, c.name);
      }
      // Collation : comparée quand la source en a une effective (sinon : celle de l'installation, inconnue).
      if (c.collation && c.collation !== (d.collation ?? d.defaultCollation)) {
        push("collation", `${c.collation} → ${d.collation ?? d.defaultCollation}`, c.name);
      }
      if (c.generated !== d.generated) {
        push("generated", `${c.generated} → ${d.generated}`, c.name);
      }
      if (c.onUpdate !== d.onUpdate) {
        push("onUpdate", `${c.onUpdate} → ${d.onUpdate}`, c.name);
      }
      if (c.identityStart !== d.identityStart) {
        push("autoIncrement", `début ${c.identityStart} → ${d.identityStart}`, c.name);
      }
      if (c.identityIncrement !== d.identityIncrement) {
        push("autoIncrement", `pas ${c.identityIncrement} → ${d.identityIncrement}`, c.name);
      }
      if ((c.comment ?? "") !== (d.comment ?? "")) {
        push("comment", `${c.comment} → ${d.comment}`, c.name);
      }
      if (c.identity !== d.identity) {
        push("autoIncrement", `identité ${c.identity ?? "by default"} → ${d.identity ?? "by default"}`, c.name);
      }
      if (c.sequence !== d.sequence) {
        push("sequence", `séquence ${c.sequence} → ${d.sequence}`, c.name);
      }
      if (c.emptyString && d.emptyString && c.emptyString !== d.emptyString) {
        push("emptyString", `'' ${c.emptyString} → ${d.emptyString}`, c.name);
      }
      if (c.lengthSemantics && d.lengthSemantics && c.lengthSemantics !== d.lengthSemantics) {
        push("type", `longueur ${c.lengthSemantics} → ${d.lengthSemantics}`, c.name);
      }
    }
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
    for (const c of t.columns) {
      if (!s.columns.some((x) => name(x.name, c.name))) {
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
    } else if (s.primaryKey.name && !name(s.primaryKey.name, t.primaryKey.name ?? "")) {
      push("name", `PK ${s.primaryKey.name} → ${t.primaryKey.name}`);
    }

    for (const fk of s.foreignKeys) {
      const match = t.foreignKeys.find(
        (x) =>
          sameList(x.columns, fk.columns) &&
          same(x.table, fk.table) &&
          sameList(x.referencedColumns, fk.referencedColumns),
      );
      if (!match) {
        push("foreignKey", `FK (${fk.columns}) → ${fk.table}(${fk.referencedColumns}) absente`);
        continue;
      }
      const columns = fk.columns.join(", ");
      if (match.onDelete !== fk.onDelete) {
        push("action", `ON DELETE ${fk.onDelete} → ${match.onDelete}`, columns);
      }
      if (match.onUpdate !== fk.onUpdate) {
        push("action", `ON UPDATE ${fk.onUpdate} → ${match.onUpdate}`, columns);
      }
      if (fk.name && !name(fk.name, match.name ?? "")) {
        push("name", `FK ${fk.name} → ${match.name}`);
      }
      if (fk.state !== match.state) {
        push("state", `FK ${fk.name ?? columns} ${fk.state} → ${match.state}`);
      }
    }
    if (t.foreignKeys.length !== s.foreignKeys.length) {
      push("foreignKey", `${s.foreignKeys.length} → ${t.foreignKeys.length} clés étrangères`);
    }

    for (const u of s.uniques) {
      const match = t.uniques.find((x) => sameKey(x, u));
      if (match) {
        if (u.name && !name(u.name, match.name ?? "")) {
          push("name", `UNIQUE ${u.name} → ${match.name}`);
        }
        if ((u.method ?? "") !== (match.method ?? "")) {
          push("index", `méthode ${u.method} → ${match.method}`);
        }
        if (u.nulls !== match.nulls) {
          push("unique", `UNIQUE ${u.name ?? u.columns} NULL ${u.nulls} → ${match.nulls}`);
        }
        if (u.state !== match.state) {
          push("state", `UNIQUE ${u.name ?? u.columns} ${u.state} → ${match.state}`);
        }
      } else {
        push("unique", `UNIQUE (${u.columns}) absent`);
      }
    }
    for (const u of t.uniques) {
      if (!s.uniques.some((x) => sameKey(x, u))) {
        push("unique", `UNIQUE (${u.columns}) en trop`);
      }
    }

    for (const c of s.checks) {
      const match = t.checks.find((x) => x.expression === c.expression);
      if (match) {
        if (c.name && !name(c.name, match.name ?? "")) {
          push("name", `CHECK ${c.name} → ${match.name}`);
        }
        if (c.state !== match.state) {
          push("state", `CHECK ${c.name ?? c.expression} ${c.state} → ${match.state}`);
        }
      } else {
        push("check", `CHECK ${c.expression} absent ou modifié`);
      }
    }
    for (const c of t.checks) {
      if (!s.checks.some((x) => x.expression === c.expression)) {
        push("check", `CHECK ${c.expression} en trop`);
      }
    }

    for (const i of s.indexes) {
      const match = t.indexes.find((x) => sameKey(x, i) && sameList(x.columns, i.columns));
      if (match) {
        if (i.name && !name(i.name, match.name ?? "")) {
          push("name", `index ${i.name} → ${match.name}`);
        }
        if ((i.method ?? "") !== (match.method ?? "")) {
          push("index", `méthode ${i.method} → ${match.method}`);
        }
      } else {
        push("index", `index (${i.columns}) absent`);
      }
    }
    if (t.indexes.length !== s.indexes.length) {
      push("index", `${s.indexes.length} → ${t.indexes.length} index`);
    }
  }
  for (const t of target) {
    if (!source.some((s) => name(s.name, t.name))) {
      diffs.push({ category: "table", table: t.name, detail: "en trop" });
    }
  }
  return diffs;
}
