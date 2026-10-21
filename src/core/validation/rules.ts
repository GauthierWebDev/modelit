import type { Association, Attribute, Cardinality, Id, Link, ModelDocument } from "../model/document";
import { MSG } from "./messages";

/**
 * Contrôles de saisie : chaque fonction renvoie le message d'erreur
 * qui doit bloquer la modification, ou `null` si elle est acceptable.
 * Toutes les règles ci-dessous sont confirmées.
 */
export type Check = string | null;

export function checkEntityName(doc: ModelDocument, name: string, selfId?: Id): Check {
  if (!name.trim()) {
    return MSG.emptyName;
  }
  const taken = doc.entities.some((e) => e.id !== selfId && e.name === name.trim());
  return taken ? MSG.entityNameTaken : null;
}

export function checkAssociationName(doc: ModelDocument, name: string, selfId?: Id): Check {
  if (!name.trim()) {
    return MSG.emptyName;
  }
  const taken = doc.associations.some((a) => a.id !== selfId && a.name === name.trim());
  return taken ? MSG.associationNameTaken : null;
}

export function checkAttributes(attributes: Attribute[]): Check {
  const names = attributes.map((a) => a.name.trim());
  if (names.some((n) => !n)) {
    return MSG.emptyName;
  }
  return new Set(names).size !== names.length ? MSG.duplicateAttributes : null;
}

/** Cardinalité saisie librement dans la boîte Lien. */
export function checkCardinality(c: Cardinality): Check {
  const maxOk = c.max === "n" || (Number.isInteger(c.max) && c.max >= 1);
  if (!Number.isInteger(c.min) || c.min < 0 || !maxOk) {
    return MSG.incoherentCardinalities;
  }
  if (c.max !== "n" && c.max < c.min) {
    return MSG.maxLowerThanMin;
  }
  return null;
}

const isOneOne = (c: Cardinality) => c.min === 1 && c.max === 1;
const hasMaxOne = (c: Cardinality) => c.max === 1;

export const linksOf = (doc: ModelDocument, associationId: Id): Link[] =>
  doc.links.filter((l) => l.associationId === associationId);

/**
 * Une association produit une table de correspondance quand aucune patte n'est de cardinalité
 * max 1. Pas d'option « Générer une table de correspondance » (override O-19).
 */
export function generatesTable(links: Link[]): boolean {
  return links.every((l) => !hasMaxOne(l.cardinality));
}

/**
 * Contrôle d'une nouvelle cardinalité sur une patte, dans le contexte de son association.
 */
export function checkLinkCardinality(doc: ModelDocument, linkId: Id, c: Cardinality): Check {
  const own = checkCardinality(c);
  if (own) {
    return own;
  }
  const link = doc.links.find((l) => l.id === linkId);
  const association = link && doc.associations.find((a) => a.id === link.associationId);
  if (!link || !association || !isOneOne(c)) {
    return null;
  }

  if (association.attributes.length > 0) {
    return MSG.oneOneForbiddenWithAttributes;
  }
  const others = linksOf(doc, association.id).filter((l) => l.id !== linkId);
  if (others.length === 1 && isOneOne(others[0]!.cardinality)) {
    return MSG.bothSidesOneOne;
  }
  return null;
}

/** Contrôle des rubriques portées par une association. */
export function checkAssociation(doc: ModelDocument, association: Pick<Association, "id" | "attributes">): Check {
  const links = linksOf(doc, association.id);
  if (association.attributes.length > 0) {
    if (links.some((l) => isOneOne(l.cardinality))) {
      return MSG.oneOneForbiddenWithAttributes;
    }
    if (links.some((l) => hasMaxOne(l.cardinality))) {
      return MSG.attributesNeedTable;
    }
  }
  return null;
}
