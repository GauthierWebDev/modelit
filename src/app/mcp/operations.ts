import {
  type Attribute,
  type Cardinality,
  createAttribute,
  type Dbms,
  diagramNodes,
  type Id,
  type ModelDocument,
  type Point,
  positionOf,
  sqlTypeToDataType,
} from "@core/index";
import * as cmd from "../commands";
import type { DocumentHandle } from "../document/handle";
import type { AttributeSpec, Operation } from "./apply";

export class Refused extends Error {}

export const refuse = (message: string): never => {
  throw new Refused(message);
};

function parseCardinality(text: string): Cardinality {
  const m = /^\s*(\d+)\s*,\s*(\d+|n|N|\*)\s*$/.exec(text);
  if (!m) {
    return refuse(`invalid cardinality « ${text} » (expected e.g. 0,1 / 1,1 / 0,n / 1,n)`);
  }
  return { min: Number(m[1]), max: /^\d+$/.test(m[2]!) ? Number(m[2]) : "n" };
}

function toAttribute(spec: AttributeSpec, dbms: Dbms): Attribute {
  if (!spec.name?.trim()) {
    refuse("attribute without a name");
  }
  const type = spec.type ? sqlTypeToDataType(spec.type, false, dbms) : undefined;
  if (spec.type && !type) {
    refuse(`unknown type « ${spec.type} » for attribute « ${spec.name} »`);
  }
  return createAttribute(spec.name.trim(), {
    ...(type ? { type } : {}),
    identifier: spec.identifier === true,
    notNull: spec.notNull === true || spec.identifier === true,
    unique: spec.unique === true,
    ...(spec.comment ? { comment: spec.comment } : {}),
  });
}

/** Entité, association ou héritage désigné par identifiant, ou par nom (sans tenir compte de la casse). */
export function resolve(doc: ModelDocument, ref: string, kind?: "entity" | "association"): Id {
  const lower = ref.trim().toLowerCase();
  const pools = [...(kind === "association" ? [] : [doc.entities]), ...(kind === "entity" ? [] : [doc.associations])];
  for (const pool of pools) {
    const found = pool.find((x) => x.id === ref) ?? pool.find((x) => x.name.toLowerCase() === lower);
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

export const check = (message: string | null, context: string) => message && refuse(`${context}: ${message}`);

type OperationOf<K extends Operation["op"]> = Extract<Operation, { op: K }>;

export const current = (doc: DocumentHandle) => doc.store.getState().doc;

/** Place libre suivante pour un objet créé par la demande. */
function nextSpot(doc: DocumentHandle, placed: { n: number }): Point {
  const spot = freeSpot(current(doc), placed.n);
  placed.n += 1;
  return spot;
}

/** Rubriques d'un objet créé, dans le type du SGBD cible. */
function createdAttributes(doc: DocumentHandle, id: Id, attributes: AttributeSpec[] | undefined, context: string) {
  if (!attributes?.length) {
    return;
  }
  const { dbms } = current(doc).settings;
  check(
    cmd.setAttributes(
      doc,
      id,
      attributes.map((a) => toAttribute(a, dbms)),
    ),
    context,
  );
}

export function createEntity(
  doc: DocumentHandle,
  operation: OperationOf<"create_entity">,
  created: Record<string, Id>,
  placed: { n: number },
): string {
  const id = cmd.addEntity(doc, nextSpot(doc, placed));
  check(cmd.renameNode(doc, id, operation.name), `entity « ${operation.name} »`);
  createdAttributes(doc, id, operation.attributes, `entity « ${operation.name} »`);
  created[operation.name] = id;
  return `entity ${operation.name} created`;
}

export function createAssociation(
  doc: DocumentHandle,
  operation: OperationOf<"create_association">,
  created: Record<string, Id>,
  placed: { n: number },
): string {
  if (operation.links.length < 2) {
    refuse(`association « ${operation.name} »: at least two links are needed`);
  }
  const entities = operation.links.map((l) => resolve(current(doc), l.entity, "entity"));
  const id = linkedAssociation(doc, operation.name, entities, nextSpot(doc, placed));
  check(cmd.renameNode(doc, id, operation.name), `association « ${operation.name} »`);
  const links = current(doc).links.filter((l) => l.associationId === id);
  operation.links.forEach((spec, i) => {
    const link = links[i]!;
    check(
      cmd.setLinkCardinality(doc, link.id, parseCardinality(spec.cardinality)),
      `association « ${operation.name} »`,
    );
    if (spec.relativeIdentifier) {
      cmd.updateLink(doc, link.id, { relativeId: true });
    }
  });
  createdAttributes(doc, id, operation.attributes, `association « ${operation.name} »`);
  created[operation.name] = id;
  return `association ${operation.name} created`;
}

/** Association reliée à ses entités ; réflexive : deux pattes vers la même entité (override O-08). */
function linkedAssociation(doc: DocumentHandle, name: string, entities: Id[], spot: Point): Id {
  if (entities.length === 2 && entities[0] === entities[1]) {
    return reflexiveAssociation(doc, name, entities[0]!, spot);
  }
  const id = cmd.addAssociation(doc, spot);
  for (const entity of entities) {
    const result = cmd.addLink(doc, id, entity);
    if (!result || "error" in result) {
      return refuse(`association « ${name} »: ${result && "error" in result ? result.error : "link refused"}`);
    }
  }
  return id;
}

function reflexiveAssociation(doc: DocumentHandle, name: string, entity: Id, spot: Point): Id {
  const result = cmd.connectNodes(doc, entity, entity, { associationPosition: spot });
  if (!result || "error" in result) {
    return refuse(`association « ${name} »: ${result && "error" in result ? result.error : "not created"}`);
  }
  return result.created;
}

export function createInheritance(
  doc: DocumentHandle,
  operation: OperationOf<"create_inheritance">,
  placed: { n: number },
): string {
  const parent = resolve(current(doc), operation.parent, "entity");
  const children = operation.children.map((c) => resolve(current(doc), c, "entity"));
  if (children.length < 2) {
    refuse("an inheritance needs at least two child entities");
  }
  const id = cmd.addInheritance(doc, nextSpot(doc, placed));
  for (const entity of [parent, ...children]) {
    linkInheritance(doc, id, entity);
  }
  cmd.setInheritanceParent(doc, id, parent);
  if (operation.constraint) {
    cmd.setInheritanceConstraint(doc, id, operation.constraint);
  }
  return `inheritance ${operation.parent} → ${operation.children.join(", ")} created`;
}

function linkInheritance(doc: DocumentHandle, id: Id, entity: Id) {
  const result = cmd.addInheritanceLink(doc, id, entity);
  if (!result || "error" in result) {
    refuse(`inheritance: ${result && "error" in result ? result.error : "link refused"}`);
  }
}

export function replaceAttributes(
  doc: DocumentHandle,
  operation: OperationOf<"set_attributes" | "add_attributes">,
): string {
  const id = resolve(current(doc), operation.target);
  const { dbms } = current(doc).settings;
  const owner = [...current(doc).entities, ...current(doc).associations].find((n) => n.id === id);
  if (!owner) {
    return refuse(`« ${operation.target} » has no attributes`);
  }
  const next = operation.attributes.map((a) => toAttribute(a, dbms));
  check(
    cmd.setAttributes(doc, id, operation.op === "add_attributes" ? [...owner.attributes, ...next] : next),
    `attributes of « ${operation.target} »`,
  );
  return `attributes of ${operation.target} ${operation.op === "add_attributes" ? "extended" : "replaced"}`;
}

export function setLink(doc: DocumentHandle, operation: OperationOf<"set_link">): string {
  const association = resolve(current(doc), operation.association, "association");
  const entity = resolve(current(doc), operation.entity, "entity");
  const link = current(doc).links.find((l) => l.associationId === association && l.entityId === entity);
  if (!link) {
    return refuse(`no link between « ${operation.association} » and « ${operation.entity} »`);
  }
  if (operation.cardinality) {
    check(
      cmd.setLinkCardinality(doc, link.id, parseCardinality(operation.cardinality)),
      `link ${operation.association}–${operation.entity}`,
    );
  }
  if (operation.relativeIdentifier !== undefined) {
    cmd.updateLink(doc, link.id, { relativeId: operation.relativeIdentifier });
  }
  return `link ${operation.association}–${operation.entity} updated`;
}
