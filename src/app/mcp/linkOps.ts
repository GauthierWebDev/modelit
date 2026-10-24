import { REFERENTIAL_ACTIONS, type ReferentialAction } from "@core/index";
import * as cmd from "../commands";
import type { DocumentHandle } from "../document/handle";
import type { OperationOf } from "./operationTypes";
import { attributeOf, check, current, linkOf, parseCardinality, refuse, resolve } from "./opSupport";

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
  const inheritanceLink = op.link ? current(doc).inheritanceLinks.find((l) => l.id === op.link) : undefined;
  if (inheritanceLink) {
    return setInheritanceLinkLabel(doc, op);
  }
  const link = linkOf(current(doc), op);
  const context = `link ${op.link ?? `${op.association}–${op.entity}`}`;
  if (op.cardinality) {
    check(cmd.setLinkCardinality(doc, link.id, parseCardinality(op.cardinality)), context);
  }
  cmd.updateLink(doc, link.id, linkPatch(op));
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

/** Champs de la patte donnés par l'IA ; chaîne vide = valeur retirée. */
const linkPatch = (op: OperationOf<"set_link">) => ({
  ...(op.relativeIdentifier === undefined ? {} : { relativeId: op.relativeIdentifier }),
  ...(op.role === undefined ? {} : { role: op.role.trim() || undefined }),
  ...(op.onDelete === undefined ? {} : { onDelete: action(op.onDelete, "onDelete") }),
  ...(op.onUpdate === undefined ? {} : { onUpdate: action(op.onUpdate, "onUpdate") }),
  ...(op.constraintName === undefined ? {} : { foreignKeyConstraintName: op.constraintName.trim() || undefined }),
});

/** Lien d'héritage : seul le texte de son trait entre tables se règle (O-25), comme dans l'interface. */
function setInheritanceLinkLabel(doc: DocumentHandle, op: OperationOf<"set_link">): string {
  const { link, relationLabel, ...rest } = op;
  const other = Object.keys(rest).filter((k) => k !== "op" && rest[k as keyof typeof rest] !== undefined);
  if (other.length > 0) {
    refuse(`inheritance link « ${link} »: only relationLabel can be set (not ${other.join(", ")})`);
  }
  if (relationLabel !== undefined) {
    cmd.setRelationLabel(doc, link!, relationLabel);
  }
  return `inheritance link ${link} updated`;
}

/** Nouvelle patte d'une association existante (association n-aire), avec sa cardinalité. */
export function addLink(doc: DocumentHandle, op: OperationOf<"add_link">): string {
  const association = resolve(current(doc), op.association, "association");
  const entity = resolve(current(doc), op.entity, "entity");
  const context = `link ${op.association}–${op.entity}`;
  const result = cmd.addLink(doc, association, entity);
  if (!result || "error" in result) {
    return refuse(`${context}: ${result && "error" in result ? result.error : "refused"}`);
  }
  if (op.cardinality) {
    check(cmd.setLinkCardinality(doc, result.created, parseCardinality(op.cardinality)), context);
  }
  if (op.relativeIdentifier) {
    cmd.updateLink(doc, result.created, { relativeId: true });
  }
  return `${context} added`;
}
