import type { Dbms } from "../dbms/dbms";
import type { Id } from "./document";

/**
 * Annotations physiques (override O-29) : ce que le MCD ne sait pas exprimer mais qu'un script
 * SQL contient (contraintes CHECK, index, noms de contraintes, types et défauts d'origine…).
 * Le MCD affiché les ignore ; le générateur les réapplique quand le SGBD cible le permet et
 * signale toute perte dans son rapport. Elles sont visibles et modifiables dans les blocs « Avancé » (O-50).
 */

/** Dialecte d'une expression ou d'un type d'origine ; `generic` = inconnu / SQL standard. */
export type SqlDialect = Dbms | "generic";

/** Action référentielle d'une clé étrangère (absente = comportement par défaut, NO ACTION). */
export type ReferentialAction = "cascade" | "set null" | "set default" | "restrict" | "no action";

export const REFERENTIAL_ACTIONS: ReferentialAction[] = ["cascade", "set null", "set default", "restrict", "no action"];

/**
 * État d'une contrainte (O-39) : désactivée (Oracle DISABLE), non validée sur les lignes existantes
 * (Oracle ENABLE NOVALIDATE, PostgreSQL NOT VALID), différable (DEFERRABLE [INITIALLY …]).
 */
export interface ConstraintState {
  disabled?: boolean;
  notValidated?: boolean;
  deferrable?: "immediate" | "deferred";
  /** Dialecte d'origine de l'état : vocabulaire du rapport (DISABLE / NOCHECK CONSTRAINT…) (O-42). */
  dialect?: SqlDialect;
}

/** Contrainte CHECK : expression d'origine, telle qu'écrite dans son dialecte. */
export interface CheckConstraint {
  name?: string;
  expression: string;
  dialect: SqlDialect;
  state?: ConstraintState;
}

/** Expression SQL brute d'origine (valeur par défaut). */
export interface SqlExpression {
  expression: string;
  dialect: SqlDialect;
}

/** Type SQL exact d'origine, réémis tel quel vers le même dialecte. */
export interface SourceType {
  sql: string;
  dialect: SqlDialect;
}

/**
 * Membre d'un identifiant alternatif ou d'un index : une rubrique de l'objet, ou une colonne de
 * clé étrangère (patte de l'entité référencée + rubrique d'origine, cf. `LogicalColumn.origin`).
 */
export type KeyMember = { attributeId: Id } | { linkId: Id; originId: Id };

/** Identifiant alternatif (contrainte UNIQUE, simple ou composée). */
export interface AlternateKey {
  name?: string;
  members: KeyMember[];
  /** Longueur de préfixe par membre (MySQL `email(100)`) ; absente : colonne entière (O-35). */
  prefixes?: (number | null)[];
  /** Méthode d'index d'origine (`hash`, `btree`…). */
  method?: string;
  state?: ConstraintState;
  /**
   * Index unique sur expression (ex. LOWER(email)) : éléments tels qu'écrits ; `members` donne les
   * rubriques citées (O-39).
   */
  expression?: SqlExpression;
  /** Unicité conditionnelle (index unique partiel) : condition, ex. date_sortie IS NULL (O-39). */
  where?: SqlExpression;
  /**
   * Traitement des NULL : `not distinct` (PostgreSQL NULLS NOT DISTINCT) ; `oracle` : clé composée
   * Oracle — les NULL sont égaux entre eux, sauf si toute la clé est NULL (ligne ignorée) (O-39) ;
   * `distinct` : plusieurs NULL admis, à préserver vers SQL Server (index filtré IS NOT NULL) (O-41).
   */
  nulls?: "not distinct" | "oracle" | "distinct";
  /** Colonnes couvertes (INCLUDE) d'un index unique (O-42). */
  include?: KeyMember[];
}

/** Index non unique (hors MCD). */
export interface IndexDefinition {
  name?: string;
  members: KeyMember[];
  prefixes?: (number | null)[];
  method?: string;
  /** Index plein texte ou spatial (MySQL FULLTEXT / SPATIAL). */
  kind?: "fulltext" | "spatial";
  /** Colonnes couvertes (INCLUDE) (O-42). */
  include?: KeyMember[];
}

/**
 * Domaine énuméré d'une rubrique (O-35) : ENUM (une valeur parmi) ou SET (plusieurs parmi),
 * c'est-à-dire le domaine de valeurs au sens Merise.
 */
export interface ValueDomain {
  kind: "enum" | "set";
  values: string[];
}

/** Colonne calculée (GENERATED ALWAYS AS / AS … STORED | VIRTUAL). */
export interface GeneratedColumn {
  expression: string;
  dialect: SqlDialect;
  stored: boolean;
}

/** Séquence (CREATE SEQUENCE), rattachée à la table dont une colonne l'utilise (O-39). */
export interface SequenceDefinition {
  name: string;
  start?: number;
  increment?: number;
  min?: number;
  max?: number;
  /** Valeurs préallouées ; 1 = NOCACHE. */
  cache?: number;
  cycle?: boolean;
  /** Type des valeurs (AS INT, AS bigint…) ; absent : celui par défaut du SGBD (O-41). */
  type?: string;
  /** Schéma de la séquence (ref.seq_client) (O-42). */
  schema?: string;
}

/** Déclencheur, conservé tel qu'écrit dans son dialecte. */
export interface TriggerDefinition {
  name: string;
  sql: string;
  dialect: SqlDialect;
}
