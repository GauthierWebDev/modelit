import {
  type Association,
  type Attribute,
  type Entity,
  formatCardinality,
  type Link,
  type ModelDocument,
  sameDialect,
  sqlType,
} from "@core/index";
import { attributePhysical, linkPhysical, nodePhysical } from "./describePhysical";

/**
 * Le MCD sous une forme compacte, pour un assistant IA (overrides O-47, O-69) : identifiants (objets, rubriques,
 * pattes), noms conceptuels et logiques, types tels que le MPD les montre, pattes et cardinalités, héritages.
 * `full` : toutes les annotations physiques en plus (DEFAULT, CHECK, index, actions des clés étrangères…).
 */
export type ModelDetail = "conceptual" | "full";

/** Type SQL de la rubrique comme le MPD : type saisi pour ce dialecte (O-59), sinon calculé (types redéfinis). */
export function attributeType(a: Attribute, doc: ModelDocument): string | undefined {
  const { dbms, dbmsVersion, customDbms } = doc.settings;
  if (a.sourceType && sameDialect(a.sourceType.dialect, dbms)) {
    return a.sourceType.sql;
  }
  return a.type ? (sqlType(a.type, dbms, dbmsVersion, customDbms?.types) ?? a.type.kind) : undefined;
}

const optional = <T>(key: string, value: T | undefined | false) =>
  value === undefined || value === false || value === "" ? {} : { [key]: value };

function attribute(a: Attribute, doc: ModelDocument, detail: ModelDetail) {
  return {
    id: a.id,
    name: a.name,
    ...optional("logicalName", a.logicalName),
    ...optional("type", attributeType(a, doc)),
    ...optional("identifier", a.identifier),
    ...optional("notNull", a.notNull),
    ...optional("unique", a.unique),
    ...optional("comment", a.comment),
    ...(detail === "full" ? attributePhysical(a) : {}),
  };
}

function node(n: Entity | Association, doc: ModelDocument, detail: ModelDetail) {
  return {
    id: n.id,
    name: n.name,
    ...optional("logicalName", n.logicalName),
    ...optional("fictive", n.kind === "entity" && n.fictive),
    ...optional("comment", n.comment),
    attributes: n.attributes.map((a) => attribute(a, doc, detail)),
    ...(detail === "full" ? nodePhysical(n) : {}),
  };
}

function link(l: Link, doc: ModelDocument, detail: ModelDetail, entityName: Map<string, string>) {
  const entity = doc.entities.find((e) => e.id === l.entityId);
  // Noms des colonnes de clé étrangère (O-07), par nom de la rubrique référencée.
  const foreignKeyNames = Object.entries(l.foreignKeyNames ?? {}).map(([id, name]) => [
    entity?.attributes.find((a) => a.id === id)?.name ?? id,
    name,
  ]);
  return {
    id: l.id,
    entity: entityName.get(l.entityId) ?? l.entityId,
    cardinality: formatCardinality(l.cardinality),
    ...optional("relativeIdentifier", l.relativeId),
    ...optional("role", l.role),
    ...(foreignKeyNames.length > 0 ? { foreignKeyNames: Object.fromEntries(foreignKeyNames) } : {}),
    ...(detail === "full" ? linkPhysical(l) : {}),
  };
}

export function describeModel(doc: ModelDocument, name: string, detail: ModelDetail = "conceptual") {
  const entityName = new Map(doc.entities.map((e) => [e.id, e.name]));
  return {
    document: name,
    dbms: doc.settings.dbms,
    dbmsVersion: doc.settings.dbmsVersion,
    ...(doc.settings.customDbms ? { customDbms: doc.settings.customDbms.name } : {}),
    entities: doc.entities.map((e) => node(e, doc, detail)),
    associations: doc.associations.map((a) => ({
      ...node(a, doc, detail),
      links: doc.links.filter((l) => l.associationId === a.id).map((l) => link(l, doc, detail, entityName)),
    })),
    inheritances: doc.inheritances.map((h) => {
      const linked = doc.inheritanceLinks.filter((l) => l.inheritanceId === h.id).map((l) => l.entityId);
      return {
        id: h.id,
        parent: h.parentId ? entityName.get(h.parentId) : null,
        children: linked.filter((id) => id !== h.parentId).map((id) => entityName.get(id) ?? id),
        constraint: h.constraint,
        ...optional("comment", h.comment),
        // Liens d'héritage : identifiant (texte du trait, `set_link`), entité, texte du trait.
        links: doc.inheritanceLinks
          .filter((l) => l.inheritanceId === h.id)
          .map((l) => ({
            id: l.id,
            entity: entityName.get(l.entityId) ?? l.entityId,
            ...optional("relationLabel", l.relationLabel),
          })),
      };
    }),
  };
}

/** Paramètres du modèle (`get_settings`, O-69). */
export function describeSettings(doc: ModelDocument) {
  const { settings } = doc;
  return {
    dbms: settings.dbms,
    dbmsVersion: settings.dbmsVersion,
    naming: settings.naming,
    autoIdMask: settings.autoIdMask,
    primaryKey: settings.keys.primary,
    foreignKey: settings.keys.foreign,
    ddl: settings.ddl,
    ...(settings.customDbms
      ? { customDbms: { name: settings.customDbms.name, basedOn: settings.dbms, types: settings.customDbms.types } }
      : {}),
  };
}
