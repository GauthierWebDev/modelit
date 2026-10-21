import {
  type Attribute,
  type Check,
  checkAssociation,
  checkAttributes,
  createAttribute,
  createAutoIdentifier,
  type Id,
  sameDialect,
} from "@core/index";
import { type MessageKey, t } from "@/i18n";
import { change, current, findNode } from "./commandSupport";
import type { DocumentHandle } from "./document/handle";

/** Remplace la liste des rubriques d'une entité ou d'une association. */
export function setAttributes(
  doc: DocumentHandle,
  ownerId: Id,
  attributes: Attribute[],
  label: MessageKey = "history.editAttributes",
): Check {
  const error = checkAttributes(attributes);
  if (error) {
    return error;
  }
  const association = current(doc).associations.find((a) => a.id === ownerId);
  if (association) {
    const assocError = checkAssociation(current(doc), { ...association, attributes });
    if (assocError) {
      return assocError;
    }
  }
  change(doc, label, (d) => {
    const owner = findNode(d, ownerId);
    if (owner) {
      owner.attributes = attributes;
    }
  });
  return null;
}

/** Renomme une rubrique (nom conceptuel, renommage sur place dans le MCD, override O-58). */
export function renameAttribute(doc: DocumentHandle, ownerId: Id, attributeId: Id, name: string): Check {
  const owner = [...current(doc).entities, ...current(doc).associations].find((n) => n.id === ownerId);
  const attribute = owner?.attributes.find((a) => a.id === attributeId);
  if (!(owner && attribute) || attribute.name === name.trim()) {
    return null;
  }
  const attributes = owner.attributes.map((a) => (a.id === attributeId ? { ...a, name: name.trim() } : a));
  return setAttributes(doc, ownerId, attributes, "history.renameAttribute");
}

/** Ajoute en fin de liste une rubrique au nom libre (« rubrique_N ») ; renvoie son identifiant. */
export function addAttribute(doc: DocumentHandle, ownerId: Id): Id | null {
  const owner = [...current(doc).entities, ...current(doc).associations].find((node) => node.id === ownerId);
  if (!owner) {
    return null;
  }
  const taken = new Set(owner.attributes.map((a) => a.name));
  let n = owner.attributes.length + 1;
  while (taken.has(t("attribute.defaultName", { n }))) {
    n += 1;
  }
  const created = createAttribute(t("attribute.defaultName", { n }));
  return setAttributes(doc, ownerId, [...owner.attributes, created], "history.addAttribute") ? null : created.id;
}

export function addAutoIdentifier(doc: DocumentHandle, entityId: Id): Check {
  const model = current(doc);
  const entity = model.entities.find((e) => e.id === entityId);
  if (!entity) {
    return null;
  }
  const id = createAutoIdentifier(model.settings.autoIdMask, entity.name);
  return setAttributes(doc, entityId, [id, ...entity.attributes], "history.autoIdentifier");
}

/**
 * Type SQL d'une colonne pour le SGBD de la cible, saisi dans le MPD (O-59) : annotation « type
 * d'origine » de la rubrique (O-29) ; vide, le type calculé revient.
 */
export function setColumnSqlType(doc: DocumentHandle, ownerId: Id, attributeId: Id, sql: string): Check {
  const owner = [...current(doc).entities, ...current(doc).associations].find((n) => n.id === ownerId);
  if (!owner) {
    return null;
  }
  const dialect = current(doc).settings.dbms;
  const value = sql.trim();
  const attribute = owner.attributes.find((a) => a.id === attributeId);
  const mine = attribute?.sourceType && sameDialect(attribute.sourceType.dialect, dialect);
  // Vide : seul le type de ce dialecte est retiré ; celui d'un autre (rétroconception) reste.
  if (!(attribute && (value || mine)) || (mine && attribute.sourceType!.sql === value)) {
    return null;
  }
  const attributes = owner.attributes.map((a) =>
    a.id === attributeId ? { ...a, sourceType: value ? { sql: value, dialect } : undefined } : a,
  );
  return setAttributes(doc, ownerId, attributes, "history.columnType");
}
