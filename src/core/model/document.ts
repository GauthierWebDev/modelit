import type { DataType } from "./datatype";
import type {
  AlternateKey,
  CheckConstraint,
  GeneratedColumn,
  IndexDefinition,
  ReferentialAction,
  SourceType,
  SqlExpression,
  ConstraintState,
  SequenceDefinition,
  SqlDialect,
  TriggerDefinition,
  ValueDomain,
} from "./physical";
import type { DocumentSettings } from "./settings";

export type Id = string;

export interface Point {
  x: number;
  y: number;
}

/** Rubrique d'une entité ou d'une association. */
export interface Attribute {
  id: Id;
  name: string;
  /** Nom utilisé dans le MLD et le SQL ; vide = dérivé du nom conceptuel. */
  logicalName?: string;
  /** Une rubrique peut rester non typée : la colonne SQL est alors émise sans type. */
  type?: DataType;
  identifier: boolean;
  /**
   * Créée par « Discriminant automatique » : son nom logique suit le masque de clé
   * primaire (override O-13), sauf nom logique saisi.
   */
  autoKey?: boolean;
  /** Ordre dans une clé composée (« Place dans clé »), à partir de 1. */
  keyOrder?: number;
  notNull: boolean;
  unique: boolean;
  /** Complément SQL ajouté tel quel à la colonne (`DEFAULT …`, `CHECK …`). */
  complement?: string;
  comment?: string;
  // Annotations physiques (override O-29)
  /** Nom entre guillemets dans le script d'origine : sa casse est significative. */
  caseSensitive?: boolean;
  /** Valeur par défaut (traduite vers le SGBD cible quand c'est possible). */
  defaultValue?: SqlExpression;
  /** Domaine de la rubrique : CHECK ne portant que sur elle. */
  check?: CheckConstraint;
  /** Type exact d'origine. */
  sourceType?: SourceType;
  // Annotations physiques (override O-35)
  /** Entier ou décimal non signé (MySQL UNSIGNED). */
  unsigned?: boolean;
  /** Valeurs permises (ENUM / SET). */
  domain?: ValueDomain;
  /** Colonne calculée. */
  generated?: GeneratedColumn;
  /** Valeur réaffectée à chaque mise à jour de la ligne (MySQL ON UPDATE CURRENT_TIMESTAMP). */
  onUpdate?: SqlExpression;
  // Annotations physiques (override O-39)
  /**
   * Valeur tirée d'une séquence (DEFAULT seq.NEXTVAL, nextval('seq'), ou déclencheur Oracle
   * `:NEW.col := seq.NEXTVAL`) ; `trigger` : déclencheur d'origine, qui remplaçait aussi un NULL
   * explicite (`on null`) ou écrasait toute valeur fournie (`always`).
   */
  sequence?: { name: string; trigger?: "on null" | "always" };
  /** Compteur : GENERATED ALWAYS, ou BY DEFAULT ON NULL (Oracle : un NULL explicite reçoit une valeur). */
  identity?: "always" | "on null";
  /** Options SQL Server sans effet sur les données : NOT FOR REPLICATION, ROWGUIDCOL (O-42). */
  sqlServerOptions?: string[];
}

interface NodeBase {
  id: Id;
  name: string;
  logicalName?: string;
  attributes: Attribute[];
  comment?: string;
  // Annotations physiques de la table (override O-29)
  /** Nom entre guillemets dans le script d'origine : sa casse est significative. */
  caseSensitive?: boolean;
  /** Nom de la contrainte de clé primaire. */
  primaryKeyName?: string;
  /** Identifiants alternatifs (UNIQUE composés, ou incluant des clés étrangères). */
  alternateKeys?: AlternateKey[];
  /** Contraintes CHECK portant sur plusieurs colonnes. */
  checks?: CheckConstraint[];
  /** Index non uniques. */
  indexes?: IndexDefinition[];
  /** Ordre d'origine des colonnes de la table (noms). */
  columnOrder?: string[];
  /** Première valeur du compteur (MySQL AUTO_INCREMENT = n, START WITH n) (O-35). */
  autoIncrementStart?: number;
  /** Pas du compteur (IDENTITY(n, pas), INCREMENT BY) (O-41). */
  autoIncrementStep?: number;
  /** Déclencheurs de la table, conservés tels quels (O-35). */
  triggers?: TriggerDefinition[];
  // Annotations physiques (override O-39)
  primaryKeyState?: ConstraintState;
  /** Séquences utilisées par les colonnes de la table. */
  sequences?: SequenceDefinition[];
  /** Partitionnement d'origine (PARTITION BY …), tel qu'écrit. */
  partition?: { sql: string; dialect: SqlDialect };
  /** Clauses de stockage d'origine (TABLESPACE, STORAGE, PCTFREE, LOB, USING INDEX…), par mot-clé. */
  storage?: string[];
  /** Schéma d'origine de la table (ref), s'il est écrit (O-42). */
  schema?: string;
}

/** Classe d'entités. */
export interface Entity extends NodeBase {
  kind: "entity";
  /** Ne génère pas de table ; son identifiant entre dans les clés des tables associées. */
  fictive: boolean;
}

/** Association. L'option « table de correspondance forcée » est retirée (O-19). */
export interface Association extends NodeBase {
  kind: "association";
}

export type CardinalityMax = number | "n";

export interface Cardinality {
  min: number;
  max: CardinalityMax;
}

/** Patte entre une association et une entité. */
export interface Link {
  id: Id;
  associationId: Id;
  entityId: Id;
  cardinality: Cardinality;
  /** Identifiant relatif : la clé étrangère entre dans la clé primaire de l'entité. */
  relativeId: boolean;
  role?: string;
  /**
   * Noms des clés étrangères qui référencent l'entité de cette patte (override O-07),
   * indexés par la rubrique discriminante d'origine. Absent = nom de la colonne référencée.
   */
  foreignKeyNames?: Record<Id, string>;
  /**
   * Texte libre affiché sur le trait entre tables (MLD / MPD) qui correspond aux clés
   * étrangères de cette patte, comme un nom d'association UML (override O-25).
   */
  relationLabel?: string;
  /**
   * Actions référentielles et nom de la contrainte FOREIGN KEY. Elles sont portées par la patte
   * qui porte la clé étrangère (côté 1,1 / 0,1 d'une DF, ou chaque patte d'une table de
   * correspondance).
   */
  onDelete?: ReferentialAction;
  onUpdate?: ReferentialAction;
  foreignKeyConstraintName?: string;
  /**
   * Colonnes de la clé étrangère qui réutilisent une colonne déjà présente dans la table
   * (ex. colonne commune à la clé primaire), par rubrique d'origine (override O-29).
   */
  sharedColumns?: Id[];
  /**
   * Clé étrangère vers un identifiant alternatif de l'entité référencée plutôt que vers sa clé
   * primaire : rubriques référencées, dans l'ordre (ex. oeuvre.isbn) (override O-35).
   */
  referencedAttributes?: Id[];
  /** Commentaires des colonnes de la clé étrangère, par rubrique d'origine (O-35). */
  foreignKeyComments?: Record<Id, string>;
  /** État de la contrainte FOREIGN KEY (différable, désactivée, non validée) (O-39). */
  foreignKeyState?: ConstraintState;
  /**
   * Patte de la table qui porte la clé étrangère dans le script d'origine : décide du côté de la
   * clé pour une association 0,1 / 0,1 (ex. service.chef_id → personnel) (O-39).
   */
  foreignKeyHolder?: boolean;
  /**
   * Clé étrangère déclarée en ligne (`col … REFERENCES t(c)`), que MySQL analyse mais n'applique
   * pas : la base d'origine ne garantissait pas cette référence (O-36).
   */
  sourceNotEnforced?: boolean;
}

/** Contrainte d'un héritage (symbole dans le triangle, override O-18). */
export type InheritanceConstraint = "none" | "X" | "T" | "XT";

/**
 * Héritage — spécialisation / généralisation (override O-18).
 * Un triangle relié à une entité cible (le surtype) et à au moins deux sous-types.
 */
export interface Inheritance {
  id: Id;
  kind: "inheritance";
  constraint: InheritanceConstraint;
  /** Entité cible (surtype), choisie parmi les entités reliées. */
  parentId?: Id;
  comment?: string;
}

/** Lien entre un héritage et une entité (surtype ou sous-type selon `Inheritance.parentId`). */
export interface InheritanceLink {
  id: Id;
  inheritanceId: Id;
  entityId: Id;
  /** Texte libre du trait sous-type → surtype dans le MLD / MPD (override O-25). */
  relationLabel?: string;
  /** Clé étrangère de l'entité spécialisée vers l'entité générique (override O-29). */
  onDelete?: ReferentialAction;
  onUpdate?: ReferentialAction;
  foreignKeyConstraintName?: string;
  /** Noms des colonnes de la clé héritée, par rubrique d'origine, s'ils diffèrent (ex. adherent_id) (O-36). */
  foreignKeyNames?: Record<Id, string>;
  foreignKeyState?: ConstraintState;
}

export type ModelNode = Entity | Association | Inheritance;

/**
 * Géométrie du schéma, séparée de la sémantique (docs/jalons/J-01, phase 3) : déplacer un objet
 * ne touche ni les entités ni les liens, donc ni le MLD ni le SQL dérivés. Indexée par identifiant.
 */
export interface DiagramLayout {
  /** Coin haut-gauche des entités, associations et héritages, en coordonnées du modèle. */
  positions: Record<Id, Point>;
  /** Points de cassure des pattes et des liens d'héritage ; absent = trait droit. */
  bends: Record<Id, Point[]>;
}

export interface ModelDocument {
  settings: DocumentSettings;
  entities: Entity[];
  associations: Association[];
  links: Link[];
  inheritances: Inheritance[];
  inheritanceLinks: InheritanceLink[];
  layout: DiagramLayout;
}

const ORIGIN: Point = { x: 0, y: 0 };
const STRAIGHT: Point[] = [];

/** Position d'un objet du schéma (origine si elle n'est pas connue). */
export const positionOf = (layout: DiagramLayout, id: Id): Point => layout.positions[id] ?? ORIGIN;

/** Cassures d'un trait (aucune si elles ne sont pas connues). */
export const bendsOf = (layout: DiagramLayout, id: Id): Point[] => layout.bends[id] ?? STRAIGHT;

/** Fixe les cassures d'un trait ; une liste vide retire l'entrée (trait droit). */
export function setBends(layout: DiagramLayout, id: Id, bends: Point[]) {
  if (bends.length) layout.bends[id] = bends;
  else delete layout.bends[id];
}

/** Tout trait du schéma : patte d'association ou lien d'héritage. */
export type DiagramLink = Link | InheritanceLink;

/** Objet (association ou héritage) à l'autre bout de l'entité. */
export const linkSourceId = (link: DiagramLink): Id => ("associationId" in link ? link.associationId : link.inheritanceId);

export const diagramLinks = (doc: Pick<ModelDocument, "links" | "inheritanceLinks">): DiagramLink[] => [
  ...doc.links,
  ...doc.inheritanceLinks,
];

/** Tous les objets positionnés du schéma. */
export const diagramNodes = (doc: Pick<ModelDocument, "entities" | "associations" | "inheritances">): ModelNode[] => [
  ...doc.entities,
  ...doc.associations,
  ...doc.inheritances,
];

export const isMultiple = (c: Cardinality) => c.max === "n" || c.max > 1;

export const formatCardinality = (c: Cardinality) => `${c.min},${c.max}`;

/**
 * SGBD d'origine des rubriques issues d'une rétroconception (types, valeurs par défaut et CHECK
 * annotés, O-28, O-29) : les conversions qui les concernent sont mises en avant (O-55).
 */
export function sourceDialects(doc: Pick<ModelDocument, "entities" | "associations">): Set<SqlDialect> {
  const found = new Set<SqlDialect>();
  for (const node of [...doc.entities, ...doc.associations]) {
    for (const a of node.attributes) {
      for (const dialect of [a.sourceType?.dialect, a.defaultValue?.dialect, a.check?.dialect]) if (dialect) found.add(dialect);
      if (a.unsigned) found.add("mysql");
    }
  }
  found.delete("generic");
  return found;
}
