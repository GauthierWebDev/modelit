import type { ReferentialAction, SqlDialect } from "../model/physical";
import { parseSql } from "../reverse/parse";
import { tableCatalog } from "./catalogTable";

/**
 * Catalogue normalisé d'un script LDD (overrides O-29, O-35) : ce qu'une base créée par ce script
 * contiendrait, indépendamment de la façon de l'écrire (contrainte en ligne ou de table, casse
 * des mots-clés, espaces, parenthèses, dialecte…). Sert aux tests d'aller-retour et au contrôle
 * du rapport de pertes : toute différence entre la source et la cible doit y figurer.
 *
 * Équivalences reconnues des deux côtés (O-35) : ENUM ≡ texte + CHECK (col IN …) ≡ type énuméré ;
 * SET ≡ text[] + CHECK (col <@ ARRAY[…]) ; entiers et décimaux comparés par leur plage (UNSIGNED,
 * CHECK (col >= 0)) ; collation binaire (`*_bin`, `C`) ; préfixe `col(n)` ≡ `left(col, n)` ;
 * FULLTEXT ≡ GIN (to_tsvector) ; DEFAULT NULL ≡ pas de défaut ; 0 / 1 ≡ FALSE / TRUE d'un booléen.
 */

export { type Difference, diffCatalogs } from "./catalogDiff";

export interface CatalogColumn {
  name: string;
  type: string;
  /** Type conceptuel (JSON), lu selon le dialecte : sert aux comparaisons inter-dialectes. */
  concept: string;
  autoIncrement: boolean;
  notNull: boolean;
  default?: string;
  /** Domaine énuméré : `enum:a|b` ou `set:a|b`. */
  domain?: string;
  /** Plage de valeurs d'un nombre (entiers : bornes ; décimaux : « ≥ 0 » ou non). */
  range?: string;
  /**
   * Classe de comparaison de la collation effective (colonne, sinon table, sinon base) :
   * binary, sensitive, ci, ai_ci, ou le nom d'une collation particulière.
   */
  collation?: string;
  /** Classe appliquée sans collation déclarée, selon le SGBD. */
  defaultCollation?: string;
  /** Affinité SQLite du type déclaré (SQLite ne connaît que ces affinités). */
  affinity: string;
  /** Colonne calculée : `stored` ou `virtual`. */
  generated?: string;
  onUpdate?: string;
  identityStart?: number;
  /** Pas du compteur, s'il diffère de 1 (O-41). */
  identityIncrement?: number;
  comment?: string;
  // O-39
  /** Identité GENERATED ALWAYS / BY DEFAULT ON NULL (absente : BY DEFAULT, auto-incrément). */
  identity?: string;
  /** Séquence qui fournit la valeur par défaut (`nom`, ou `nom/on null`, `nom/always` par déclencheur). */
  sequence?: string;
  /** Chaîne vide : vaut NULL (Oracle, colonne facultative), refusée (NOT NULL Oracle, CHECK), ou valeur. */
  emptyString?: "null" | "rejected" | "value";
  /** Longueur d'un texte : en octets, en caractères, ou selon NLS_LENGTH_SEMANTICS (Oracle). */
  lengthSemantics?: "byte" | "char" | "nls";
}

export interface CatalogKey {
  name?: string;
  columns: string[];
  prefixes?: (number | null)[];
  method?: string;
  kind?: string;
  // O-39
  expression?: string;
  where?: string;
  /** NULL égaux entre eux : `not distinct` ; `oracle` : sauf ligne entièrement NULL (ignorée). */
  nulls?: string;
  state?: string;
}

export interface CatalogForeignKey extends CatalogKey {
  table: string;
  referencedColumns: string[];
  onDelete: ReferentialAction;
  onUpdate: ReferentialAction;
}

export interface CatalogCheck {
  name?: string;
  expression: string;
  state?: string;
}

export interface CatalogTable {
  name: string;
  columns: CatalogColumn[];
  primaryKey: CatalogKey;
  foreignKeys: CatalogForeignKey[];
  uniques: CatalogKey[];
  checks: CatalogCheck[];
  indexes: CatalogKey[];
  comment?: string;
  triggers: string[];
  // O-39
  primaryKeyState?: string;
  storage?: string[];
  partition?: string;
  /** Séquences utilisées par les colonnes de la table. */
  sequences?: string[];
  /** Schéma, hors schéma par défaut (dbo, public) (O-42). */
  schema?: string;
}

export type Catalog = CatalogTable[];

export function catalogOf(sql: string, dialect: SqlDialect): Catalog {
  const schema = parseSql(sql, dialect);
  const tables = new Map(schema.tables.map((t) => [t.name.toLowerCase(), t]));
  const database = { collation: schema.defaultCollation, collations: schema.collations };
  const catalog = schema.tables
    .map((t) => tableCatalog(t, tables, dialect, schema.enumTypes, database, schema.sequences))
    .sort((a, b) => a.name.localeCompare(b.name));
  propagateForeignRanges(catalog);
  return catalog;
}

/**
 * Une colonne de clé étrangère ne prend que des valeurs de la colonne référencée : elle en hérite
 * la borne basse (ex. FK vers un identifiant non négatif) (O-37).
 */
function propagateForeignRanges(catalog: Catalog) {
  const parse = (range?: string) =>
    range?.startsWith("[")
      ? range
          .slice(1, -1)
          .split(", ")
          .map((x) => BigInt(x))
      : null;
  for (let changed = true, pass = 0; changed && pass < 10; pass += 1) {
    changed = false;
    for (const table of catalog) {
      for (const fk of table.foreignKeys) {
        const target = catalog.find((t) => t.name.toLowerCase() === fk.table.toLowerCase());
        fk.columns.forEach((name, i) => {
          const column = table.columns.find((c) => c.name.toLowerCase() === name.toLowerCase());
          const referenced = target?.columns.find(
            (c) => c.name.toLowerCase() === fk.referencedColumns[i]?.toLowerCase(),
          );
          const own = parse(column?.range);
          const ref = parse(referenced?.range);
          if (!(column && own && ref) || own[0]! >= ref[0]!) {
            return;
          }
          column.range = `[${ref[0]}, ${own[1]}]`;
          changed = true;
        });
      }
    }
  }
}
