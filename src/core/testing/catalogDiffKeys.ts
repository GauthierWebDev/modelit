import type { CatalogKey, CatalogTable } from "./catalog";
import { type Comparison, type Push, same, sameKey, sameList } from "./catalogCompare";

export function diffForeignKeys(cmp: Comparison, s: CatalogTable, t: CatalogTable, push: Push) {
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
    if (fk.name && !cmp.name(fk.name, match.name ?? "")) {
      push("name", `FK ${fk.name} → ${match.name}`);
    }
    if (fk.state !== match.state) {
      push("state", `FK ${fk.name ?? columns} ${fk.state} → ${match.state}`);
    }
  }
  if (t.foreignKeys.length !== s.foreignKeys.length) {
    push("foreignKey", `${s.foreignKeys.length} → ${t.foreignKeys.length} clés étrangères`);
  }
}

export function diffUniques(cmp: Comparison, s: CatalogTable, t: CatalogTable, push: Push) {
  for (const u of s.uniques) {
    const match = t.uniques.find((x) => sameKey(x, u));
    if (match) {
      diffUnique(cmp, u, match, push);
    } else {
      push("unique", `UNIQUE (${u.columns}) absent`);
    }
  }
  for (const u of t.uniques) {
    if (!s.uniques.some((x) => sameKey(x, u))) {
      push("unique", `UNIQUE (${u.columns}) en trop`);
    }
  }
}

function diffUnique(cmp: Comparison, u: CatalogKey, match: CatalogKey, push: Push) {
  if (u.name && !cmp.name(u.name, match.name ?? "")) {
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
}

export function diffChecks(cmp: Comparison, s: CatalogTable, t: CatalogTable, push: Push) {
  for (const c of s.checks) {
    const match = t.checks.find((x) => x.expression === c.expression);
    if (!match) {
      push("check", `CHECK ${c.expression} absent ou modifié`);
      continue;
    }
    if (c.name && !cmp.name(c.name, match.name ?? "")) {
      push("name", `CHECK ${c.name} → ${match.name}`);
    }
    if (c.state !== match.state) {
      push("state", `CHECK ${c.name ?? c.expression} ${c.state} → ${match.state}`);
    }
  }
  for (const c of t.checks) {
    if (!s.checks.some((x) => x.expression === c.expression)) {
      push("check", `CHECK ${c.expression} en trop`);
    }
  }
}

export function diffIndexes(cmp: Comparison, s: CatalogTable, t: CatalogTable, push: Push) {
  for (const i of s.indexes) {
    const match = t.indexes.find((x) => sameKey(x, i) && sameList(x.columns, i.columns));
    if (!match) {
      push("index", `index (${i.columns}) absent`);
      continue;
    }
    if (i.name && !cmp.name(i.name, match.name ?? "")) {
      push("name", `index ${i.name} → ${match.name}`);
    }
    if ((i.method ?? "") !== (match.method ?? "")) {
      push("index", `méthode ${i.method} → ${match.method}`);
    }
  }
  if (t.indexes.length !== s.indexes.length) {
    push("index", `${s.indexes.length} → ${t.indexes.length} index`);
  }
}
