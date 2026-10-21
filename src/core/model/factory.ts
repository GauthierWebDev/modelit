import { applyPattern } from "../naming/patterns";
import type { Association, Attribute, Entity, Id, Inheritance, InheritanceLink, Link, ModelDocument } from "./document";
import type { KeyPattern } from "./settings";
import { defaultSettings } from "./settings";

export const newId = (): Id => crypto.randomUUID();

export function emptyDocument(): ModelDocument {
  return {
    settings: defaultSettings(),
    entities: [],
    associations: [],
    links: [],
    inheritances: [],
    inheritanceLinks: [],
    layout: { positions: {}, bends: {} },
  };
}

export function createAttribute(name: string, patch: Partial<Attribute> = {}): Attribute {
  return { id: newId(), name, identifier: false, notNull: false, unique: false, ...patch };
}

/** Objets du schéma : leur position se range dans `ModelDocument.layout` (J-01, phase 3). */
export function createEntity(name: string): Entity {
  return { id: newId(), kind: "entity", name, attributes: [], fictive: false };
}

export function createAssociation(name: string): Association {
  return { id: newId(), kind: "association", name, attributes: [] };
}

export function createInheritance(): Inheritance {
  return { id: newId(), kind: "inheritance", constraint: "none" };
}

export function createInheritanceLink(inheritanceId: Id, entityId: Id): InheritanceLink {
  return { id: newId(), inheritanceId, entityId };
}

export function createLink(associationId: Id, entityId: Id): Link {
  return {
    id: newId(),
    associationId,
    entityId,
    cardinality: { min: 0, max: "n" },
    relativeId: false,
  };
}

/** Premier nom libre de la forme « <base> <n> » parmi `existing`. */
export function nextFreeName(base: string, existing: Iterable<string>): string {
  const taken = new Set(existing);
  for (let i = 1; ; i += 1) {
    const candidate = `${base} ${i}`;
    if (!taken.has(candidate)) {
      return candidate;
    }
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
