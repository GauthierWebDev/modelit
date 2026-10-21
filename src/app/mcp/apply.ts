import {
  type Attribute,
  type Cardinality,
  createAttribute,
  type Dbms,
  diagramNodes,
  type Id,
  type InheritanceConstraint,
  type ModelDocument,
  type Point,
  positionOf,
  sqlTypeToDataType,
} from "@core/index";
import * as cmd from "../commands";
import type { Recipe } from "../document/documentStore";
import { createDocumentHandle, type DocumentHandle } from "../document/handle";

/**
 * Modifications demandées par un assistant IA (override O-47). Une demande est une liste
 * d'opérations appliquées dans l'ordre à une copie du document, avec les commandes de l'interface
 * (mêmes validations). Tout réussit, ou rien n'est appliqué. Le résultat entre dans l'historique
 * en une seule entrée « IA : … ».
 *
 * Les objets sont désignés par identifiant ou par nom (entités, associations).
 */

export interface AttributeSpec {
  name: string;
  /** Type SQL (« VARCHAR(50) », « INT », « DATE »…), interprété comme en rétroconception. */
  type?: string;
  identifier?: boolean;
  notNull?: boolean;
  unique?: boolean;
  comment?: string;
}

export interface LinkSpec {
  entity: string;
  /** « 0,1 », « 1,1 », « 0,n », « 1,n »… */
  cardinality: string;
  relativeIdentifier?: boolean;
}

export type Operation =
  | { op: "create_entity"; name: string; attributes?: AttributeSpec[] }
  | { op: "create_association"; name: string; links: LinkSpec[]; attributes?: AttributeSpec[] }
  | { op: "create_inheritance"; parent: string; children: string[]; constraint?: InheritanceConstraint }
  | { op: "rename"; target: string; name: string }
  | { op: "set_attributes"; target: string; attributes: AttributeSpec[] }
  | { op: "add_attributes"; target: string; attributes: AttributeSpec[] }
  | { op: "set_link"; association: string; entity: string; cardinality?: string; relativeIdentifier?: boolean }
  | { op: "delete"; targets: string[] }
  | { op: "set_dbms"; dbms: Dbms; version?: string };

export type ApplyResult = { ok: true; summary: string[]; created: Record<string, Id> } | { ok: false; error: string };

class Refused extends Error {}

const refuse = (message: string): never => {
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
function resolve(doc: ModelDocument, ref: string, kind?: "entity" | "association"): Id {
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

const check = (message: string | null, context: string) => message && refuse(`${context}: ${message}`);

function applyOne(
  doc: DocumentHandle,
  operation: Operation,
  created: Record<string, Id>,
  placed: { n: number },
): string {
  const current = () => doc.store.getState().doc;
  switch (operation.op) {
    case "create_entity": {
      const spot = freeSpot(current(), placed.n);
      placed.n += 1;
      const id = cmd.addEntity(doc, spot);
      check(cmd.renameNode(doc, id, operation.name), `entity « ${operation.name} »`);
      if (operation.attributes?.length) {
        const dbms = current().settings.dbms;
        check(
          cmd.setAttributes(
            doc,
            id,
            operation.attributes.map((a) => toAttribute(a, dbms)),
          ),
          `entity « ${operation.name} »`,
        );
      }
      created[operation.name] = id;
      return `entity ${operation.name} created`;
    }
    case "create_association": {
      if (operation.links.length < 2) {
        refuse(`association « ${operation.name} »: at least two links are needed`);
      }
      const entities = operation.links.map((l) => resolve(current(), l.entity, "entity"));
      let id: Id;
      const spot = freeSpot(current(), placed.n);
      placed.n += 1;
      if (entities.length === 2 && entities[0] === entities[1]) {
        // Réflexive : deux pattes vers la même entité (override O-08).
        const result = cmd.connectNodes(doc, entities[0]!, entities[1]!, { associationPosition: spot });
        if (!result || "error" in result) {
          return refuse(
            `association « ${operation.name} »: ${result && "error" in result ? result.error : "not created"}`,
          );
        }
        id = result.created;
      } else {
        id = cmd.addAssociation(doc, spot);
        for (const entity of entities) {
          const result = cmd.addLink(doc, id, entity);
          if (!result || "error" in result) {
            return refuse(
              `association « ${operation.name} »: ${result && "error" in result ? result.error : "link refused"}`,
            );
          }
        }
      }
      check(cmd.renameNode(doc, id, operation.name), `association « ${operation.name} »`);
      const links = current().links.filter((l) => l.associationId === id);
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
      if (operation.attributes?.length) {
        const dbms = current().settings.dbms;
        check(
          cmd.setAttributes(
            doc,
            id,
            operation.attributes.map((a) => toAttribute(a, dbms)),
          ),
          `association « ${operation.name} »`,
        );
      }
      created[operation.name] = id;
      return `association ${operation.name} created`;
    }
    case "create_inheritance": {
      const parent = resolve(current(), operation.parent, "entity");
      const children = operation.children.map((c) => resolve(current(), c, "entity"));
      if (children.length < 2) {
        refuse("an inheritance needs at least two child entities");
      }
      const spot = freeSpot(current(), placed.n);
      placed.n += 1;
      const id = cmd.addInheritance(doc, spot);
      for (const entity of [parent, ...children]) {
        const result = cmd.addInheritanceLink(doc, id, entity);
        if (!result || "error" in result) {
          return refuse(`inheritance: ${result && "error" in result ? result.error : "link refused"}`);
        }
      }
      cmd.setInheritanceParent(doc, id, parent);
      if (operation.constraint) {
        cmd.setInheritanceConstraint(doc, id, operation.constraint);
      }
      return `inheritance ${operation.parent} → ${operation.children.join(", ")} created`;
    }
    case "rename": {
      const id = resolve(current(), operation.target);
      check(cmd.renameNode(doc, id, operation.name), `rename « ${operation.target} »`);
      return `${operation.target} renamed to ${operation.name}`;
    }
    case "set_attributes":
    case "add_attributes": {
      const id = resolve(current(), operation.target);
      const dbms = current().settings.dbms;
      const owner = [...current().entities, ...current().associations].find((n) => n.id === id);
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
    case "set_link": {
      const association = resolve(current(), operation.association, "association");
      const entity = resolve(current(), operation.entity, "entity");
      const link = current().links.find((l) => l.associationId === association && l.entityId === entity);
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
    case "delete": {
      const ids = operation.targets.map((t) => resolve(current(), t));
      cmd.deleteObjects(doc, ids);
      return `deleted: ${operation.targets.join(", ")}`;
    }
    case "set_dbms": {
      cmd.setTargetDbms(doc, operation.dbms);
      if (operation.version) {
        cmd.setDbmsVersion(doc, operation.version);
      }
      return `target DBMS set to ${operation.dbms}${operation.version ? ` ${operation.version}` : ""}`;
    }
    default:
      return refuse(`unknown operation « ${(operation as { op?: string }).op} »`);
  }
}

/** Applique une demande à `target` : tout ou rien, en une entrée d'historique. */
export function applyChanges(target: DocumentHandle, operations: Operation[]): ApplyResult {
  if (!Array.isArray(operations) || operations.length === 0) {
    return { ok: false, error: "no operation" };
  }
  const scratch = createDocumentHandle(target.store.getState().doc);
  const created: Record<string, Id> = {};
  const summary: string[] = [];
  const placed = { n: 0 };
  try {
    operations.forEach((operation, i) => {
      try {
        summary.push(applyOne(scratch, operation, created, placed));
      } catch (e) {
        if (e instanceof Refused) {
          throw new Refused(`operation ${i + 1} (${operation.op}): ${e.message}`);
        }
        throw e;
      }
    });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  const result = scratch.store.getState().doc;
  // Recette qui remplace le document entier par le résultat (Immer accepte une valeur renvoyée).
  target.store.getState().change("history.ai", (() => result) as unknown as Recipe);
  return { ok: true, summary, created };
}
