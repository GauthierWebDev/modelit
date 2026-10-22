import type { Attribute, Entity, Link, ModelDocument } from "../model/document";
import type { SqlDialect } from "../model/physical";
import type { ParsedForeignKey, ParsedKey, ParsedSchema, ParsedTable } from "./parse";

/** Clé étrangère résolue : table et colonnes référencées existantes. */
export type ResolvedFk = ParsedForeignKey & { target: ParsedTable; referencedColumns: string[] };

/** État de la reconstruction du MCD (reverseEngineer), partagé par ses phases. */
export interface Build {
  readonly schema: ParsedSchema;
  readonly dialect: SqlDialect;
  readonly doc: ModelDocument;
  readonly warnings: string[];
  readonly fks: Map<ParsedTable, ResolvedFk[]>;
  /** Tables d'association (clé primaire = union de clés étrangères). */
  readonly joinTables: Set<ParsedTable>;
  readonly entities: Map<ParsedTable, Entity>;
  /** Rubriques de chaque table, par nom de colonne (minuscules). */
  readonly attributeOf: Map<ParsedTable, Map<string, Attribute>>;
  /** Patte de l'entité référencée de chaque clé étrangère (membres des UNIQUE et index). */
  readonly referenceLink: Map<ResolvedFk, Link>;
  /** Noms d'associations déjà attribués (minuscules). */
  readonly usedNames: Set<string>;
  /** Noms des tables (minuscules). */
  readonly entityNames: Set<string>;
}

export const key = (name: string) => name.toLowerCase();
export const sameColumns = (a: string[], b: string[]) =>
  a.length === b.length && a.every((x) => b.some((y) => key(y) === key(x)));
export const within = (columns: string[], set: string[]) => columns.every((c) => set.some((s) => key(s) === key(c)));

/** Rubrique d'origine d'une colonne de clé (en remontant les clés étrangères). */
export function originOf(
  b: Build,
  table: ParsedTable,
  column: string,
  seen = new Set<ParsedTable>(),
): Attribute | undefined {
  const own = b.attributeOf.get(table)?.get(key(column));
  if (own || seen.has(table)) {
    return own;
  }
  seen.add(table);
  for (const fk of b.fks.get(table)!) {
    const index = fk.columns.findIndex((c) => key(c) === key(column));
    if (index >= 0) {
      return originOf(b, fk.target, fk.referencedColumns[index]!, seen);
    }
  }
  return undefined;
}

/** UNIQUE simple : sur des colonnes entières, sans expression ni condition (O-35, O-39). */
export const plainKey = (k: ParsedKey) =>
  !(k.prefixes || k.expression || k.where || k.state || k.nullsNotDistinct || k.nullsDistinct);

/** Préfixes et méthode d'un index ou d'une contrainte UNIQUE (s'ils sont présents). */
export function keyOptions(k: ParsedKey) {
  return { ...(k.prefixes ? { prefixes: k.prefixes } : {}), ...(k.method ? { method: k.method } : {}) };
}

/** Clés étrangères dans l'ordre de la clé primaire. */
export function orderByKey<T extends ParsedForeignKey>(list: T[], primaryKey: string[]): T[] {
  const position = (fk: T) => Math.min(...fk.columns.map((c) => primaryKey.findIndex((p) => key(p) === key(c))));
  return [...list].sort((a, b) => position(a) - position(b));
}
