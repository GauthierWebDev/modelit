import type { Association, Entity, KeyMember } from "@core/index";
import * as cmd from "../commands";
import type { DocumentHandle } from "../document/handle";
import type { KeySpec, OperationOf } from "./operationTypes";
import { attributeOf, current, owner, refuse } from "./opSupport";

const nonEmpty = <T>(list: T[]): T[] | undefined => (list.length > 0 ? list : undefined);

/**
 * Annotations physiques d'une table (bloc « Avancé », O-29, O-50 ; IA : O-69) : casse du nom, nom de la clé
 * primaire, identifiants alternatifs, index, CHECK portant sur plusieurs colonnes. Chaque liste donnée remplace la
 * précédente ; une liste vide la vide. Les membres sont des rubriques de l'objet.
 */
export function setPhysical(doc: DocumentHandle, op: OperationOf<"set_physical">): string {
  const node = owner(current(doc), op.target);
  const { dbms } = current(doc).settings;
  const members = (spec: KeySpec): KeyMember[] => {
    if (spec.attributes.length === 0) {
      refuse(`« ${spec.name ?? "key"} » of « ${op.target} » has no attribute`);
    }
    return spec.attributes.map((ref) => ({ attributeId: attributeOf(node, ref).id }));
  };
  const named = (name: string | undefined) => (name?.trim() ? { name: name.trim() } : {});
  const alternateKeys = op.alternateKeys?.map((k) => ({ ...named(k.name), members: members(k) }));
  const indexes = op.indexes?.map((k) => ({ ...named(k.name), members: members(k) }));
  const checks = op.checks?.map((c) => {
    const expression = c.expression?.trim() || refuse(`empty CHECK on « ${op.target} »`);
    return { ...named(c.name), expression, dialect: dbms };
  });
  // Champs donnés seulement ; une liste vide retire l'annotation.
  const patch: Partial<Entity | Association> = {
    ...(op.caseSensitive === undefined ? {} : { caseSensitive: op.caseSensitive || undefined }),
    ...(op.primaryKeyName === undefined ? {} : { primaryKeyName: op.primaryKeyName.trim() || undefined }),
    ...(alternateKeys ? { alternateKeys: nonEmpty(alternateKeys) } : {}),
    ...(indexes ? { indexes: nonEmpty(indexes) } : {}),
    ...(checks ? { checks: nonEmpty(checks) } : {}),
  };
  cmd.updatePhysical(doc, node.id, (n: Entity | Association) => void Object.assign(n, patch));
  return `physical annotations of ${op.target} updated`;
}
