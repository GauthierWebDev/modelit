import type { Association, Entity, Link } from "../model/document";
import type { AlternateKey, IndexDefinition, KeyMember } from "../model/physical";
import { MSG } from "../validation/messages";
import type { LogicalColumn, LogicalKey, LogicalTable } from "./logical";
import {
  type Context,
  columnName,
  type KeyColumn,
  type Migration,
  memberKey,
  recordMembers,
  tableName,
} from "./mldContext";
import { addReference, entityKey, foreignKeysOf, migratedColumn } from "./mldKeys";

function attributeColumns(ctx: Context, owner: Entity | Association, table: string): LogicalColumn[] {
  for (const a of owner.attributes) {
    if (!a.type) {
      // Colonne calculée dont le type n'a pas pu être déduit de l'expression : à saisir (O-41).
      ctx.issues.push({
        severity: "warning",
        message: a.generated ? MSG.untypedComputed(owner.name, a.name) : MSG.untypedConceptual(owner.name, a.name),
        logicalMessage: a.generated
          ? MSG.untypedComputed(table, columnName(ctx, a, table, owner))
          : MSG.untypedLogical(table, columnName(ctx, a, table, owner)),
        target: { kind: owner.kind, id: owner.id },
      });
    }
  }
  return owner.attributes.map((a) => ({
    name: columnName(ctx, a, table, owner),
    attributeId: a.id,
    type: a.type,
    notNull: a.notNull,
    unique: a.unique,
    foreign: false,
    complement: a.complement,
    comment: a.comment,
    caseSensitive: a.caseSensitive,
    defaultValue: a.defaultValue,
    check: a.check,
    sourceType: a.sourceType,
    unsigned: a.unsigned,
    domain: a.domain,
    generated: a.generated,
    onUpdate: a.onUpdate,
    sequence: a.sequence,
    identity: a.identity,
    sqlServerOptions: a.sqlServerOptions,
  }));
}

/** Identifiants alternatifs, index, contraintes et ordre des colonnes d'origine (O-29). */
export function applyPhysical(ctx: Context, table: LogicalTable, node: Entity | Association) {
  const resolveAll = keyResolver(ctx, table, node);
  for (const key of node.alternateKeys ?? []) {
    const columns = resolveAll(key.members);
    if (columns) {
      applyAlternateKey(table, key, columns, resolveAll);
    }
  }
  for (const index of node.indexes ?? []) {
    const columns = resolveAll(index.members);
    if (columns) {
      table.indexes.push(logicalIndex(index, columns, resolveAll));
    }
  }
  table.checks.push(...(node.checks ?? []));
  applyTableOptions(table, node);
  if (ctx.doc.settings.ddl.sourceColumnOrder && node.columnOrder?.length) {
    table.columns = inSourceOrder(table.columns, node.columnOrder);
  }
}

function logicalIndex(index: IndexDefinition, columns: string[], resolveAll: Resolver): LogicalKey {
  return {
    name: index.name,
    columns,
    ...(index.prefixes ? { prefixes: index.prefixes } : {}),
    ...(index.method ? { method: index.method } : {}),
    ...(index.kind ? { kind: index.kind } : {}),
    ...(index.include && resolveAll(index.include) ? { include: resolveAll(index.include)! } : {}),
  };
}

/** Ordre des colonnes du script d'origine ; les autres gardent leur place relative, en fin. */
function inSourceOrder(columns: LogicalColumn[], columnOrder: string[]): LogicalColumn[] {
  const order = new Map(columnOrder.map((n, i) => [n.toLowerCase(), i]));
  const position = (c: LogicalColumn) => order.get(c.name.toLowerCase()) ?? Number.POSITIVE_INFINITY;
  return columns
    .map((c, i) => ({ c, i }))
    .sort((a, b) => position(a.c) - position(b.c) || a.i - b.i)
    .map(({ c }) => c);
}

type Resolver = (list: KeyMember[]) => string[] | null;

/** Colonnes des membres d'une clé (rubriques ou pattes), ou `null` si l'un n'a pas de colonne. */
function keyResolver(ctx: Context, table: LogicalTable, node: Entity | Association): Resolver {
  const members = ctx.members.get(table) ?? new Map<string, string>();
  const tableNameOf = table.name;
  const resolve = (member: KeyMember): string | undefined => {
    if ("attributeId" in member) {
      const attribute = node.attributes.find((a) => a.id === member.attributeId);
      return attribute && columnName(ctx, attribute, tableNameOf, node);
    }
    return members.get(memberKey(member.linkId, member.originId));
  };
  return (list: KeyMember[]) => {
    const names = list.map(resolve);
    return names.every((n): n is string => Boolean(n)) ? names : null;
  };
}

/** Identifiant alternatif → UNIQUE de la table (fusionné avec un UNIQUE identique). */
function applyAlternateKey(table: LogicalTable, key: AlternateKey, columns: string[], resolveAll: Resolver) {
  const options = alternateKeyOptions(key, resolveAll);
  // Unicité sur expression ou conditionnelle : jamais confondue avec un UNIQUE sur les colonnes (O-39).
  const partial = Boolean(key.prefixes || key.expression || key.where);
  const same = (u: LogicalKey) =>
    !(partial || u.prefixes || u.expression || u.where) &&
    u.columns.length === columns.length &&
    u.columns.every((c) => columns.includes(c));
  const existing = table.uniques.find(same);
  if (existing) {
    Object.assign(existing, { name: existing.name ?? key.name, ...options });
  } else {
    table.uniques.push({ name: key.name, columns, ...options });
  }
  // UNIQUE nommé (ou avec méthode, ou état) sur une seule colonne : la contrainte de table remplace la mention en ligne.
  if (columns.length === 1 && (key.name || key.method || key.state) && !partial) {
    const column = table.columns.find((c) => c.name === columns[0]);
    if (column) {
      column.unique = false;
    }
  }
}

function alternateKeyOptions(key: AlternateKey, resolveAll: Resolver) {
  return {
    ...(key.prefixes ? { prefixes: key.prefixes } : {}),
    ...(key.method ? { method: key.method } : {}),
    ...(key.state ? { state: key.state } : {}),
    ...(key.expression ? { expression: key.expression } : {}),
    ...(key.where ? { where: key.where } : {}),
    ...(key.nulls ? { nulls: key.nulls } : {}),
    ...(key.include && resolveAll(key.include) ? { include: resolveAll(key.include)! } : {}),
  };
}

/** Compteur, déclencheurs, état de la clé primaire, séquences, partitionnement, stockage, schéma. */
function applyTableOptions(table: LogicalTable, node: Entity | Association) {
  if (node.autoIncrementStart !== undefined) {
    table.identityStart = node.autoIncrementStart;
  }
  if (node.autoIncrementStep !== undefined) {
    table.identityStep = node.autoIncrementStep;
  }
  if (node.triggers?.length) {
    table.triggers = node.triggers;
  }
  if (node.primaryKeyState) {
    table.primaryKeyState = node.primaryKeyState;
  }
  if (node.sequences?.length) {
    table.sequences = node.sequences;
  }
  if (node.partition) {
    table.partition = node.partition;
  }
  if (node.storage?.length) {
    table.storage = node.storage;
  }
  if (node.schema) {
    table.schema = node.schema;
  }
}

export function entityTable(ctx: Context, entity: Entity): LogicalTable {
  const name = tableName(ctx, entity);
  const key = entityKey(ctx, entity.id);
  const inherited = key.filter((k): k is KeyColumn & { via: Migration } => k.via !== undefined);
  const table: LogicalTable = {
    name,
    source: { kind: "entity", id: entity.id },
    columns: [...inherited.map((k) => migratedColumn(k, false)), ...attributeColumns(ctx, entity, name)],
    primaryKey: key.map((k) => k.name),
    foreignKeys: foreignKeysOf(inherited),
    comment: entity.comment,
    caseSensitive: entity.caseSensitive,
    primaryKeyName: entity.primaryKeyName,
    uniques: [],
    checks: [],
    indexes: [],
  };
  recordMembers(ctx, table, inherited);
  if (table.primaryKey.length === 0) {
    ctx.issues.push({
      severity: "error",
      message: MSG.missingKeyConceptual(entity.name),
      logicalMessage: MSG.missingKeyLogical(table.name),
      target: { kind: "entity", id: entity.id },
    });
  }
  return table;
}

export function associationTable(ctx: Context, association: Association, links: Link[]): LogicalTable {
  const name = tableName(ctx, association);
  const table: LogicalTable = {
    name,
    source: { kind: "association", id: association.id },
    columns: [],
    primaryKey: [],
    foreignKeys: [],
    comment: association.comment,
    caseSensitive: association.caseSensitive,
    primaryKeyName: association.primaryKeyName,
    uniques: [],
    checks: [],
    indexes: [],
  };
  for (const link of links) {
    addReference(ctx, table, link, link, { notNull: true, inPrimaryKey: true });
  }
  table.columns.push(...attributeColumns(ctx, association, name));
  return table;
}

/**
 * Association binaire porteuse d'une DF : choisit la patte « côté 1 » qui reçoit la clé étrangère.
 * Cas 0,1/0,1 et 0,1/1,1 : non documentés ; choix provisoire = la patte (1,1), sinon la première —
 * sauf si la rétroconception a noté le côté d'origine de la clé (O-39).
 */
export function dependentSide(links: [Link, Link]): { child: Link; parent: Link } {
  const [a, b] = links;
  const aOne = a.cardinality.max === 1;
  const bOne = b.cardinality.max === 1;
  if (aOne && !bOne) {
    return { child: a, parent: b };
  }
  if (bOne && !aOne) {
    return { child: b, parent: a };
  }
  if (a.foreignKeyHolder && !b.foreignKeyHolder) {
    return { child: a, parent: b };
  }
  if (b.foreignKeyHolder && !a.foreignKeyHolder) {
    return { child: b, parent: a };
  }
  return b.cardinality.min === 1 && a.cardinality.min !== 1 ? { child: b, parent: a } : { child: a, parent: b };
}
