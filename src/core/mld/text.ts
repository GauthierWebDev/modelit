import type { LogicalModel, LogicalTable } from "./logical";

/**
 * MLD textuel : `Table = (pk1, pk2, attr, #fk1, …);`
 * Rendu structuré : la clé primaire est soulignée et en gras par l'interface, les colonnes
 * uniques en gras, les clés étrangères préfixées par `#`, en italique et en couleur.
 */
export interface MldColumnToken {
  name: string;
  primaryKey: boolean;
  /** Unique à elle seule (UNIQUE, ou contrainte d'unicité sur cette seule colonne entière). */
  unique: boolean;
  foreign: boolean;
}

export interface MldLine {
  table: string;
  columns: MldColumnToken[];
}

/**
 * Colonnes uniques à elles seules : UNIQUE de colonne, ou contrainte d'unicité sur cette seule
 * colonne entière, sans condition ni expression.
 */
export function uniqueColumnNames(table: LogicalTable): Set<string> {
  const names = new Set(table.columns.filter((c) => c.unique).map((c) => c.name));
  for (const k of table.uniques) {
    if (k.columns.length === 1 && !k.prefixes?.[0] && !k.expression && !k.where) {
      names.add(k.columns[0]!);
    }
  }
  return names;
}

export function mldLines(model: LogicalModel): MldLine[] {
  return model.tables.map((t) => {
    const uniqueColumns = uniqueColumnNames(t);
    return {
      table: t.name,
      columns: t.columns.map((c) => ({
        name: c.name,
        primaryKey: t.primaryKey.includes(c.name),
        unique: uniqueColumns.has(c.name),
        foreign: c.foreign,
      })),
    };
  });
}

/** Version texte brut (copie, export) : pas de soulignement possible, la clé est entourée de `_`. */
export function mldPlainText(model: LogicalModel): string {
  return mldLines(model)
    .map((line) => {
      const cols = line.columns.map((c) => {
        const name = `${c.foreign ? "#" : ""}${c.name}`;
        return c.primaryKey ? `_${name}_` : name;
      });
      return `${line.table} = (${cols.join(", ")});`;
    })
    .join("\n");
}
