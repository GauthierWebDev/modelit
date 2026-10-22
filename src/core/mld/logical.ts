import type { DataType } from "../model/datatype";
import type { Id } from "../model/document";
import type {
  CheckConstraint,
  ConstraintState,
  GeneratedColumn,
  ReferentialAction,
  SequenceDefinition,
  SourceType,
  SqlDialect,
  SqlExpression,
  TriggerDefinition,
  ValueDomain,
} from "../model/physical";

/** Modèle logique (relationnel) produit à partir du MCD. */

export interface LogicalColumn {
  name: string;
  type?: DataType;
  /** NOT NULL explicite (les colonnes de clé primaire le sont implicitement). */
  notNull: boolean;
  unique: boolean;
  /** Colonne issue d'une clé étrangère (préfixe `#` dans le MLD textuel). */
  foreign: boolean;
  complement?: string;
  comment?: string;
  /** Rubrique d'origine d'une colonne propre (renommage depuis le MLD / MPD, O-56). */
  attributeId?: Id;
  /**
   * Colonne migrée par une patte (clé étrangère, ou discriminant d'une entité fictive) :
   * permet de la renommer (override O-07).
   */
  origin?: { linkId: Id; attributeId: Id; defaultName: string };
  // Annotations physiques (override O-29)
  caseSensitive?: boolean;
  defaultValue?: SqlExpression;
  check?: CheckConstraint;
  sourceType?: SourceType;
  // Annotations physiques (override O-35)
  unsigned?: boolean;
  domain?: ValueDomain;
  generated?: GeneratedColumn;
  onUpdate?: SqlExpression;
  // Annotations physiques (override O-39)
  sequence?: { name: string; trigger?: "on null" | "always" };
  identity?: "always" | "on null";
  sqlServerOptions?: string[];
}

/** Contrainte UNIQUE ou index, par noms de colonnes. */
export interface LogicalKey {
  name?: string;
  columns: string[];
  /** Longueur de préfixe par colonne (null : colonne entière) (O-35). */
  prefixes?: (number | null)[];
  method?: string;
  kind?: "fulltext" | "spatial";
  // O-39
  state?: ConstraintState;
  expression?: SqlExpression;
  where?: SqlExpression;
  nulls?: "not distinct" | "oracle" | "distinct";
  /** Colonnes couvertes (INCLUDE) (O-42). */
  include?: string[];
}

export interface LogicalForeignKey {
  /**
   * Patte (association) ou lien d'héritage (sous-type) d'où vient la clé : porte le texte
   * libre du trait entre tables (override O-25).
   */
  relationId: Id;
  columns: string[];
  referencedTable: string;
  referencedColumns: string[];
  onDelete?: ReferentialAction;
  onUpdate?: ReferentialAction;
  /** Nom de contrainte explicite (conservé d'une rétroconception ou saisi). */
  name?: string;
  state?: ConstraintState;
}

export interface LogicalTable {
  name: string;
  source: { kind: "entity" | "association"; id: Id };
  columns: LogicalColumn[];
  primaryKey: string[];
  foreignKeys: LogicalForeignKey[];
  comment?: string;
  // Annotations physiques (override O-29)
  caseSensitive?: boolean;
  primaryKeyName?: string;
  /** Contraintes UNIQUE de niveau table (composées, nommées, ou d'une association 1:1). */
  uniques: LogicalKey[];
  /** Contraintes CHECK de niveau table. */
  checks: CheckConstraint[];
  /** Index non uniques. */
  indexes: LogicalKey[];
  /** Première valeur du compteur (O-35). */
  identityStart?: number;
  /** Pas du compteur (O-41). */
  identityStep?: number;
  triggers?: TriggerDefinition[];
  // O-39
  primaryKeyState?: ConstraintState;
  sequences?: SequenceDefinition[];
  partition?: { sql: string; dialect: SqlDialect };
  storage?: string[];
  /** Schéma d'origine (O-42). */
  schema?: string;
}

export interface IssueTarget {
  kind: "entity" | "association" | "link" | "inheritance";
  id: Id;
}

export interface Issue {
  severity: "error" | "warning";
  /** Formulation du MCD (entités, rubriques, discriminants). */
  message: string;
  /** Formulation du MLD / MPD (tables, colonnes, clés), si elle diffère (override O-24). */
  logicalMessage?: string;
  target?: IssueTarget;
}

/** Couche dont l'utilisateur emploie le vocabulaire : MCD, ou MLD / MPD. */
export type ModelLayer = "conceptual" | "logical";

export const issueMessage = (issue: Issue, layer: ModelLayer) =>
  layer === "logical" ? (issue.logicalMessage ?? issue.message) : issue.message;

export interface LogicalModel {
  tables: LogicalTable[];
  issues: Issue[];
}

export const hasErrors = (m: LogicalModel) => m.issues.some((i) => i.severity === "error");
