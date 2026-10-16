import { foreignKeyDataType } from "../dbms/typeMapping";
import type { Association, Entity, Id, Link, ModelDocument } from "../model/document";
import type { ConstraintState, KeyMember, ReferentialAction, SourceType } from "../model/physical";
import { attributeLogicalName, foreignKeyDefaultName, uniqueName } from "../naming/keys";
import { logicalName } from "../naming/typology";
import { MSG } from "../validation/messages";
import { generatesTable, linksOf } from "../validation/rules";
import type { Issue, LogicalColumn, LogicalForeignKey, LogicalKey, LogicalModel, LogicalTable } from "./logical";

/**
 * Passage MCD → MLD.
 *
 * Implémenté : règles Merise standard dont le résultat ne fait pas débat
 *  - entité → table, identifiant → clé primaire (ordre « Place dans clé ») ;
 *  - association binaire avec une patte de cardinalité max 1 → clé étrangère côté 1,
 *    NOT NULL si (1,1) ;
 *  - association (x,n)–(x,n), n-aire, ou table forcée → table de correspondance ;
 *  - identifiant relatif → clé étrangère intégrée à la clé primaire ;
 *  - entité fictive → pas de table ; son identifiant entre dans les clés sans contrainte FK ;
 *  - nommage des clés (override O-13) : masques de clé primaire et étrangère, suffixes `_2`, `_3`…
 *    en cas de doublon ;
 *  - clés étrangères renommées (override O-07) : le nouveau nom est porté par la patte
 *    de l'entité référencée (`Link.foreignKeyNames`, indexé par la rubrique d'origine) ;
 *  - héritage (override O-18) : chaque sous-type reçoit la clé primaire de son surtype,
 *    à la fois clé primaire et clé étrangère (mêmes noms de colonnes). La contrainte
 *    (X, T, XT) n'a pas d'effet sur la structure des tables.
 *
 * Non implémenté (à valider) : places de clé étrangère,
 * migration des rubriques du surtype, CIF, entités externes.
 */

/** Origine d'une colonne migrée (clé étrangère). */
interface Migration {
  /** Regroupe les colonnes d'une même contrainte FOREIGN KEY ; c'est aussi l'identifiant du trait. */
  groupId: Id;
  /** Patte de l'entité référencée, qui porte les renommages ; absente pour un héritage. */
  reference?: Link;
  onDelete?: ReferentialAction;
  onUpdate?: ReferentialAction;
  constraintName?: string;
  state?: ConstraintState;
  referencedTable: string;
  referencedColumn: string;
  fictive: boolean;
  defaultName: string;
  /** La colonne existe déjà dans la table et est réutilisée (colonne partagée, O-29). */
  reused?: boolean;
}

/** Colonne de la clé primaire d'une entité. */
interface KeyColumn {
  name: string;
  type: LogicalColumn["type"];
  /** Type exact d'origine (annotation, O-29), repris par les clés étrangères. */
  sourceType?: SourceType;
  /** Non signé (O-35) : repris par les clés étrangères, pour un même type des deux côtés. */
  unsigned?: boolean;
  /** Rubrique identifiante d'origine (stable même si les noms changent). */
  originId: Id;
  /** Colonne héritée par identifiant relatif. */
  via?: Migration;
}

interface Context {
  doc: ModelDocument;
  issues: Issue[];
  entities: Map<Id, Entity>;
  keys: Map<Id, KeyColumn[]>;
  /** Sous-type → héritage valide dont il dépend (surtype) et lien d'héritage du sous-type. */
  parents: Map<Id, { inheritanceId: Id; parentId: Id; linkId: Id }>;
  /** Par table : colonne de chaque membre « patte:rubrique d'origine » (identifiants alternatifs, index). */
  members: Map<LogicalTable, Map<string, string>>;
}

const memberKey = (linkId: Id, originId: Id) => `${linkId}:${originId}`;

function recordMembers(ctx: Context, table: LogicalTable, columns: (KeyColumn & { via: Migration })[]) {
  const map = ctx.members.get(table) ?? new Map<string, string>();
  for (const c of columns) if (c.via.reference) map.set(memberKey(c.via.reference.id, c.originId), c.name);
  ctx.members.set(table, map);
}

const byKeyOrder = <T extends { keyOrder?: number }>(items: T[]) =>
  items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => (a.item.keyOrder ?? Infinity) - (b.item.keyOrder ?? Infinity) || a.index - b.index)
    .map(({ item }) => item);

const tableName = (ctx: Context, node: Entity | Association) => logicalName(node, ctx.doc.settings.naming);

const columnName = (
  ctx: Context,
  attribute: Entity["attributes"][number],
  table: string,
  owner: Entity | Association,
) => attributeLogicalName(attribute, table, ctx.doc.settings.naming, ctx.doc.settings.keys.primary, owner.name);

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
    if (link.entityId !== entityId || !link.relativeId) continue;
    if (link.cardinality.min !== 1 || link.cardinality.max !== 1) continue;
    const others = linksOf(ctx.doc, link.associationId).filter((l) => l.id !== link.id);
    if (others.length === 1) result.push({ link, parent: others[0]! });
  }
  return result;
}

/**
 * Clé primaire d'une entité : clés des entités dont elle dépend par identifiant relatif,
 * puis ses rubriques identifiantes. Détecte les références circulaires.
 */
function entityKey(ctx: Context, entityId: Id, visiting = new Set<Id>()): KeyColumn[] {
  const cached = ctx.keys.get(entityId);
  if (cached) return cached;
  const entity = ctx.entities.get(entityId);
  if (!entity) return [];
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

/** Type d'origine d'une clé étrangère : celui de la colonne référencée, sans l'auto-incrément. */
function foreignSourceType(k: KeyColumn): SourceType | undefined {
  if (!k.sourceType) return undefined;
  if (k.type?.kind !== "counter") return k.sourceType;
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

const migratedColumn = (k: KeyColumn & { via: Migration }, notNull: boolean): LogicalColumn => ({
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
function foreignKeysOf(columns: (KeyColumn & { via: Migration })[]): LogicalForeignKey[] {
  const groups = new Map<Id, LogicalForeignKey>();
  for (const { name, via } of columns) {
    if (via.fictive) continue;
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
function addReference(
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
  if (options.inPrimaryKey) table.primaryKey.push(...added.map((k) => k.name));
  table.foreignKeys.push(...foreignKeysOf(columns));
  recordMembers(ctx, table, columns);
  // Association 1:1 (patte référencée de cardinalité max 1) : les colonnes de la clé étrangère
  // sont uniques, sinon la cardinalité ne serait pas respectée (O-29).
  if (options.unique && columns.length > 0) {
    const names = columns.map((k) => k.name);
    const single = names.length === 1 ? table.columns.find((c) => c.name === names[0]) : undefined;
    if (single) single.unique = true;
    else table.uniques.push({ columns: names });
  }
}

/**
 * Clé référencée par une patte : la clé primaire de l'entité, ou l'identifiant alternatif
 * désigné par la patte (`referencedAttributes`, ex. oeuvre(isbn)) (O-35).
 */
function referencedKey(ctx: Context, target: Entity, reference: Link): KeyColumn[] {
  const ids = reference.referencedAttributes;
  const attributes = ids?.map((id) => target.attributes.find((a) => a.id === id));
  if (!attributes?.length || !attributes.every((a) => a !== undefined)) return entityKey(ctx, target.id);
  const table = tableName(ctx, target);
  return attributes.map((a) => ({
    name: columnName(ctx, a!, table, target),
    type: a!.type,
    sourceType: a!.sourceType,
    unsigned: a!.unsigned,
    originId: a!.id,
  }));
}

/** Identifiants alternatifs, index, contraintes et ordre des colonnes d'origine (O-29). */
function applyPhysical(ctx: Context, table: LogicalTable, node: Entity | Association) {
  const members = ctx.members.get(table) ?? new Map<string, string>();
  const tableNameOf = table.name;
  const resolve = (member: KeyMember): string | undefined => {
    if ("attributeId" in member) {
      const attribute = node.attributes.find((a) => a.id === member.attributeId);
      return attribute && columnName(ctx, attribute, tableNameOf, node);
    }
    return members.get(memberKey(member.linkId, member.originId));
  };
  const resolveAll = (list: KeyMember[]) => {
    const names = list.map(resolve);
    return names.every((n): n is string => Boolean(n)) ? names : null;
  };
  for (const key of node.alternateKeys ?? []) {
    const columns = resolveAll(key.members);
    if (!columns) continue;
    const options = {
      ...(key.prefixes ? { prefixes: key.prefixes } : {}),
      ...(key.method ? { method: key.method } : {}),
      ...(key.state ? { state: key.state } : {}),
      ...(key.expression ? { expression: key.expression } : {}),
      ...(key.where ? { where: key.where } : {}),
      ...(key.nulls ? { nulls: key.nulls } : {}),
      ...(key.include && resolveAll(key.include) ? { include: resolveAll(key.include)! } : {}),
    };
    // Unicité sur expression ou conditionnelle : jamais confondue avec un UNIQUE sur les colonnes (O-39).
    const partial = Boolean(key.prefixes || key.expression || key.where);
    const same = (u: LogicalKey) =>
      !partial &&
      !u.prefixes &&
      !u.expression &&
      !u.where &&
      u.columns.length === columns.length &&
      u.columns.every((c) => columns.includes(c));
    const existing = table.uniques.find(same);
    if (existing) Object.assign(existing, { name: existing.name ?? key.name, ...options });
    else table.uniques.push({ name: key.name, columns, ...options });
    // UNIQUE nommé (ou avec méthode, ou état) sur une seule colonne : la contrainte de table remplace la mention en ligne.
    if (columns.length === 1 && (key.name || key.method || key.state) && !partial) {
      const column = table.columns.find((c) => c.name === columns[0]);
      if (column) column.unique = false;
    }
  }
  for (const index of node.indexes ?? []) {
    const columns = resolveAll(index.members);
    if (columns)
      table.indexes.push({
        name: index.name,
        columns,
        ...(index.prefixes ? { prefixes: index.prefixes } : {}),
        ...(index.method ? { method: index.method } : {}),
        ...(index.kind ? { kind: index.kind } : {}),
        ...(index.include && resolveAll(index.include) ? { include: resolveAll(index.include)! } : {}),
      });
  }
  table.checks.push(...(node.checks ?? []));
  if (node.autoIncrementStart !== undefined) table.identityStart = node.autoIncrementStart;
  if (node.autoIncrementStep !== undefined) table.identityStep = node.autoIncrementStep;
  if (node.triggers?.length) table.triggers = node.triggers;
  if (node.primaryKeyState) table.primaryKeyState = node.primaryKeyState;
  if (node.sequences?.length) table.sequences = node.sequences;
  if (node.partition) table.partition = node.partition;
  if (node.storage?.length) table.storage = node.storage;
  if (node.schema) table.schema = node.schema;
  if (ctx.doc.settings.ddl.sourceColumnOrder && node.columnOrder?.length) {
    const order = new Map(node.columnOrder.map((n, i) => [n.toLowerCase(), i]));
    const position = (c: LogicalColumn) => order.get(c.name.toLowerCase()) ?? Infinity;
    table.columns = table.columns
      .map((c, i) => ({ c, i }))
      .sort((a, b) => position(a.c) - position(b.c) || a.i - b.i)
      .map(({ c }) => c);
  }
}

function entityTable(ctx: Context, entity: Entity): LogicalTable {
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

function associationTable(ctx: Context, association: Association, links: Link[]): LogicalTable {
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
  for (const link of links) addReference(ctx, table, link, link, { notNull: true, inPrimaryKey: true });
  table.columns.push(...attributeColumns(ctx, association, name));
  return table;
}

/**
 * Association binaire porteuse d'une DF : choisit la patte « côté 1 » qui reçoit la clé étrangère.
 * Cas 0,1/0,1 et 0,1/1,1 : non documentés ; choix provisoire = la patte (1,1), sinon la première —
 * sauf si la rétroconception a noté le côté d'origine de la clé (O-39).
 */
function dependentSide(links: [Link, Link]): { child: Link; parent: Link } {
  const [a, b] = links;
  const aOne = a.cardinality.max === 1;
  const bOne = b.cardinality.max === 1;
  if (aOne && !bOne) return { child: a, parent: b };
  if (bOne && !aOne) return { child: b, parent: a };
  if (a.foreignKeyHolder && !b.foreignKeyHolder) return { child: a, parent: b };
  if (b.foreignKeyHolder && !a.foreignKeyHolder) return { child: b, parent: a };
  return b.cardinality.min === 1 && a.cardinality.min !== 1 ? { child: b, parent: a } : { child: a, parent: b };
}

function checkAssociationModel(ctx: Context, association: Association, links: Link[]): boolean {
  const target = { kind: "association" as const, id: association.id };
  const error = (message: string) => {
    ctx.issues.push({ severity: "error", message, target });
    return false;
  };
  if (links.length < 2) return error(MSG.associationNeedsTwoLegs);
  const oneOne = links.filter((l) => l.cardinality.min === 1 && l.cardinality.max === 1);
  if (links.length === 2 && oneOne.length === 2) return error(MSG.bothSidesOneOne);
  if (association.attributes.length > 0 && !generatesTable(links)) {
    return error(oneOne.length > 0 ? MSG.oneOneForbiddenWithAttributes : MSG.attributesNeedTable);
  }
  return true;
}

/**
 * Contrôles du MCD indépendants du passage en MLD. Normalement empêchés à la saisie, ces défauts
 * peuvent venir d'un fichier modifié à la main (ou, plus tard, d'une édition simultanée) :
 * le panneau Problèmes doit lister tous les défauts (override O-15).
 */
function checkConceptualModel(ctx: Context) {
  const duplicated = <T extends { name: string }>(items: T[]) => {
    const counts = new Map<string, number>();
    for (const item of items) counts.set(item.name.trim(), (counts.get(item.name.trim()) ?? 0) + 1);
    return items.filter((item) => counts.get(item.name.trim())! > 1);
  };
  for (const e of duplicated(ctx.doc.entities)) {
    ctx.issues.push({
      severity: "error",
      message: MSG.duplicateEntityName(e.name),
      target: { kind: "entity", id: e.id },
    });
  }
  for (const a of duplicated(ctx.doc.associations)) {
    ctx.issues.push({
      severity: "error",
      message: MSG.duplicateAssociationName(a.name),
      target: { kind: "association", id: a.id },
    });
  }
  for (const owner of [...ctx.doc.entities, ...ctx.doc.associations]) {
    if (duplicated(owner.attributes).length > 0) {
      ctx.issues.push({
        severity: "error",
        message: MSG.duplicateAttributesIn(owner.name),
        target: { kind: owner.kind, id: owner.id },
      });
    }
    checkAtomicity(ctx, owner);
  }
  // Référence déclarée en ligne, non appliquée par le SGBD d'origine (O-36).
  for (const link of ctx.doc.links) {
    if (!link.sourceNotEnforced) continue;
    const association = ctx.doc.associations.find((a) => a.id === link.associationId);
    if (association)
      ctx.issues.push({
        severity: "warning",
        message: MSG.referenceNotEnforced(association.name),
        target: { kind: "association", id: association.id },
      });
  }
}

/**
 * Normalisation (O-36) : attribut multivalué (SET) ou non atomique (JSON), contraires à la
 * première forme normale ; identifiant alternatif sur préfixe (unicité partielle).
 */
function checkAtomicity(ctx: Context, owner: Entity | Association) {
  const target = { kind: owner.kind, id: owner.id };
  for (const a of owner.attributes) {
    if (a.domain?.kind === "set")
      ctx.issues.push({ severity: "warning", message: MSG.multivaluedAttribute(owner.name, a.name), target });
    const json =
      (a.type?.kind === "free" && /^jsonb?$/i.test(a.type.sql.trim())) || /^jsonb?\b/i.test(a.sourceType?.sql ?? "");
    if (json) ctx.issues.push({ severity: "warning", message: MSG.nonAtomicAttribute(owner.name, a.name), target });
  }
  // Annotations physiques que le MCD n'exprime pas (O-39).
  const disabled = (name: string | undefined, state: ConstraintState | undefined, fallback: string) => {
    if (state?.disabled)
      ctx.issues.push({
        severity: "warning",
        message: MSG.constraintDisabled(owner.name, name ?? fallback, state.dialect),
        target,
      });
    if (state?.notValidated)
      ctx.issues.push({
        severity: "warning",
        message: MSG.constraintNotValidated(owner.name, name ?? fallback, state.dialect),
        target,
      });
  };
  for (const a of owner.attributes) if (a.check) disabled(a.check.name, a.check.state, `CHECK (${a.check.expression})`);
  for (const check of owner.checks ?? []) disabled(check.name, check.state, `CHECK (${check.expression})`);
  for (const key of owner.alternateKeys ?? []) disabled(key.name, key.state, "UNIQUE");
  for (const link of ctx.doc.links) {
    if (link.entityId === owner.id && link.foreignKeyHolder)
      disabled(link.foreignKeyConstraintName, link.foreignKeyState, "FOREIGN KEY");
  }
  for (const key of owner.alternateKeys ?? []) {
    if (!key.where) continue;
    const names = key.members.map(
      (m) =>
        ("attributeId" in m ? owner.attributes.find((a) => a.id === m.attributeId)?.name : keyMemberLabel(ctx, m)) ??
        "?",
    );
    ctx.issues.push({
      severity: "warning",
      message: MSG.conditionalUnique(owner.name, names.join(", "), key.where.expression),
      target,
    });
  }
  if (owner.partition) ctx.issues.push({ severity: "warning", message: MSG.partitionDropped(owner.name), target });
  // O-41 : UNIQUE à un seul NULL admis (SQL Server) sur une colonne facultative ; types spatiaux ; ROWVERSION.
  for (const key of owner.alternateKeys ?? []) {
    if (key.nulls !== "not distinct") continue;
    const optional = key.members.filter((m) => {
      if ("attributeId" in m) {
        const a = owner.attributes.find((x) => x.id === m.attributeId);
        return a && !a.notNull && !a.identifier;
      }
      const link = ctx.doc.links.find((l) => l.id === m.linkId);
      const holder = link && ctx.doc.links.find((l) => l.associationId === link.associationId && l.id !== link.id);
      return holder?.cardinality.min === 0;
    });
    if (optional.length) {
      const names = optional.map((m) =>
        "attributeId" in m
          ? owner.attributes.find((a) => a.id === m.attributeId)!.name
          : (keyMemberLabel(ctx, m) ?? "#"),
      );
      ctx.issues.push({ severity: "warning", message: MSG.singleNullUnique(owner.name, names.join(", ")), target });
    }
  }
  const dbms = ctx.doc.settings.dbms;
  for (const a of owner.attributes) {
    if (
      (a.type?.kind === "geography" || a.type?.kind === "geometry") &&
      (dbms === "postgresql" || dbms === "sqlite" || dbms === "db2")
    ) {
      ctx.issues.push({
        severity: "warning",
        message: MSG.spatialExtension(owner.name, a.name, a.type.kind.toUpperCase(), dbms),
        target,
      });
    }
    if (a.type?.kind === "free" && a.type.sql === "ROWVERSION" && dbms !== "sqlserver") {
      ctx.issues.push({ severity: "warning", message: MSG.rowversionAttribute(owner.name, a.name), target });
    }
  }
  for (const key of owner.alternateKeys ?? []) {
    if (!key.prefixes?.some((p) => p !== null)) continue;
    const names = key.members.map((m, i) => {
      const attribute = "attributeId" in m ? owner.attributes.find((a) => a.id === m.attributeId)?.name : "#";
      return key.prefixes?.[i] ? `${attribute}(${key.prefixes[i]})` : attribute;
    });
    ctx.issues.push({ severity: "warning", message: MSG.prefixAlternateKey(owner.name, names.join(", ")), target });
  }
}

/** Membre d'une clé venu d'une patte : nom de l'association (ex. « sejour_Patient »). */
function keyMemberLabel(ctx: Context, member: KeyMember): string | undefined {
  if ("attributeId" in member) return undefined;
  const link = ctx.doc.links.find((l) => l.id === member.linkId);
  const association = link && ctx.doc.associations.find((a) => a.id === link.associationId);
  // Nom de la colonne de clé étrangère dans la table (vol_retour), pas celui de la clé référencée (O-41).
  const origin = ctx.entities.get(link?.entityId ?? "")?.attributes.find((a) => a.id === member.originId);
  const column = link?.foreignKeyNames?.[member.originId]?.trim() || origin?.name || "#";
  return association ? `${column} (${association.name})` : undefined;
}

/**
 * Héritages : une entité cible (surtype) et au moins une entité spécialisée (overrides O-18, O-36).
 * Renvoie, pour chaque sous-type, l'héritage valide dont il dépend.
 */
function checkInheritances(ctx: Context) {
  for (const inheritance of ctx.doc.inheritances) {
    const target = { kind: "inheritance" as const, id: inheritance.id };
    const links = ctx.doc.inheritanceLinks.filter(
      (l) => l.inheritanceId === inheritance.id && ctx.entities.has(l.entityId),
    );
    const entityIds = links.map((l) => l.entityId);
    const parentId =
      inheritance.parentId && entityIds.includes(inheritance.parentId) ? inheritance.parentId : undefined;
    const children = entityIds.filter((id) => id !== parentId);
    if (!parentId) ctx.issues.push({ severity: "error", message: MSG.inheritanceNeedsParent, target });
    if (children.length < 1) ctx.issues.push({ severity: "error", message: MSG.inheritanceNeedsChild, target });
    if (!parentId) continue;
    for (const child of children) {
      if (ctx.parents.has(child)) {
        const entity = ctx.entities.get(child)!;
        ctx.issues.push({
          severity: "error",
          message: MSG.multipleParents(entity.name),
          target: { kind: "entity", id: child },
        });
        continue;
      }
      ctx.parents.set(child, {
        inheritanceId: inheritance.id,
        parentId,
        linkId: links.find((l) => l.entityId === child)!.id,
      });
    }
  }
}

function checkTables(ctx: Context, tables: LogicalTable[]) {
  const ownerName = (table: LogicalTable) =>
    (table.source.kind === "entity"
      ? ctx.entities.get(table.source.id)
      : ctx.doc.associations.find((a) => a.id === table.source.id)
    )?.name ?? table.name;
  const counts = new Map<string, number>();
  for (const table of tables) counts.set(table.name, (counts.get(table.name) ?? 0) + 1);
  for (const table of tables) {
    if (counts.get(table.name)! > 1) {
      ctx.issues.push({
        severity: "error",
        message: MSG.duplicateTableConceptual(table.name),
        logicalMessage: MSG.duplicateTableLogical(table.name),
        target: table.source,
      });
    }
    const seen = new Set<string>();
    for (const column of table.columns) {
      if (seen.has(column.name)) {
        ctx.issues.push({
          severity: "error",
          message: MSG.duplicateColumnConceptual(ownerName(table), column.name),
          logicalMessage: MSG.duplicateColumnLogical(table.name, column.name),
          target: table.source,
        });
      }
      seen.add(column.name);
    }
  }
}

export function toLogicalModel(doc: ModelDocument): LogicalModel {
  const ctx: Context = {
    doc,
    issues: [],
    entities: new Map(doc.entities.map((e) => [e.id, e])),
    keys: new Map(),
    parents: new Map(),
    members: new Map(),
  };
  checkConceptualModel(ctx);
  checkInheritances(ctx);

  const tables = new Map<Id, LogicalTable>();
  for (const entity of doc.entities) {
    if (!entity.fictive) tables.set(entity.id, entityTable(ctx, entity));
  }

  for (const association of doc.associations) {
    const links = linksOf(doc, association.id).filter((l) => ctx.entities.has(l.entityId));
    if (!checkAssociationModel(ctx, association, links)) continue;

    if (generatesTable(links) || links.length > 2) {
      if (!generatesTable(links)) {
        ctx.issues.push({
          severity: "warning",
          message: MSG.naryWithFunctionalLeg,
          target: { kind: "association", id: association.id },
        });
      }
      tables.set(association.id, associationTable(ctx, association, links));
      continue;
    }

    const { child, parent } = dependentSide(links as [Link, Link]);
    const childTable = tables.get(child.entityId);
    if (!childTable || child.relativeId) continue; // entité fictive, ou FK déjà dans la clé
    addReference(ctx, childTable, parent, child, {
      notNull: child.cardinality.min >= 1,
      inPrimaryKey: false,
      // 1:1 : la patte référencée est de cardinalité max 1.
      unique: parent.cardinality.max === 1,
    });
  }

  const result = [...tables.values()];
  for (const table of result) {
    const node =
      table.source.kind === "entity"
        ? ctx.entities.get(table.source.id)
        : doc.associations.find((a) => a.id === table.source.id);
    if (node) applyPhysical(ctx, table, node);
  }
  checkTables(ctx, result);
  return { tables: result, issues: ctx.issues };
}
