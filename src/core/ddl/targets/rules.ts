import type { ReferentialAction } from "../../model/physical";

export interface IdentifierRules {
  /** Délimiteurs d'un identifiant. */
  quotes: readonly [string, string];
  /** Repli de casse des identifiants non délimités. */
  folding?: "lower" | "upper";
  /** Mots réservés, en minuscules (`reservedWords`). */
  reserved: ReadonlySet<string>;
  /** Longueur maximale d'un identifiant (octets / caractères selon le SGBD). */
  maxLength: number;
}

export interface ActionRules {
  delete: readonly ReferentialAction[];
  update: readonly ReferentialAction[];
  /** Comportement obtenu sans clause : NO ACTION, ou RESTRICT pour Sybase. */
  implicit: readonly ReferentialAction[];
}

/** `localtimestamp` : date et heure locales à la seconde, sans fuseau (Oracle SYSDATE) (O-39). */
export type DateFunction =
  | "current_date"
  | "current_time"
  | "current_timestamp"
  | "localtimestamp"
  | "localtimestamp_seconds"
  | "utc_timestamp";

/** Fonctions sans argument d'une valeur par défaut, hors dates (O-39). */
export type SpecialFunction = "current_user" | "uuid" | "uuid_sequential";

export interface ExpressionRules {
  /** Littéraux booléens TRUE / FALSE disponibles. */
  booleanLiterals: boolean;
  /** Fonctions de date / heure courantes (`null` : non disponible). */
  dates: Record<DateFunction, string | null>;
  /** Fonctions spéciales (`null` : non disponible en DEFAULT). */
  functions: Record<SpecialFunction, string | null>;
}

export type CollationResult =
  /** Clause à écrire (vide : comportement par défaut de la cible) ; `preamble` : à créer avant. */
  | { kind: "emit"; sql: string; preamble?: string; approximation?: string }
  /** Non transposable : rien n'est écrit, la perte est signalée. */
  | { kind: "dropped" };

export interface CollationRules {
  /** Sensible à la casse et aux accents : clause (vide : comportement par défaut). */
  sensitive: string;
  /** Binaire : clause (vide : comportement par défaut), ou `null` : non transposable. */
  binary: string | null;
  /** Insensible à la casse (`ci`), et aux accents (`ai_ci`). */
  insensitive: (klass: "ci" | "ai_ci") => CollationResult;
}

export interface SchemaRules {
  /** Schéma par défaut, jamais écrit (PostgreSQL : public). */
  omitted?: string;
  /** Schéma qui existe toujours : écrit, jamais créé (SQL Server : dbo). */
  existing?: string;
  /** Création du schéma (`quoted` : son nom délimité si besoin). */
  create: (name: string, quoted: string) => string;
}

/** Emplois d'une colonne : comparée dans un CHECK, ou membre d'une clé ou d'un index. */
export interface Usage {
  compared: boolean;
  keyed: boolean;
}

export interface TypeRules {
  /** Domaines ENUM / SET natifs (MySQL). */
  nativeDomains: boolean;
  /** Type énuméré CREATE TYPE … AS ENUM, pour l'option « type » (PostgreSQL). */
  enumTypes: boolean;
  /** SET en tableau de texte avec CHECK, pour l'option « array » (PostgreSQL). */
  setArrays: boolean;
  /** Entiers et décimaux UNSIGNED (MySQL). */
  unsigned: boolean;
  /** BOOLEAN y est TINYINT(1) : un TINYINT(1) lu comme booléen n'y perd rien (MySQL). */
  tinyintBoolean: boolean;
  /** YEAR d'un autre dialecte borné par CHECK (BETWEEN 1901 AND 2155) (O-38). */
  yearRange: boolean;
  /**
   * Décimal sans précision (NUMBER, NUMERIC) : exprimé tel quel, remplacé par un type exact
   * équivalent (`sql`), ou borné à cette précision (signalé) (O-39).
   */
  unboundedDecimal: "native" | { sql: string } | { precision: number; scale: number };
  /** Échelle négative (NUMBER(12,-3)) ; sinon précision élargie, échelle 0 (signalé). */
  negativeScale: boolean;
  /** Longueur imposée à un texte long que la cible ne sait pas comparer ou indexer. */
  boundedText: (usage: Usage) => number | undefined;
  /** Type d'un binaire borné, quand celui de la correspondance ne convient pas (PostgreSQL : BYTEA). */
  boundedBinary?: string;
  /** Types réduits à des affinités : seul un changement d'affinité est une perte (SQLite). */
  affinities: boolean;
  /** Types spatiaux par l'extension PostGIS, ou en repli selon l'option (O-42). */
  postgis: boolean;
  /** La chaîne vide y vaut NULL (Oracle) (O-39). */
  emptyStringIsNull: boolean;
  /** Longueur d'un texte venu d'un autre dialecte, en caractères comme à la source (Oracle : CHAR). */
  textLength: (sql: string) => string;
  /** Collations insensibles en collations ICU non déterministes, selon l'option (PostgreSQL) (O-38). */
  nondeterministicCollations: boolean;
  /** Équivalents des types libres d'un autre dialecte ; à défaut, texte (signalé). */
  free: {
    /** ROWVERSION SQL Server (numéro de version automatique, sans équivalent) (O-41). */
    rowversion?: string;
    uuid?: string;
    json?: string;
    /** INTERVAL DAY / YEAR … TO … (PostgreSQL) (O-39). */
    intervals: boolean;
  };
}

export interface CounterRules {
  /** Compteur 64 bits impossible : type émis à la place (Access : COUNTER), signalé. */
  narrowOnly?: string;
  /** Même dialecte : type d'origine du compteur conservé (Oracle : NUMBER(10)) (O-39). */
  keepSourceType?: (sql: string, source: string) => string;
  /** Valeur de départ et pas écrits dans le type (IDENTITY(100, 10), COUNTER(1, 1)) (O-41). */
  seed?: (sql: string, start: number | undefined, step: number | undefined) => string | undefined;
  /** Valeur de départ en option de la table (MySQL : AUTO_INCREMENT = n). */
  startOption?: (start: number) => string;
  /** Le compteur refuse toute valeur fournie, comme GENERATED ALWAYS (SQL Server : IDENTITY) (O-42). */
  rejectsExplicitValues: boolean;
  /** Un NULL inséré reçoit déjà la valeur suivante, comme BY DEFAULT ON NULL (MySQL) (O-39). */
  nullTakesNextValue: boolean;
  /** BY DEFAULT ON NULL AS IDENTITY (Oracle) (O-39). */
  onNullIdentity: boolean;
}

export interface SequenceRules {
  /** Valeur suivante, en DEFAULT (`name` : nom qualifié et délimité). */
  next: (name: string) => string;
  /** Type des valeurs (AS INT) ; `undefined` : type par défaut (signalé) (O-41). */
  valueType: (type: string) => string | undefined;
  /** Sans cache (cache ≤ 1) ; à défaut, CACHE 1. */
  noCache?: string;
  noCycle: string;
  /** La séquence appartient à la seule colonne qu'elle alimente (OWNED BY, PostgreSQL) (O-40). */
  ownedBy: boolean;
}

export interface GeneratedRules {
  virtual: boolean;
  stored: boolean;
  /** Le type de la colonne se déclare (SQL Server : déduit de l'expression, signalé). */
  typed: boolean;
  clause: (expression: string, stored: boolean) => string;
}

export interface ColumnRules {
  /** ON UPDATE sur une colonne (MySQL). */
  onUpdate: boolean;
  /** Clé primaire simple de compteur en ligne : INTEGER PRIMARY KEY AUTOINCREMENT (SQLite). */
  inlineCounterKey: boolean;
  /** NOT NULL explicite sur la clé primaire, que la cible n'impose pas (SQLite). */
  primaryKeyNotNull: boolean;
  /** DEFAULT d'une colonne de type `type`, réécrit (`null` : impossible) (MySQL : TEXT, BLOB…). */
  defaultFor?: (rendered: string, type: string) => string | null;
}

export type ConstraintKind = "check" | "unique" | "primary" | "foreign";

export interface ConstraintRules {
  /** CHECK comparant des familles de types différentes refusé à l'exécution (PostgreSQL, DB2) (O-35). */
  strictCheckTyping: boolean;
  /** Expressions rationnelles dans un CHECK (LIKE à classes SQL Server) (O-42). */
  regex: boolean;
  /** DEFERRABLE [INITIALLY …] (O-39). */
  deferrable: (kind: ConstraintKind) => boolean;
  /** Contrainte ajoutée sans valider les lignes existantes (O-39). */
  notValidated: (kind: ConstraintKind) => boolean;
  notValidatedSuffix: string;
  /** Chemins de cascade multiples ou cycliques refusés (SQL Server). */
  singleCascadePath: boolean;
  /** ALTER TABLE … ADD CONSTRAINT … FOREIGN KEY possible (pas en SQLite). */
  alterForeignKey: boolean;
  /** CHECK appliqué (MySQL l'ignore avant 8.0.16). */
  enforcedChecks: boolean;
}

export interface UniqueRules {
  /** UNIQUE … USING méthode (MySQL). */
  methods: boolean;
  /** Un seul NULL admis par UNIQUE ; plusieurs NULL : index unique filtré (SQL Server) (O-39, O-41). */
  singleNull: boolean;
  /**
   * NULL égaux entre eux : dans une clé composée, nativement (Oracle) ; nativement (SQL Server) ;
   * par une clause (PostgreSQL 15+ : NULLS NOT DISTINCT, `null` avant) ; `null` : impossible (O-39).
   */
  equalNulls: "composite" | "native" | { clause: string | null } | null;
  /** INCLUDE sur une contrainte UNIQUE (PostgreSQL) (O-42). */
  include: boolean;
}

export interface IndexRules {
  /** Index sur expression (O-39). */
  expressions: boolean;
  /** Partie de clé fonctionnelle entre parenthèses (MySQL). */
  parenthesizedExpressions: boolean;
  /** Index partiel : WHERE, motif CASE WHEN (Oracle), ou impossible (O-39). */
  partial: "where" | "case" | null;
  /** FULLTEXT / SPATIAL natifs (MySQL). */
  nativeKinds: boolean;
  /** Plein texte en index GIN sur to_tsvector (PostgreSQL), signalé (O-35). */
  fulltextGin: boolean;
  /** Préfixes de colonnes `col(n)` dans une clé, UNIQUE ou index (MySQL). */
  nativePrefixes: boolean;
  /** Préfixe de colonne `n` en expression, quand il n'est pas natif ; `null` : impossible (O-35). */
  prefix: (ref: string, n: number) => string | null;
  /** Méthode d'index (USING), avant les colonnes ou après ; `null` : B-tree seul. */
  method: { position: "before" | "after"; accepts: (method: string, unique: boolean) => boolean } | null;
  /** INCLUDE (colonnes couvertes) (O-42). */
  include: boolean;
}
