import type { Dbms, Id, InheritanceConstraint } from "@core/index";
import * as cmd from "../commands";
import type { Recipe } from "../document/documentStore";
import { createDocumentHandle, type DocumentHandle } from "../document/handle";
import {
  check,
  createAssociation,
  createEntity,
  createInheritance,
  current,
  Refused,
  refuse,
  replaceAttributes,
  resolve,
  setLink,
} from "./operations";

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

function applyOne(
  doc: DocumentHandle,
  operation: Operation,
  created: Record<string, Id>,
  placed: { n: number },
): string {
  switch (operation.op) {
    case "create_entity":
      return createEntity(doc, operation, created, placed);
    case "create_association":
      return createAssociation(doc, operation, created, placed);
    case "create_inheritance":
      return createInheritance(doc, operation, placed);
    case "rename": {
      const id = resolve(current(doc), operation.target);
      check(cmd.renameNode(doc, id, operation.name), `rename « ${operation.target} »`);
      return `${operation.target} renamed to ${operation.name}`;
    }
    case "set_attributes":
    case "add_attributes":
      return replaceAttributes(doc, operation);
    case "set_link":
      return setLink(doc, operation);
    case "delete": {
      const ids = operation.targets.map((t) => resolve(current(doc), t));
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
          throw new Refused(`operation ${i + 1} (${operation.op}): ${e.message}`, { cause: e });
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
