import { formatCardinality, sqlType, type Attribute, type ModelDocument } from "@core/index";

/**
 * Le MCD sous une forme compacte, pour un assistant IA (override O-47) : identifiants, noms,
 * rubriques avec leur type SQL dans le SGBD cible, pattes et cardinalités, héritages.
 */

const attribute = (a: Attribute, doc: ModelDocument) => ({
  name: a.name,
  ...(a.type ? { type: sqlType(a.type, doc.settings.dbms, doc.settings.dbmsVersion) ?? a.type.kind } : {}),
  ...(a.identifier ? { identifier: true } : {}),
  ...(a.notNull ? { notNull: true } : {}),
  ...(a.unique ? { unique: true } : {}),
  ...(a.comment ? { comment: a.comment } : {}),
});

export function describeModel(doc: ModelDocument, name: string) {
  const entityName = new Map(doc.entities.map((e) => [e.id, e.name]));
  return {
    document: name,
    dbms: doc.settings.dbms,
    dbmsVersion: doc.settings.dbmsVersion,
    entities: doc.entities.map((e) => ({
      id: e.id,
      name: e.name,
      ...(e.fictive ? { fictive: true } : {}),
      attributes: e.attributes.map((a) => attribute(a, doc)),
      ...(e.comment ? { comment: e.comment } : {}),
    })),
    associations: doc.associations.map((a) => ({
      id: a.id,
      name: a.name,
      links: doc.links
        .filter((l) => l.associationId === a.id)
        .map((l) => ({
          entity: entityName.get(l.entityId) ?? l.entityId,
          cardinality: formatCardinality(l.cardinality),
          ...(l.relativeId ? { relativeIdentifier: true } : {}),
          ...(l.role ? { role: l.role } : {}),
        })),
      attributes: a.attributes.map((x) => attribute(x, doc)),
      ...(a.comment ? { comment: a.comment } : {}),
    })),
    inheritances: doc.inheritances.map((h) => {
      const linked = doc.inheritanceLinks.filter((l) => l.inheritanceId === h.id).map((l) => l.entityId);
      return {
        id: h.id,
        parent: h.parentId ? entityName.get(h.parentId) : null,
        children: linked.filter((id) => id !== h.parentId).map((id) => entityName.get(id) ?? id),
        constraint: h.constraint,
      };
    }),
  };
}
