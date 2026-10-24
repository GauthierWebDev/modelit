import {
  type Association,
  type Attribute,
  type Cardinality,
  diagramNodes,
  type Entity,
  type Id,
  type Link,
  type ModelDocument,
  type Point,
  positionOf,
} from "@core/index";
import type { DocumentHandle } from "../document/handle";

/** Appuis des opérations de l'IA (overrides O-47, O-69) : refus, désignation des objets, places libres. */

export class Refused extends Error {}

export const refuse = (message: string): never => {
  throw new Refused(message);
};

/** Message d'une commande de l'interface (validation refusée) : la demande est refusée. */
export const check = (message: string | null, context: string) => message && refuse(`${context}: ${message}`);

export const current = (doc: DocumentHandle) => doc.store.getState().doc;

/** Ce que partagent les opérations d'une même demande : objets créés (par nom), places déjà prises. */
export interface ApplyContext {
  created: Record<string, Id>;
  placed: { n: number };
}

const same = (ref: string) => {
  const lower = ref.trim().toLowerCase();
  return <T extends { id: Id; name: string }>(x: T) => x.id === ref || x.name.toLowerCase() === lower;
};

/** Entité, association ou héritage désigné par identifiant, ou par nom (sans tenir compte de la casse). */
export function resolve(doc: ModelDocument, ref: string, kind?: "entity" | "association"): Id {
  const pools = [...(kind === "association" ? [] : [doc.entities]), ...(kind === "entity" ? [] : [doc.associations])];
  for (const pool of pools) {
    const found = pool.find((x) => x.id === ref) ?? pool.find(same(ref));
    if (found) {
      return found.id;
    }
  }
  if (!kind) {
    const other = doc.inheritances.find((h) => h.id === ref) ?? doc.links.find((l) => l.id === ref);
    if (other) {
      return other.id;
    }
  }
  return refuse(`${kind ?? "object"} « ${ref} » not found`);
}

/** Entité ou association qui porte des rubriques. */
export function owner(doc: ModelDocument, ref: string): Entity | Association {
  const id = resolve(doc, ref);
  const node = [...doc.entities, ...doc.associations].find((n) => n.id === id);
  return node ?? refuse(`« ${ref} » has no attributes`);
}

/** Rubrique d'un objet, par identifiant ou par nom. */
export function attributeOf(node: Entity | Association, ref: string): Attribute {
  const found = node.attributes.find((a) => a.id === ref) ?? node.attributes.find(same(ref));
  return found ?? refuse(`attribute « ${ref} » not found in « ${node.name} »`);
}

/** Patte désignée par son identifiant, ou par son association et son entité (réflexive : identifiant requis). */
export function linkOf(doc: ModelDocument, spec: { link?: string; association?: string; entity?: string }): Link {
  if (spec.link) {
    return doc.links.find((l) => l.id === spec.link) ?? refuse(`link « ${spec.link} » not found`);
  }
  if (!(spec.association && spec.entity)) {
    return refuse("a link is designated by its id, or by association and entity");
  }
  const association = resolve(doc, spec.association, "association");
  const entity = resolve(doc, spec.entity, "entity");
  const links = doc.links.filter((l) => l.associationId === association && l.entityId === entity);
  if (links.length > 1) {
    refuse(`« ${spec.association} » has several links to « ${spec.entity} »: use the link id`);
  }
  return links[0] ?? refuse(`no link between « ${spec.association} » and « ${spec.entity} »`);
}

export function parseCardinality(text: string): Cardinality {
  const m = /^\s*(\d+)\s*,\s*(\d+|n|N|\*)\s*$/.exec(text);
  if (!m) {
    return refuse(`invalid cardinality « ${text} » (expected e.g. 0,1 / 1,1 / 0,n / 1,n)`);
  }
  return { min: Number(m[1]), max: /^\d+$/.test(m[2]!) ? Number(m[2]) : "n" };
}

/** Place libre pour un nouvel objet : sous le schéma existant, de gauche à droite. */
function freeSpot(doc: ModelDocument, index: number): Point {
  const nodes = diagramNodes(doc);
  if (nodes.length === 0) {
    return { x: 40 + index * 240, y: 40 };
  }
  const positions = nodes.map((n) => positionOf(doc.layout, n.id));
  const minX = Math.min(...positions.map((p) => p.x));
  const maxY = Math.max(...positions.map((p) => p.y));
  return { x: minX + index * 240, y: maxY + 180 };
}

/** Place libre suivante pour un objet créé par la demande. */
export function nextSpot(doc: DocumentHandle, ctx: ApplyContext): Point {
  const spot = freeSpot(current(doc), ctx.placed.n);
  ctx.placed.n += 1;
  return spot;
}
