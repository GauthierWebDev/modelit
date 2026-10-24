import { type Id, type Point, toLogicalModel } from "@core/index";
import * as cmd from "../commands";
import type { DocumentHandle } from "../document/handle";
import { createdAttributes } from "./attributeOps";
import type { OperationOf } from "./operationTypes";
import { type ApplyContext, check, current, nextSpot, owner, parseCardinality, refuse, resolve } from "./opSupport";

/** Opérations de l'IA sur les objets du MCD : création, renommage, suppression, modification (O-47, O-69). */

export function createEntity(doc: DocumentHandle, op: OperationOf<"create_entity">, ctx: ApplyContext): string {
  const id = cmd.addEntity(doc, nextSpot(doc, ctx));
  check(cmd.renameNode(doc, id, op.name), `entity « ${op.name} »`);
  createdAttributes(doc, id, op.attributes, `entity « ${op.name} »`);
  ctx.created[op.name] = id;
  return `entity ${op.name} created`;
}

export function createAssociation(
  doc: DocumentHandle,
  op: OperationOf<"create_association">,
  ctx: ApplyContext,
): string {
  if (op.links.length < 2) {
    refuse(`association « ${op.name} »: at least two links are needed`);
  }
  const entities = op.links.map((l) => resolve(current(doc), l.entity, "entity"));
  const id = linkedAssociation(doc, op.name, entities, nextSpot(doc, ctx));
  check(cmd.renameNode(doc, id, op.name), `association « ${op.name} »`);
  const links = current(doc).links.filter((l) => l.associationId === id);
  op.links.forEach((spec, i) => {
    const link = links[i]!;
    check(cmd.setLinkCardinality(doc, link.id, parseCardinality(spec.cardinality)), `association « ${op.name} »`);
    if (spec.relativeIdentifier) {
      cmd.updateLink(doc, link.id, { relativeId: true });
    }
  });
  createdAttributes(doc, id, op.attributes, `association « ${op.name} »`);
  ctx.created[op.name] = id;
  return `association ${op.name} created`;
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
  op: OperationOf<"create_inheritance">,
  ctx: ApplyContext,
): string {
  const parent = resolve(current(doc), op.parent, "entity");
  const children = op.children.map((c) => resolve(current(doc), c, "entity"));
  if (children.length < 2) {
    refuse("an inheritance needs at least two child entities");
  }
  const id = cmd.addInheritance(doc, nextSpot(doc, ctx));
  for (const entity of [parent, ...children]) {
    linkInheritance(doc, id, entity);
  }
  cmd.setInheritanceParent(doc, id, parent);
  if (op.constraint) {
    cmd.setInheritanceConstraint(doc, id, op.constraint);
  }
  return `inheritance ${op.parent} → ${op.children.join(", ")} created`;
}

function linkInheritance(doc: DocumentHandle, id: Id, entity: Id) {
  const result = cmd.addInheritanceLink(doc, id, entity);
  if (!result || "error" in result) {
    refuse(`inheritance: ${result && "error" in result ? result.error : "link refused"}`);
  }
}

export function rename(doc: DocumentHandle, op: OperationOf<"rename">): string {
  const id = resolve(current(doc), op.target);
  check(cmd.renameNode(doc, id, op.name), `rename « ${op.target} »`);
  return `${op.target} renamed to ${op.name}`;
}

export function remove(doc: DocumentHandle, op: OperationOf<"delete">): string {
  const ids = op.targets.map((t) => resolve(current(doc), t));
  cmd.deleteObjects(doc, ids);
  return `deleted: ${op.targets.join(", ")}`;
}

/**
 * Entité ou association : nom, nom de sa table (validé comme un renommage dans le MLD, O-56), commentaire,
 * fictive (entité).
 */
export function updateNode(doc: DocumentHandle, op: OperationOf<"update_node">): string {
  const node = owner(current(doc), op.target);
  const context = `« ${op.target} »`;
  if (op.name !== undefined) {
    check(cmd.renameNode(doc, node.id, op.name), context);
  }
  if (op.logicalName !== undefined) {
    const logical = toLogicalModel(current(doc));
    const table = logical.tables.find((t) => t.source.id === node.id) ?? refuse(`${context} has no table`);
    check(cmd.renameLogical(doc, logical, table, null, op.logicalName), context);
  }
  const comment = op.comment === undefined ? {} : { comment: op.comment.trim() || undefined };
  if (node.kind === "entity") {
    cmd.updateEntity(doc, node.id, { ...comment, ...(op.fictive === undefined ? {} : { fictive: op.fictive }) });
  } else {
    if (op.fictive !== undefined) {
      refuse(`${context} is an association: only entities are fictive`);
    }
    check(cmd.updateAssociation(doc, node.id, comment), context);
  }
  return `${op.target} updated`;
}

/** Héritage : parent, contrainte, commentaire, sous-types ajoutés ou retirés. */
export function updateInheritance(doc: DocumentHandle, op: OperationOf<"update_inheritance">): string {
  const id = resolve(current(doc), op.target);
  if (!current(doc).inheritances.some((h) => h.id === id)) {
    refuse(`« ${op.target} » is not an inheritance`);
  }
  for (const child of op.addChildren ?? []) {
    linkInheritance(doc, id, resolve(current(doc), child, "entity"));
  }
  const removed = (op.removeChildren ?? []).map((child) => {
    const entity = resolve(current(doc), child, "entity");
    const link = current(doc).inheritanceLinks.find((l) => l.inheritanceId === id && l.entityId === entity);
    return link?.id ?? refuse(`« ${child} » is not linked to this inheritance`);
  });
  if (removed.length > 0) {
    cmd.deleteObjects(doc, removed);
  }
  if (op.parent !== undefined) {
    const parent = resolve(current(doc), op.parent, "entity");
    if (!current(doc).inheritanceLinks.some((l) => l.inheritanceId === id && l.entityId === parent)) {
      linkInheritance(doc, id, parent);
    }
    cmd.setInheritanceParent(doc, id, parent);
  }
  if (op.constraint !== undefined) {
    cmd.setInheritanceConstraint(doc, id, op.constraint);
  }
  if (op.comment !== undefined) {
    cmd.updateInheritance(doc, id, { comment: op.comment.trim() || undefined });
  }
  return `inheritance ${op.target} updated`;
}
