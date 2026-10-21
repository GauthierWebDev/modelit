import { foreignKeyDataType } from "../dbms/typeMapping";
import type { Entity, Id, Link } from "../model/document";
import type { SourceType } from "../model/physical";
import { foreignKeyDefaultName, uniqueName } from "../naming/keys";
import { MSG } from "../validation/messages";
import { linksOf } from "../validation/rules";
import type { LogicalColumn, LogicalForeignKey, LogicalTable } from "./logical";
import {
  byKeyOrder,
  type Context,
  columnName,
  type KeyColumn,
  type Migration,
  recordMembers,
  tableName,
} from "./mldContext";

/**
 * Colonnes migrées depuis la clé `key` de `referencedTable`, par la patte `reference` :
 * renommage explicite, sinon masque de clé étrangère + suffixe si le nom est pris (`used`).
 */
function migrate(
  ctx: Context,
  key: KeyColumn[],
  reference: Link,
  cascade: Link,
  referencedTable: string,
  fictive: boolean,
  used: Set<string>,
): (KeyColumn & { via: Migration })[] {
  return key.map((k) => {
    const base = foreignKeyDefaultName(ctx.doc.settings.keys.foreign, referencedTable, k.name, key.length === 1);
    const wanted = reference.foreignKeyNames?.[k.originId]?.trim() || base;
    // Colonne partagée (O-29) : elle existe déjà dans la table, la clé étrangère la réutilise.
    const reused = Boolean(reference.sharedColumns?.includes(k.originId) && used.has(wanted));
    const defaultName = reused ? base : uniqueName(base, used);
    const name = reused ? wanted : reference.foreignKeyNames?.[k.originId]?.trim() || defaultName;
    used.add(name);
    return {
      name,
      type: foreignKeyDataType(k.type),
      sourceType: foreignSourceType(k),
      unsigned: k.unsigned,
      originId: k.originId,
      via: {
        groupId: reference.id,
        reference,
        onDelete: cascade.onDelete,
        onUpdate: cascade.onUpdate,
        constraintName: cascade.foreignKeyConstraintName,
        state: cascade.foreignKeyState,
        referencedTable,
        referencedColumn: k.name,
        fictive,
        defaultName,
        reused,
      },
    };
  });
}

/** Patte d'identifiant relatif d'une entité : (1,1) marquée (R) sur une association binaire. */
function relativeLinks(ctx: Context, entityId: Id): { link: Link; parent: Link }[] {
  const result: { link: Link; parent: Link }[] = [];
  for (const link of ctx.doc.links) {
    if (link.entityId !== entityId || !link.relativeId) {
      continue;
    }
    if (link.cardinality.min !== 1 || link.cardinality.max !== 1) {
      continue;
    }
    const others = linksOf(ctx.doc, link.associationId).filter((l) => l.id !== link.id);
    if (others.length === 1) {
      result.push({ link, parent: others[0]! });
    }
  }
  return result;
}

/**
 * Clé primaire d'une entité : clés des entités dont elle dépend par identifiant relatif,
 * puis ses rubriques identifiantes. Détecte les références circulaires.
 */
export function entityKey(ctx: Context, entityId: Id, visiting = new Set<Id>()): KeyColumn[] {
  const cached = ctx.keys.get(entityId);
  if (cached) {
    return cached;
  }
  const entity = ctx.entities.get(entityId);
  if (!entity) {
    return [];
  }
  if (visiting.has(entityId)) {
    ctx.issues.push({ severity: "error", message: MSG.circularReferences, target: { kind: "entity", id: entityId } });
    return [];
  }
  visiting.add(entityId);

  // Sous-type : la clé est celle du surtype, à l'identique (clé primaire et étrangère).
  const inheritance = ctx.parents.get(entityId);
  if (inheritance) {
    const parent = ctx.entities.get(inheritance.parentId)!;
    const parentKey = entityKey(ctx, parent.id, visiting);
    visiting.delete(entityId);
    if (entity.attributes.some((a) => a.identifier)) {
      ctx.issues.push({
        severity: "warning",
        message: MSG.subtypeKeyConceptual(entity.name),
        logicalMessage: MSG.subtypeKeyLogical(tableName(ctx, entity)),
        target: { kind: "entity", id: entityId },
      });
    }
    const referencedTable = tableName(ctx, parent);
    const childLink = ctx.doc.inheritanceLinks.find((l) => l.id === inheritance.linkId);
    const key = parentKey.map((k) => ({
      // Nom propre à l'entité spécialisée (ex. adherent_premium.adherent_id → adherent.id) (O-36).
      name: childLink?.foreignKeyNames?.[k.originId]?.trim() || k.name,
      type: foreignKeyDataType(k.type),
      sourceType: foreignSourceType(k),
      unsigned: k.unsigned,
      originId: k.originId,
      via: {
        groupId: inheritance.linkId,
        onDelete: childLink?.onDelete,
        onUpdate: childLink?.onUpdate,
        constraintName: childLink?.foreignKeyConstraintName,
        state: childLink?.foreignKeyState,
        referencedTable,
        referencedColumn: k.name,
        fictive: parent.fictive,
        defaultName: k.name,
      },
    }));
    ctx.keys.set(entityId, key);
    return key;
  }

  const table = tableName(ctx, entity);
  const own: KeyColumn[] = byKeyOrder(entity.attributes.filter((a) => a.identifier)).map((a) => ({
    name: columnName(ctx, a, table, entity),
    type: a.type,
    sourceType: a.sourceType,
    unsigned: a.unsigned,
    originId: a.id,
  }));
  const used = new Set(own.map((k) => k.name));
  const inherited = relativeLinks(ctx, entityId).flatMap(({ link, parent }) => {
    const parentEntity = ctx.entities.get(parent.entityId)!;
    const parentKey = entityKey(ctx, parentEntity.id, visiting);
    return migrate(ctx, parentKey, parent, link, tableName(ctx, parentEntity), parentEntity.fictive, used);
  });
  visiting.delete(entityId);
  const key = [...inherited, ...own];
  ctx.keys.set(entityId, key);
  return key;
}

/** Type d'origine d'une clé étrangère : celui de la colonne référencée, sans l'auto-incrément. */
function foreignSourceType(k: KeyColumn): SourceType | undefined {
  if (!k.sourceType) {
    return undefined;
  }
  if (k.type?.kind !== "counter") {
    return k.sourceType;
  }
  const plain: Record<string, string> = {
    serial: "integer",
    serial4: "integer",
    bigserial: "bigint",
    serial8: "bigint",
    smallserial: "smallint",
    counter: "long",
    autoincrement: "long",
  };
  const original = k.sourceType.sql.trim();
  const mapped = plain[original.toLowerCase()];
  const sql = mapped === undefined ? original : original === original.toUpperCase() ? mapped.toUpperCase() : mapped;
  return { ...k.sourceType, sql };
}

export const migratedColumn = (k: KeyColumn & { via: Migration }, notNull: boolean): LogicalColumn => ({
  name: k.name,
  type: k.type,
  sourceType: k.sourceType,
  unsigned: k.unsigned,
  comment: k.via.reference?.foreignKeyComments?.[k.originId],
  notNull,
  unique: false,
  // L'identifiant d'une entité fictive est une simple colonne, sans contrainte FK.
  foreign: !k.via.fictive,
  // Seules les colonnes migrées par une patte sont renommables (O-07).
  origin: k.via.reference
    ? { linkId: k.via.reference.id, attributeId: k.originId, defaultName: k.via.defaultName }
    : undefined,
});

/** Regroupe en contraintes FOREIGN KEY les colonnes migrées par une même patte. */
export function foreignKeysOf(columns: (KeyColumn & { via: Migration })[]): LogicalForeignKey[] {
  const groups = new Map<Id, LogicalForeignKey>();
  for (const { name, via } of columns) {
    if (via.fictive) {
      continue;
    }
    const fk = groups.get(via.groupId) ?? {
      relationId: via.groupId,
      columns: [],
      referencedTable: via.referencedTable,
      referencedColumns: [],
      onDelete: via.onDelete,
      onUpdate: via.onUpdate,
      name: via.constraintName,
      ...(via.state ? { state: via.state } : {}),
    };
    fk.columns.push(name);
    fk.referencedColumns.push(via.referencedColumn);
    groups.set(via.groupId, fk);
  }
  return [...groups.values()];
}

/**
 * Ajoute à `table` les colonnes et la clé étrangère qui référencent l'entité de `reference`
 * (la patte de l'entité référencée). Les cascades sont lues sur `cascadeFrom`.
 */
export function addReference(
  ctx: Context,
  table: LogicalTable,
  reference: Link,
  cascadeFrom: Link,
  options: { notNull: boolean; inPrimaryKey: boolean; unique?: boolean },
) {
  const target = ctx.entities.get(reference.entityId)!;
  const used = new Set(table.columns.map((c) => c.name));
  const columns = migrate(
    ctx,
    referencedKey(ctx, target, reference),
    reference,
    cascadeFrom,
    tableName(ctx, target),
    target.fictive,
    used,
  );
  const added = columns.filter((k) => !k.via.reused);
  table.columns.push(...added.map((k) => migratedColumn(k, options.notNull && !options.inPrimaryKey)));
  if (options.inPrimaryKey) {
    table.primaryKey.push(...added.map((k) => k.name));
  }
  table.foreignKeys.push(...foreignKeysOf(columns));
  recordMembers(ctx, table, columns);
  // Association 1:1 (patte référencée de cardinalité max 1) : les colonnes de la clé étrangère
  // sont uniques, sinon la cardinalité ne serait pas respectée (O-29).
  if (options.unique && columns.length > 0) {
    const names = columns.map((k) => k.name);
    const single = names.length === 1 ? table.columns.find((c) => c.name === names[0]) : undefined;
    if (single) {
      single.unique = true;
    } else {
      table.uniques.push({ columns: names });
    }
  }
}

/**
 * Clé référencée par une patte : la clé primaire de l'entité, ou l'identifiant alternatif
 * désigné par la patte (`referencedAttributes`, ex. oeuvre(isbn)) (O-35).
 */
function referencedKey(ctx: Context, target: Entity, reference: Link): KeyColumn[] {
  const ids = reference.referencedAttributes;
  const attributes = ids?.map((id) => target.attributes.find((a) => a.id === id));
  if (!(attributes?.length && attributes.every((a) => a !== undefined))) {
    return entityKey(ctx, target.id);
  }
  const table = tableName(ctx, target);
  return attributes.map((a) => ({
    name: columnName(ctx, a!, table, target),
    type: a!.type,
    sourceType: a!.sourceType,
    unsigned: a!.unsigned,
    originId: a!.id,
  }));
}
