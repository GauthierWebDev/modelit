import { REFERENTIAL_ACTIONS, type ReferentialAction } from "@core/index";
import * as cmd from "../commands";
import type { DocumentHandle } from "../document/handle";
import type { OperationOf } from "./operationTypes";
import { attributeOf, check, current, linkOf, parseCardinality, refuse } from "./opSupport";

/** Opération de l'IA sur une patte (overrides O-47, O-69). */

/** Action référentielle donnée par l'IA ; chaîne vide : comportement par défaut. */
function action(value: string, what: string): ReferentialAction | undefined {
  if (value === "") {
    return undefined;
  }
  return REFERENTIAL_ACTIONS.includes(value as ReferentialAction)
    ? (value as ReferentialAction)
    : refuse(`invalid ${what} « ${value} » (expected ${REFERENTIAL_ACTIONS.join(", ")})`);
}

/**
 * Patte : cardinalité, identifiant relatif, rôle, ON DELETE / ON UPDATE, nom de la contrainte, libellé du trait
 * entre tables (O-25), noms des colonnes de clé étrangère (O-07 : rubrique référencée → nom de colonne).
 */
export function setLink(doc: DocumentHandle, op: OperationOf<"set_link">): string {
  const link = linkOf(current(doc), op);
  const context = `link ${op.link ?? `${op.association}–${op.entity}`}`;
  if (op.cardinality) {
    check(cmd.setLinkCardinality(doc, link.id, parseCardinality(op.cardinality)), context);
  }
  cmd.updateLink(doc, link.id, {
    ...(op.relativeIdentifier === undefined ? {} : { relativeId: op.relativeIdentifier }),
    ...(op.role === undefined ? {} : { role: op.role.trim() || undefined }),
    ...(op.onDelete === undefined ? {} : { onDelete: action(op.onDelete, "onDelete") }),
    ...(op.onUpdate === undefined ? {} : { onUpdate: action(op.onUpdate, "onUpdate") }),
    ...(op.constraintName === undefined ? {} : { foreignKeyConstraintName: op.constraintName.trim() || undefined }),
  });
  if (op.relationLabel !== undefined) {
    cmd.setRelationLabel(doc, link.id, op.relationLabel);
  }
  // Rubriques référencées : celles de l'entité visée par la patte (son identifiant migre).
  const entity = current(doc).entities.find((e) => e.id === link.entityId);
  for (const [ref, name] of Object.entries(op.foreignKeyNames ?? {})) {
    const attribute = entity ? attributeOf(entity, ref) : refuse(`${context}: entity not found`);
    check(cmd.renameForeignKey(doc, link.id, attribute.id, name), context);
  }
  return `${context} updated`;
}
