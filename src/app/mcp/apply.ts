import type { Id } from "@core/index";
import type { Recipe } from "../document/documentStore";
import { createDocumentHandle, type DocumentHandle } from "../document/handle";
import { addAutoIdentifier, setAttributes, updateAttribute } from "./attributeOps";
import { setLink } from "./linkOps";
import type { Operation, OperationOf } from "./operationTypes";
import { type ApplyContext, Refused, refuse } from "./opSupport";
import { setPhysical } from "./physicalOps";
import {
  customizeDbms,
  removeCustomization,
  resetCustomTypes,
  setCustomType,
  setDbms,
  setSettings,
} from "./settingsOps";
import {
  createAssociation,
  createEntity,
  createInheritance,
  remove,
  rename,
  updateInheritance,
  updateNode,
} from "./structureOps";

export type { AttributeSpec, LinkSpec, Operation } from "./operationTypes";

/**
 * Modifications demandées par un assistant IA (overrides O-47, O-69). Une demande est une liste d'opérations
 * appliquées dans l'ordre à une copie du document, avec les commandes de l'interface (mêmes validations). Tout
 * réussit, ou rien n'est appliqué. Le résultat entre dans l'historique en une seule entrée « IA : … ».
 */

export type ApplyResult = { ok: true; summary: string[]; created: Record<string, Id> } | { ok: false; error: string };

type Handler<K extends Operation["op"]> = (doc: DocumentHandle, op: OperationOf<K>, ctx: ApplyContext) => string;

/**
 * Une opération = un traitement, rangé par famille (structure, rubriques, pattes, physique, paramètres). Table
 * typée exhaustive : une opération ajoutée au type `Operation` sans traitement ne compile pas.
 */
const HANDLERS: { [K in Operation["op"]]: Handler<K> } = {
  create_entity: createEntity,
  create_association: createAssociation,
  create_inheritance: createInheritance,
  rename,
  delete: remove,
  update_node: updateNode,
  update_inheritance: updateInheritance,
  set_attributes: setAttributes,
  add_attributes: setAttributes,
  update_attribute: updateAttribute,
  add_auto_identifier: addAutoIdentifier,
  set_link: setLink,
  set_physical: setPhysical,
  set_dbms: setDbms,
  set_settings: setSettings,
  customize_dbms: customizeDbms,
  set_custom_type: setCustomType,
  reset_custom_types: resetCustomTypes,
  remove_customization: removeCustomization,
};

function applyOne(doc: DocumentHandle, operation: Operation, ctx: ApplyContext): string {
  const handler = HANDLERS[operation.op] as Handler<Operation["op"]> | undefined;
  return handler ? handler(doc, operation, ctx) : refuse(`unknown operation « ${(operation as { op?: string }).op} »`);
}

/** Applique une demande à `target` : tout ou rien, en une entrée d'historique. */
export function applyChanges(target: DocumentHandle, operations: Operation[]): ApplyResult {
  if (!Array.isArray(operations) || operations.length === 0) {
    return { ok: false, error: "no operation" };
  }
  const scratch = createDocumentHandle(target.store.getState().doc);
  const ctx: ApplyContext = { created: {}, placed: { n: 0 } };
  const summary: string[] = [];
  try {
    operations.forEach((operation, i) => {
      try {
        summary.push(applyOne(scratch, operation, ctx));
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
  return { ok: true, summary, created: ctx.created };
}
