import type { Dbms, InheritanceConstraint, ReferentialAction, Typology } from "@core/index";

/**
 * Opérations d'une demande `apply_changes` (overrides O-47, O-69). Objets désignés par identifiant ou par nom
 * (sans tenir compte de la casse) : entités, associations ; rubriques dans leur objet ; pattes par leur
 * identifiant, ou par association + entité.
 */

export interface AttributeSpec {
  /** Rubrique existante à reprendre (`set_attributes`) : identifiant ; sinon reconnue par son nom. */
  id?: string;
  name: string;
  /** Type SQL (« VARCHAR(50) », « INT », « DATE »…), interprété comme en rétroconception. */
  type?: string;
  identifier?: boolean;
  notNull?: boolean;
  unique?: boolean;
  comment?: string;
}

/** Modification d'une rubrique : seuls les champs donnés changent ; chaîne vide = valeur retirée. */
export interface AttributePatch {
  name?: string;
  logicalName?: string;
  type?: string;
  identifier?: boolean;
  notNull?: boolean;
  unique?: boolean;
  comment?: string;
  /** Complément SQL ajouté tel quel à la colonne. */
  complement?: string;
  /** Valeur par défaut (expression SQL du SGBD cible). */
  default?: string;
  /** CHECK ne portant que sur la rubrique (expression SQL). */
  check?: string;
  unsigned?: boolean;
  caseSensitive?: boolean;
  /** Type SQL exact de la colonne dans le MPD, pour le SGBD cible (O-59). */
  sqlType?: string;
}

export interface LinkSpec {
  entity: string;
  /** « 0,1 », « 1,1 », « 0,n », « 1,n »… */
  cardinality: string;
  relativeIdentifier?: boolean;
}

/** Identifiant alternatif ou index : rubriques de l'objet, par nom ou identifiant. */
export interface KeySpec {
  name?: string;
  attributes: string[];
}

export type Operation =
  | { op: "create_entity"; name: string; attributes?: AttributeSpec[] }
  | { op: "create_association"; name: string; links: LinkSpec[]; attributes?: AttributeSpec[] }
  | { op: "create_inheritance"; parent: string; children: string[]; constraint?: InheritanceConstraint }
  | { op: "rename"; target: string; name: string }
  | { op: "update_node"; target: string; name?: string; logicalName?: string; comment?: string; fictive?: boolean }
  | {
      op: "update_inheritance";
      target: string;
      parent?: string;
      constraint?: InheritanceConstraint;
      comment?: string;
      addChildren?: string[];
      removeChildren?: string[];
    }
  | { op: "set_attributes"; target: string; attributes: AttributeSpec[] }
  | { op: "add_attributes"; target: string; attributes: AttributeSpec[] }
  | ({ op: "update_attribute"; target: string; attribute: string } & AttributePatch)
  | { op: "add_auto_identifier"; target: string }
  | { op: "add_link"; association: string; entity: string; cardinality?: string; relativeIdentifier?: boolean }
  | {
      op: "set_link";
      /** Identifiant de la patte (ou d'un lien d'héritage : `relationLabel` seulement) ; sinon `association` + `entity`. */
      link?: string;
      association?: string;
      entity?: string;
      cardinality?: string;
      relativeIdentifier?: boolean;
      role?: string;
      onDelete?: ReferentialAction | "";
      onUpdate?: ReferentialAction | "";
      constraintName?: string;
      relationLabel?: string;
      /** Noms des colonnes de clé étrangère : rubrique référencée (nom ou identifiant) → nom de colonne. */
      foreignKeyNames?: Record<string, string>;
    }
  | {
      op: "set_physical";
      target: string;
      /** Nom de table entre guillemets : sa casse est significative. */
      caseSensitive?: boolean;
      primaryKeyName?: string;
      /** Remplace la liste. */
      alternateKeys?: KeySpec[];
      indexes?: KeySpec[];
      checks?: { name?: string; expression: string }[];
    }
  | { op: "delete"; targets: string[] }
  | { op: "set_dbms"; dbms: Dbms; version?: string; keepCustom?: boolean }
  | {
      op: "set_settings";
      naming?: { typology?: Typology; stripAccents?: boolean };
      autoIdMask?: string;
      primaryKey?: string;
      foreignKey?: string;
      ddl?: Record<string, unknown>;
    }
  | { op: "customize_dbms"; name?: string }
  | { op: "set_custom_type"; type: string; sql: string }
  | { op: "reset_custom_types" }
  | { op: "remove_customization" };

export type OperationOf<K extends Operation["op"]> = Extract<Operation, { op: K }>;
