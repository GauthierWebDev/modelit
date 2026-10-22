import type { ConstraintState, ReferentialAction, SequenceDefinition, SqlDialect } from "../model/physical";
import { Cursor, isPunct, isWord, joinRaw } from "./cursor";
import { alterTable } from "./parseAlter";
import { createIndex } from "./parseIndexes";
import { alterSequence, createSequence, resolveSequences } from "./parseSequences";
import {
  commentOn,
  createCollation,
  createDatabase,
  createTrigger,
  createType,
  extendedProperty,
} from "./parseStatements";
import { createTable } from "./parseTables";
import { splitStatements, type Token, tokenize } from "./tokenize";

/**
 * Lecture d'un script SQL de création (overrides O-28, O-29), quel que soit le SGBD et sa version.
 *
 * Tout ce qui décrit les tables est conservé : colonnes, types exacts, NOT NULL, DEFAULT,
 * auto-incrément, clés primaires, UNIQUE, clés étrangères (toutes actions), CHECK, index,
 * noms de contraintes, noms entre guillemets, commentaires ; ALTER TABLE … ADD / MODIFY / CHANGE
 * / ALTER COLUMN (formes de pg_dump et mysqldump) ; CREATE [UNIQUE] INDEX ; COMMENT ON.
 * Ignoré sans erreur : le reste (vues, fonctions, déclencheurs, séquences, droits, données…).
 */

export interface NamedExpression {
  name?: string;
  expression: string;
  state?: ConstraintState;
}

export interface ParsedColumn {
  name: string;
  /** Nom entre guillemets dans le script : sa casse est significative. */
  quoted: boolean;
  /** Type tel qu'écrit (ex. `VARCHAR(50)`, `NUMBER(10,2)`, `timestamp with time zone`). */
  type: string;
  notNull: boolean;
  unique: boolean;
  uniqueName?: string;
  autoIncrement: boolean;
  default?: string;
  collation?: string;
  comment?: string;
  /** CHECK déclaré sur la colonne. */
  check?: NamedExpression;
  /** Colonne calculée : expression telle qu'écrite, stockée ou virtuelle (O-35). */
  generated?: { expression: string; stored: boolean };
  /** MySQL ON UPDATE CURRENT_TIMESTAMP. */
  onUpdate?: string;
  /** Première valeur du compteur (IDENTITY (START WITH n), IDENTITY(n, pas)). */
  identityStart?: number;
  /** Pas du compteur (INCREMENT BY m, IDENTITY(n, m)) (O-41). */
  identityIncrement?: number;
  /** Identité GENERATED ALWAYS, ou BY DEFAULT ON NULL (Oracle) ; absente : BY DEFAULT / auto-incrément (O-39). */
  identity?: "always" | "on null";
  /**
   * Valeur tirée d'une séquence (O-39) : DEFAULT seq.NEXTVAL / nextval('seq') / NEXT VALUE FOR seq,
   * ou déclencheur Oracle `:NEW.col := seq.NEXTVAL` (`trigger` : sans WHEN … IS NULL, il écrase
   * toute valeur fournie ; avec, il remplace aussi un NULL explicite).
   */
  sequence?: { name: string; trigger?: "on null" | "always" };
  /** Options SQL Server sans effet sur les données : NOT FOR REPLICATION, ROWGUIDCOL (O-42). */
  sqlServerOptions?: string[];
}

export interface ParsedForeignKey {
  name?: string;
  columns: string[];
  table: string;
  /** Vide : la clé primaire de la table référencée. */
  referencedColumns: string[];
  onDelete?: ReferentialAction;
  onUpdate?: ReferentialAction;
  /** Déclarée en ligne, dans la définition de la colonne (MySQL : analysée mais non appliquée). */
  inline?: boolean;
  state?: ConstraintState;
}

export interface ParsedKey {
  name?: string;
  columns: string[];
  /** Longueur de préfixe par colonne (MySQL `email(100)`, PostgreSQL `left(email, 100)`). */
  prefixes?: (number | null)[];
  /** Méthode d'index (USING HASH, BTREE, GIN…). */
  method?: string;
  kind?: "fulltext" | "spatial";
  state?: ConstraintState;
  /** Index sur expression : éléments tels qu'écrits ; `columns` : colonnes citées (O-39). */
  expression?: string;
  /** Index partiel : condition (WHERE …, ou motif Oracle CASE WHEN cond THEN col END) (O-39). */
  where?: string;
  /** NULLS NOT DISTINCT (PostgreSQL 15+). */
  nullsNotDistinct?: boolean;
  /**
   * Index filtré SQL Server `WHERE c IS NOT NULL` sur chaque colonne : UNIQUE ordinaire, dont les NULL
   * restent distincts (plusieurs NULL admis) (O-41).
   */
  nullsDistinct?: boolean;
  /** Colonnes couvertes (INCLUDE, SQL Server / PostgreSQL 11+), sans effet sur l'unicité (O-42). */
  include?: string[];
}

export interface ParsedTable {
  name: string;
  quoted: boolean;
  columns: ParsedColumn[];
  primaryKey: string[];
  primaryKeyName?: string;
  uniques: ParsedKey[];
  foreignKeys: ParsedForeignKey[];
  /** CHECK de niveau table. */
  checks: NamedExpression[];
  /** Index non uniques. */
  indexes: ParsedKey[];
  comment?: string;
  /** MySQL AUTO_INCREMENT = n (option de table). */
  autoIncrementStart?: number;
  /** Collation par défaut de la table (MySQL : [DEFAULT] COLLATE = …). */
  collation?: string;
  /** Déclencheurs, tels qu'écrits. */
  triggers: { name: string; sql: string }[];
  primaryKeyState?: ConstraintState;
  /** Clauses de stockage (TABLESPACE, STORAGE, PCTFREE, LOB, USING INDEX…), par mot-clé (O-39). */
  storage: string[];
  /** Partitionnement (PARTITION BY …), tel qu'écrit (O-39). */
  partition?: string;
  /** Schéma de la table (ref.aeroport), tel qu'écrit (O-42). */
  schema?: string;
}

export interface ParsedSchema {
  tables: ParsedTable[];
  /** Types énumérés (PostgreSQL CREATE TYPE … AS ENUM) : nom → valeurs. */
  enumTypes: Map<string, string[]>;
  /** Collation par défaut de la base (CREATE DATABASE … COLLATE …). */
  defaultCollation?: string;
  /** Collations déclarées (PostgreSQL CREATE COLLATION) : nom → paramètres (locale, deterministic…). */
  collations: Map<string, Record<string, string>>;
  /** Séquences (CREATE SEQUENCE), par nom en minuscules ; `ownedBy` : colonne propriétaire (PostgreSQL). */
  sequences: Map<string, SequenceDefinition & { ownedBy?: { table: string; column: string } }>;
  /** Instructions sans rapport avec la structure des tables, ignorées. */
  ignored: number;
  /** Instructions de table qui n'ont pas pu être lues entièrement. */
  skipped: string[];
  /** Avertissements de lecture : fin de commentaire *\\/ orpheline (O-41). */
  warnings: string[];
}

export function parseSql(sql: string, dialect?: SqlDialect): ParsedSchema {
  const schema: ParsedSchema = {
    tables: [],
    enumTypes: new Map(),
    collations: new Map(),
    sequences: new Map(),
    ignored: 0,
    skipped: [],
    warnings: [],
  };
  for (const statement of splitStatements(tokenize(sql, { dialect, warnings: schema.warnings }))) {
    try {
      parseStatement(schema, statement, statementRaw(sql, statement));
    } catch {
      schema.skipped.push(joinRaw(statement.slice(0, 8)));
    }
  }
  resolveSequences(schema);
  return schema;
}

/** Texte d'origine de l'instruction (corps de déclencheur…). */
function statementRaw(sql: string, statement: Token[]): string {
  const first = statement[0]!;
  const last = statement.at(-1)!;
  return first.pos !== undefined && last.pos !== undefined
    ? sql.slice(first.pos, last.pos + last.raw.length)
    : joinRaw(statement);
}

function parseStatement(schema: ParsedSchema, statement: Token[], raw: string) {
  const c = new Cursor(statement);
  if (c.accept("create")) {
    createStatement(c, schema, raw);
  } else if (c.accept("alter", "table")) {
    alterTable(c, schema, statement);
  } else if (c.accept("alter", "sequence")) {
    alterSequence(c, schema);
  } else if (c.accept("comment", "on")) {
    commentOn(c, schema);
  } else if (c.accept("exec") || c.accept("execute")) {
    extendedProperty(c, schema);
  } else {
    schema.ignored += 1;
  }
}

function createStatement(c: Cursor, schema: ParsedSchema, raw: string) {
  c.accept("or", "replace");
  // MySQL : CREATE DEFINER = utilisateur TRIGGER …
  if (c.accept("definer")) {
    if (isPunct(c.peek(), "=")) {
      c.next();
    }
    while (!(c.done() || isWord(c.peek(), "trigger", "procedure", "function", "view", "event"))) {
      c.next();
    }
  }
  const unique = c.accept("unique");
  const kind = isWord(c.peek(), "fulltext", "spatial")
    ? (c.next()!.value.toLowerCase() as "fulltext" | "spatial")
    : undefined;
  while (isWord(c.peek(), "global", "local", "temporary", "temp", "unlogged", "virtual", "external", "transient")) {
    c.next();
  }
  if (!(unique || kind) && c.accept("table")) {
    createTable(c, schema);
  } else if (isWord(c.peek(), "index", "clustered", "nonclustered")) {
    createIndex(c, schema, unique, kind);
  } else {
    createOther(c, schema, raw);
  }
}

function createOther(c: Cursor, schema: ParsedSchema, raw: string) {
  if (c.accept("trigger")) {
    createTrigger(c, schema, raw);
  } else if (c.accept("type")) {
    createType(c, schema);
  } else if (c.accept("database") || c.accept("schema")) {
    createDatabase(c, schema);
  } else if (c.accept("collation")) {
    createCollation(c, schema);
  } else if (c.accept("sequence")) {
    createSequence(c, schema);
  } else {
    schema.ignored += 1;
  }
}
