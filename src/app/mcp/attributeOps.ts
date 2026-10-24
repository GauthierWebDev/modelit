import { type Attribute, createAttribute, type Dbms, type Id, sqlTypeToDataType } from "@core/index";
import * as cmd from "../commands";
import type { DocumentHandle } from "../document/handle";
import type { AttributePatch, AttributeSpec, OperationOf } from "./operationTypes";
import { attributeOf, check, current, owner, refuse } from "./opSupport";

/** Opérations de l'IA sur les rubriques (overrides O-47, O-69). */

function dataType(text: string, name: string, dbms: Dbms) {
  const type = sqlTypeToDataType(text, false, dbms);
  return type ?? refuse(`unknown type « ${text} » for attribute « ${name} »`);
}

/**
 * Rubrique décrite par l'IA. `existing` (rubrique reconnue) : son identifiant et tout ce que la description ne
 * précise pas sont gardés — nom logique, annotations physiques, place dans les index (O-69).
 */
function toAttribute(spec: AttributeSpec, dbms: Dbms, existing?: Attribute): Attribute {
  const name = spec.name?.trim() || refuse("attribute without a name");
  const base = existing ?? createAttribute(name);
  const identifier = spec.identifier ?? base.identifier;
  const retyped = spec.type !== undefined && spec.type.trim() !== "";
  return {
    ...base,
    name,
    ...(retyped ? { type: dataType(spec.type!, name, dbms), sourceType: undefined } : {}),
    identifier,
    notNull: (spec.notNull ?? base.notNull) || identifier,
    unique: spec.unique ?? base.unique,
    ...(spec.comment === undefined ? {} : { comment: spec.comment || undefined }),
  };
}

/** Rubriques d'un objet créé par la demande, dans le type du SGBD cible. */
export function createdAttributes(
  doc: DocumentHandle,
  id: Id,
  attributes: AttributeSpec[] | undefined,
  context: string,
) {
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

/** Remplace (`set_attributes`) ou complète (`add_attributes`) les rubriques d'un objet. */
export function setAttributes(doc: DocumentHandle, op: OperationOf<"set_attributes" | "add_attributes">): string {
  const node = owner(current(doc), op.target);
  const { dbms } = current(doc).settings;
  const free = [...node.attributes];
  // Rubrique reconnue : par identifiant, sinon par nom (casse ignorée), une fois chacune.
  const take = (spec: AttributeSpec) => {
    const lower = spec.name?.trim().toLowerCase();
    const index = free.findIndex((a) => (spec.id ? a.id === spec.id : a.name.toLowerCase() === lower));
    return index < 0 ? undefined : free.splice(index, 1)[0];
  };
  const next =
    op.op === "add_attributes"
      ? [...node.attributes, ...op.attributes.map((a) => toAttribute(a, dbms))]
      : op.attributes.map((a) => toAttribute(a, dbms, take(a)));
  check(cmd.setAttributes(doc, node.id, next), `attributes of « ${op.target} »`);
  return `attributes of ${op.target} ${op.op === "add_attributes" ? "extended" : "replaced"}`;
}

/** Champs d'une rubrique modifiés par `update_attribute` ; chaîne vide = valeur retirée. */
function patched(a: Attribute, patch: AttributePatch, dbms: Dbms): Attribute {
  const text = (value: string | undefined, previous: string | undefined) =>
    value === undefined ? previous : value.trim() || undefined;
  const expression = (value: string) => (value.trim() ? { expression: value.trim(), dialect: dbms } : undefined);
  const spec: AttributeSpec = {
    name: patch.name ?? a.name,
    ...(patch.type === undefined ? {} : { type: patch.type }),
    ...(patch.identifier === undefined ? {} : { identifier: patch.identifier }),
    ...(patch.notNull === undefined ? {} : { notNull: patch.notNull }),
    ...(patch.unique === undefined ? {} : { unique: patch.unique }),
    ...(patch.comment === undefined ? {} : { comment: patch.comment }),
  };
  return {
    ...toAttribute(spec, dbms, a),
    logicalName: text(patch.logicalName, a.logicalName),
    complement: text(patch.complement, a.complement),
    ...(patch.default === undefined ? {} : { defaultValue: expression(patch.default) }),
    ...(patch.check === undefined ? {} : { check: expression(patch.check) }),
    ...(patch.unsigned === undefined ? {} : { unsigned: patch.unsigned || undefined }),
    ...(patch.caseSensitive === undefined ? {} : { caseSensitive: patch.caseSensitive || undefined }),
  };
}

/** Modifie une rubrique sans la recréer ; `sqlType` : type exact de la colonne dans le MPD (O-59). */
export function updateAttribute(doc: DocumentHandle, op: OperationOf<"update_attribute">): string {
  const node = owner(current(doc), op.target);
  const attribute = attributeOf(node, op.attribute);
  const next = patched(attribute, op, current(doc).settings.dbms);
  const context = `attribute « ${op.attribute} » of « ${op.target} »`;
  check(
    cmd.setAttributes(
      doc,
      node.id,
      node.attributes.map((a) => (a.id === attribute.id ? next : a)),
    ),
    context,
  );
  if (op.sqlType !== undefined) {
    check(cmd.setColumnSqlType(doc, node.id, attribute.id, op.sqlType), context);
  }
  return `attribute ${op.attribute} of ${op.target} updated`;
}

export function addAutoIdentifier(doc: DocumentHandle, op: OperationOf<"add_auto_identifier">): string {
  const node = owner(current(doc), op.target);
  if (node.kind !== "entity") {
    refuse(`« ${op.target} » is not an entity`);
  }
  check(cmd.addAutoIdentifier(doc, node.id), `automatic identifier of « ${op.target} »`);
  return `automatic identifier added to ${op.target}`;
}
