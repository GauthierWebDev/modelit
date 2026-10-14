import type { Dbms } from "../dbms/dbms";
import { latestVersion } from "../dbms/versions";
import type { Typology } from "../naming/typology";

/**
 * Schéma de nommage (override O-26) : texte avec variables canoniques `<entity>`, `<table>`,
 * `<column>`, `<name>` (cf. `naming/patterns.ts`). Les préréglages ci-dessous sont proposés
 * dans l'interface ; tout autre schéma valide peut être saisi (« Libre »).
 */
export type KeyPattern = string;

/** Nom conceptuel du discriminant automatique (override O-12). */
export const DISCRIMINANT_PRESETS: KeyPattern[] = ["code <entity>", "Id_<entity>", "<entity>_Id", "Id<entity>", "<entity>Id"];

/** Nom logique de la clé primaire issue du discriminant automatique (override O-13). */
export const PRIMARY_KEY_PRESETS: KeyPattern[] = ["id_<table>", "<table>_id", "<name>"];

/**
 * Nom par défaut d'une clé étrangère (override O-13) : table et colonne référencées.
 * Un schéma sans `<column>` ne s'applique qu'aux clés simples ; pour une clé composée,
 * chaque colonne garde le nom de la colonne référencée.
 */
export const FOREIGN_KEY_PRESETS: KeyPattern[] = ["<table>_id", "<column>", "<table>_<column>", "<column>_<table>"];

/** Nommage des contraintes sans nom explicite. */
export type ConstraintNaming = "none" | "prefix" | "suffix";

/** Options de génération du script SQL (override O-29). */
export interface DdlOptions {
  /** Toutes les clés étrangères en ALTER TABLE en fin de script (le plus portable). */
  foreignKeysInAlter: boolean;
  /** Régénérer les index non uniques (CREATE INDEX). */
  indexes: boolean;
  /** Conserver l'ordre d'origine des colonnes (tables issues d'une rétroconception). */
  sourceColumnOrder: boolean;
  /** Noms générés pour les contraintes anonymes ; les noms explicites sont toujours conservés. */
  constraintNaming: ConstraintNaming;
  /**
   * Entiers non signés vers un SGBD qui n'en a pas (O-35) : type élargi pour couvrir la plage
   * (INT UNSIGNED → BIGINT), ou type conservé avec CHECK (col >= 0).
   */
  unsigned: "widen" | "check";
  /** ENUM : texte + CHECK (col IN …) (le domaine Merise), ou type énuméré (CREATE TYPE, PostgreSQL). */
  enums: "check" | "type";
  /** SET : tableau de texte + CHECK (PostgreSQL), ou simple texte (signalé). */
  sets: "array" | "text";
  /**
   * Collations insensibles à la casse / aux accents vers PostgreSQL (O-38) : collation ICU non
   * déterministe, ou repli sur la collation déterministe par défaut (serveur sans ICU ; signalé).
   */
  collations: "icu" | "deterministic";
  /**
   * Oracle DATE (date et heure à la seconde) (O-39) : TIMESTAMP(0), ou DATE (heure perdue, signalé).
   */
  oracleDates: "timestamp" | "date";
  /**
   * Oracle : la chaîne vide vaut NULL (O-39). `check` : CHECK (col <> '') sur les colonnes de texte
   * NOT NULL, qui la refusaient ; `none` : rien d'ajouté (signalé).
   */
  emptyStrings: "check" | "none";
  /**
   * Fidélité stricte (O-40) : un NUMBER(p) devenu un entier plus large (NUMBER(4) → SMALLINT) reçoit
   * CHECK (col BETWEEN −(10^p − 1) AND 10^p − 1), hors clés étrangères ; sinon l'élargissement est signalé.
   */
  strictRanges: boolean;
  /**
   * Types spatiaux vers PostgreSQL (O-42) : CREATE EXTENSION postgis en tête de script (défaut), ou
   * repli sans extension — BYTEA (WKB) ou TEXT (WKT), signalé.
   */
  spatial: "postgis" | "wkb" | "wkt";
  /**
   * Collation supposée des colonnes de texte SQL Server sans collation déclarée (celle de la base,
   * absente du script) (O-42) : CI_AS (défaut d'installation), CI_AI ou CS_AS.
   */
  sqlServerCollation: "ci_as" | "ci_ai" | "cs_as";
  /** Schéma dbo (SQL Server) vers PostgreSQL : public (défaut) ou dbo (O-42). */
  dboSchema: "public" | "dbo";
}

/** Libellé des traits entre tables (MLD / MPD, override O-25). */
export type RelationLabelMode = "none" | "foreignKey" | "text";

/**
 * Paramètres enregistrés dans le fichier modèle.
 * Seul un sous-ensemble est implémenté ; les autres s'ajoutent ici,
 * avec une migration dans `core/io` si leur absence change le comportement.
 */
export interface DocumentSettings {
  dbms: Dbms;
  /** Version du SGBD cible (cf. `core/dbms/versions.ts`). */
  dbmsVersion: string;
  naming: {
    typology: Typology;
    stripAccents: boolean;
  };
  /** Schéma du nom conceptuel du discriminant automatique. */
  autoIdMask: KeyPattern;
  keys: {
    primary: KeyPattern;
    foreign: KeyPattern;
  };
  /** Les types ne s'affichent que dans la vue MPD (override O-11). */
  display: {
    showAttributes: boolean;
    /** Pointe de flèche vers la table référencée (MLD / MPD). */
    relationArrows: boolean;
    relationLabels: RelationLabelMode;
  };
  grid: {
    enabled: boolean;
    size: number;
  };
  ddl: DdlOptions;
}

/**
 * Valeurs par défaut PROVISOIRES, à valider.
 */
export function defaultSettings(): DocumentSettings {
  return {
    dbms: "postgresql",
    dbmsVersion: latestVersion("postgresql"),
    naming: { typology: "standard", stripAccents: false },
    autoIdMask: "code <entity>",
    keys: { primary: "id_<table>", foreign: "<table>_id" },
    display: { showAttributes: true, relationArrows: false, relationLabels: "none" },
    grid: { enabled: true, size: 10 },
    ddl: { foreignKeysInAlter: false, indexes: true, sourceColumnOrder: true, constraintNaming: "none", unsigned: "widen", enums: "check", sets: "array", collations: "icu", oracleDates: "timestamp", emptyStrings: "check", strictRanges: false, spatial: "postgis", sqlServerCollation: "ci_as", dboSchema: "public" },
  };
}
