import type { Association, Attribute, Entity, KeyMember, Link } from "@core/index";

/**
 * Annotations physiques montrées à l'IA avec `get_model { detail: "full" }` (overrides O-29, O-69) ; seules les
 * annotations présentes sont écrites. Expressions telles qu'écrites (DEFAULT, CHECK, colonnes calculées).
 */

const present = (entries: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(entries).filter(([, v]) => v !== undefined && v !== false && v !== ""));

export function attributePhysical(a: Attribute) {
  return present({
    complement: a.complement,
    keyOrder: a.keyOrder,
    autoKey: a.autoKey,
    default: a.defaultValue?.expression,
    check: a.check?.expression,
    unsigned: a.unsigned,
    caseSensitive: a.caseSensitive,
    domain: a.domain ? { kind: a.domain.kind, values: a.domain.values } : undefined,
    generated: a.generated ? { expression: a.generated.expression, stored: a.generated.stored } : undefined,
    onUpdate: a.onUpdate?.expression,
    sequence: a.sequence?.name,
    identity: a.identity,
  });
}

/** Membre d'un identifiant alternatif ou d'un index : nom de la rubrique, ou colonne de clé étrangère. */
function memberName(node: Entity | Association, member: KeyMember): string {
  if ("attributeId" in member) {
    return node.attributes.find((a) => a.id === member.attributeId)?.name ?? member.attributeId;
  }
  return `foreign key of link ${member.linkId}`;
}

export function nodePhysical(n: Entity | Association) {
  const keys = (list: { name?: string; members: KeyMember[] }[] | undefined) =>
    list?.map((k) => present({ name: k.name, attributes: k.members.map((m) => memberName(n, m)) }));
  return present({
    caseSensitive: n.caseSensitive,
    primaryKeyName: n.primaryKeyName,
    alternateKeys: keys(n.alternateKeys),
    indexes: keys(n.indexes),
    checks: n.checks?.map((c) => present({ name: c.name, expression: c.expression })),
    schema: n.schema,
    autoIncrementStart: n.autoIncrementStart,
    autoIncrementStep: n.autoIncrementStep,
    triggers: n.triggers?.length,
  });
}

export function linkPhysical(l: Link) {
  return present({
    onDelete: l.onDelete,
    onUpdate: l.onUpdate,
    constraintName: l.foreignKeyConstraintName,
    relationLabel: l.relationLabel,
  });
}
