import type { Association, Attribute, Entity, Id, Inheritance, InheritanceLink, Link, ModelDocument, Point } from "./document";
import { applyPattern } from "../naming/patterns";
import type { KeyPattern } from "./settings";
import { defaultSettings } from "./settings";

export const newId = (): Id => crypto.randomUUID();

export function emptyDocument(): ModelDocument {
  return { settings: defaultSettings(), entities: [], associations: [], links: [], inheritances: [], inheritanceLinks: [] };
}

export function createAttribute(name: string, patch: Partial<Attribute> = {}): Attribute {
  return { id: newId(), name, identifier: false, notNull: false, unique: false, ...patch };
}

export function createEntity(name: string, position: Point): Entity {
  return { id: newId(), kind: "entity", name, attributes: [], position, fictive: false };
}

export function createAssociation(name: string, position: Point): Association {
  return { id: newId(), kind: "association", name, attributes: [], position };
}

export function createInheritance(position: Point): Inheritance {
  return { id: newId(), kind: "inheritance", constraint: "none", position };
}

export function createInheritanceLink(inheritanceId: Id, entityId: Id): InheritanceLink {
  return { id: newId(), inheritanceId, entityId, bends: [] };
}

export function createLink(associationId: Id, entityId: Id): Link {
  return {
    id: newId(),
    associationId,
    entityId,
    cardinality: { min: 0, max: "n" },
    relativeId: false,
    bends: [],
  };
}

/** Premier nom libre de la forme « <base> <n> » parmi `existing`. */
export function nextFreeName(base: string, existing: Iterable<string>): string {
  const taken = new Set(existing);
  for (let i = 1; ; i++) {
    const candidate = `${base} ${i}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/** Nom du discriminant automatique selon le masque (override O-12). */
export function autoIdentifierName(pattern: KeyPattern, className: string): string {
  return applyPattern(pattern, { entity: className }).trim() || className;
}

/** Rubrique discriminante de type Compteur, à insérer en tête. */
export function createAutoIdentifier(pattern: KeyPattern, className: string): Attribute {
  return createAttribute(autoIdentifierName(pattern, className), {
    identifier: true,
    autoKey: true,
    type: { kind: "counter" },
  });
}
