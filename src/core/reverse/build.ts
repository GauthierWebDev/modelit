import { referencedColumns } from "../ddl/expressions";
import type { Association, Attribute, Entity, Id, InheritanceLink, Link, ModelDocument } from "../model/document";
import {
  createAssociation,
  createAttribute,
  createEntity,
  createInheritance,
  createInheritanceLink,
  createLink,
} from "../model/factory";
import type { CheckConstraint, KeyMember, SqlDialect, ValueDomain } from "../model/physical";
import { foreignKeyDefaultName } from "../naming/keys";
import { logicalName } from "../naming/typology";
import { MSG } from "../validation/messages";
import { inferComputedType } from "./computedType";
import { detectDialect } from "./dialect";
import {
  type NamedExpression,
  type ParsedColumn,
  type ParsedForeignKey,
  type ParsedKey,
  type ParsedTable,
  parseSql,
} from "./parse";
import { tokenize } from "./tokenize";
import { sqlTypeToDataType } from "./types";

/**
 * Rétroconception : script SQL → MCD (overrides O-28 et O-29).
 *
 * Règles de reconstruction :
 *  - table dont la clé primaire est faite uniquement de clés étrangères (au moins deux), sans
 *    autre clé étrangère → association entre les entités référencées (0,n), ses autres
 *    colonnes devenant des rubriques de l'association ;
 *  - au moins deux tables dont la clé primaire est exactement la clé (mêmes noms) d'une même
 *    table → héritage, la table référencée étant l'entité générique ;
 *  - clé étrangère incluse dans la clé primaire → identifiant relatif : (1,1)(R) côté table,
 *    0,n côté référencé (0,1 si la clé primaire se réduit à cette clé étrangère) ;
 *  - autre clé étrangère → association 1,1 (colonnes NOT NULL) ou 0,1, face à 0,n — ou 0,1
 *    si l'ensemble exact de ses colonnes est couvert par un UNIQUE ou par la clé primaire ;
 *  - toute autre table → entité, ses colonnes hors clés étrangères devenant des rubriques.
 *
 * Tout ce que le MCD ne sait pas exprimer est conservé en annotations physiques (O-29) :
 * types et défauts d'origine (avec leur dialecte), CHECK, UNIQUE (identifiants alternatifs),
 * index, noms de contraintes, actions référentielles, noms entre guillemets, ordre des colonnes,
 * colonnes partagées entre clés.
 */

export interface ReverseReport {
  tables: number;
  entities: number;
  associations: number;
  inheritances: number;
  /** Instructions sans rapport avec les tables (vues, fonctions, déclencheurs…), ignorées. */
  ignored: number;
  /** Dialecte du script (indiqué ou détecté). */
  dialect: SqlDialect;
  warnings: string[];
}

export interface ReverseResult {
  doc: ModelDocument;
  report: ReverseReport;
}

type ResolvedFk = ParsedForeignKey & { target: ParsedTable; referencedColumns: string[] };

const key = (name: string) => name.toLowerCase();
const sameColumns = (a: string[], b: string[]) =>
  a.length === b.length && a.every((x) => b.some((y) => key(y) === key(x)));
const within = (columns: string[], set: string[]) => columns.every((c) => set.some((s) => key(s) === key(c)));

/**
 * @param base    document de départ (paramètres : SGBD cible, schémas de nommage…) ; complété, non modifié.
 * @param dialect dialecte du script ; détecté s'il n'est pas indiqué.
 */
export function reverseEngineer(
  sql: string,
  base: ModelDocument,
  dialect: SqlDialect = detectDialect(sql),
): ReverseResult {
  const schema = parseSql(sql, dialect);
  // État des contraintes : vocabulaire du dialecte d'origine dans le rapport (O-42).
  for (const t of schema.tables) {
    for (const x of [
      ...t.checks,
      ...t.columns.flatMap((c) => (c.check ? [c.check] : [])),
      ...t.foreignKeys,
      ...t.uniques,
    ])
      if (x.state) x.state.dialect = dialect;
    if (t.primaryKeyState) t.primaryKeyState.dialect = dialect;
  }
  const warnings = [
    ...schema.skipped.map((text) => MSG.reverseUnreadable(text)),
    ...schema.warnings.map((where) => MSG.reverseOrphanComment(where)),
  ];
  const doc: ModelDocument = structuredClone(base);
  const naming = doc.settings.naming;
  const tables = new Map(schema.tables.map((t) => [key(t.name), t]));

  // 1. Clés étrangères résolues (table et colonnes référencées existantes).
  const fks = new Map<ParsedTable, ResolvedFk[]>();
  for (const table of schema.tables) {
    const resolved: ResolvedFk[] = [];
    for (const fk of table.foreignKeys) {
      const target = tables.get(key(fk.table));
      if (!target) {
        warnings.push(MSG.reverseUnknownTable(table.name, fk.table));
        continue;
      }
      const targetColumns = fk.referencedColumns.length ? fk.referencedColumns : target.primaryKey;
      if (targetColumns.length !== fk.columns.length) {
        warnings.push(MSG.reverseColumnMismatch(table.name, fk.table));
        continue;
      }
      resolved.push({ ...fk, referencedColumns: targetColumns, target });
    }
    fks.set(table, resolved);
  }

  // 2. Tables d'association (clé primaire = union de clés étrangères).
  const isJoinTable = (table: ParsedTable) => {
    const list = fks.get(table)!;
    if (table.primaryKey.length === 0 || list.length < 2) return false;
    if (!list.every((fk) => within(fk.columns, table.primaryKey))) return false;
    return within(
      table.primaryKey,
      list.flatMap((fk) => fk.columns),
    );
  };
  const joinTables = new Set(schema.tables.filter(isJoinTable));

  // 3. Héritages : tables dont la clé primaire est exactement une clé étrangère vers la clé
  //    primaire d'une seule autre table (aucune colonne propre dans la clé) : entité spécialisée,
  //    même seule (O-36). Les noms de colonnes peuvent différer (adherent_premium.adherent_id → adherent.id).
  const childrenOf = new Map<ParsedTable, ParsedTable[]>();
  const inheritanceFk = new Map<ParsedTable, ResolvedFk>();
  for (const table of schema.tables) {
    if (joinTables.has(table)) continue;
    const candidate = fks
      .get(table)!
      .find(
        (fk) =>
          fk.target !== table &&
          !joinTables.has(fk.target) &&
          sameColumns(fk.columns, table.primaryKey) &&
          sameColumns(fk.referencedColumns, fk.target.primaryKey),
      );
    if (!candidate) continue;
    childrenOf.set(candidate.target, [...(childrenOf.get(candidate.target) ?? []), table]);
    inheritanceFk.set(table, candidate);
  }

  // 4. Entités et rubriques.
  const entities = new Map<ParsedTable, Entity>();
  const attributeOf = new Map<ParsedTable, Map<string, Attribute>>();
  const toAttribute = (column: ParsedColumn, table: ParsedTable): Attribute => {
    const keyIndex = table.primaryKey.findIndex((c) => key(c) === key(column.name));
    const domain = valueDomain(column.type, schema.enumTypes);
    let type = sqlTypeToDataType(column.type, column.autoIncrement, dialect);
    // Colonne calculée sans type déclaré (SQL Server) : type déduit de l'expression, si possible (O-41).
    if (!type && column.generated) {
      const columnType = (name: string) => {
        const other = table.columns.find((c) => c.name.toLowerCase() === name.toLowerCase());
        return other && other !== column ? sqlTypeToDataType(other.type, false, dialect) : undefined;
      };
      type = inferComputedType(column.generated.expression, columnType, dialect);
    }
    // NUMBER sans précision alimenté par une séquence : entier 64 bits (O-39).
    if (column.sequence && type?.kind === "decimal" && type.precision === undefined)
      type = { kind: "integer", bits: 64 };
    // RAW(16) DEFAULT SYS_GUID() (Oracle) : identifiant universel → UUID (approximation signalée) (O-39).
    if (
      dialect === "oracle" &&
      /^raw\s*\(\s*16\s*\)$/i.test(column.type.trim()) &&
      /^sys_guid\s*\(\s*\)$/i.test(column.default?.trim() ?? "")
    )
      type = { kind: "free", sql: "UUID" };
    // ENUM / SET : texte, dont les valeurs permises forment le domaine de la rubrique (O-35).
    if (domain?.kind === "enum")
      type = {
        kind: "text",
        encoding: "unicode",
        length: "variable",
        size: Math.max(1, ...domain.values.map((v) => v.length)),
      };
    if (domain?.kind === "set") type = { kind: "text", encoding: "unicode", length: "large" };
    // Collation effective : celle de la colonne, sinon de la table, sinon de la base (O-37).
    const collation = column.collation ?? table.collation ?? schema.defaultCollation;
    if (type?.kind === "text" && type.encoding !== "binary" && collation) type.collation = collation;
    // UNIQUE sur la seule colonne, sans préfixe : propriété de la rubrique (le nom ou la méthode
    // éventuels sont gardés par un identifiant alternatif). Un UNIQUE sur préfixe n'en est pas un.
    const singleUnique = table.uniques.some(
      (u) => u.columns.length === 1 && key(u.columns[0]!) === key(column.name) && plainKey(u),
    );
    const attribute = createAttribute(column.name, {
      type,
      identifier: keyIndex >= 0,
      keyOrder: keyIndex >= 0 && table.primaryKey.length > 1 ? keyIndex + 1 : undefined,
      notNull: column.notNull && keyIndex < 0,
      // UNIQUE sur la seule colonne : propriété de la rubrique (le nom éventuel est gardé par un identifiant alternatif).
      unique: column.unique || singleUnique,
      comment: column.comment,
      caseSensitive: column.quoted || undefined,
      sourceType: column.type ? { sql: column.type, dialect } : undefined,
      defaultValue:
        column.default !== undefined && !/^null$/i.test(column.default)
          ? { expression: column.default, dialect }
          : undefined,
    });
    // UNSIGNED (MySQL), TINYINT (SQL Server : 0 à 255) (O-41).
    if (/\bunsigned\b/i.test(column.type) || (dialect === "sqlserver" && /^\s*tinyint\b/i.test(column.type)))
      attribute.unsigned = true;
    if (domain) attribute.domain = domain;
    if (column.generated) attribute.generated = { ...column.generated, dialect };
    if (column.onUpdate) attribute.onUpdate = { expression: column.onUpdate, dialect };
    if (column.sequence) attribute.sequence = column.sequence;
    if (column.identity) attribute.identity = column.identity;
    if (column.sqlServerOptions?.length) attribute.sqlServerOptions = column.sqlServerOptions;
    if (logicalName(attribute, naming) !== column.name) attribute.logicalName = column.name;
    return attribute;
  };

  const entityTables = schema.tables.filter((t) => !joinTables.has(t));
  entityTables.forEach((table, index) => {
    const entity = createEntity(table.name);
    doc.layout.positions[entity.id] = { x: (index % 5) * 280, y: Math.floor(index / 5) * 220 };
    if (logicalName(entity, naming) !== table.name) entity.logicalName = table.name;
    entity.comment = table.comment;
    const fkColumns = new Set(fks.get(table)!.flatMap((fk) => fk.columns.map(key)));
    const attributes = new Map<string, Attribute>();
    for (const column of table.columns) {
      if (fkColumns.has(key(column.name))) continue;
      const attribute = toAttribute(column, table);
      attributes.set(key(column.name), attribute);
      entity.attributes.push(attribute);
    }
    entities.set(table, entity);
    attributeOf.set(table, attributes);
    doc.entities.push(entity);
  });

  /** Rubrique d'origine d'une colonne de clé (en remontant les clés étrangères). */
  const originOf = (table: ParsedTable, column: string, seen = new Set<ParsedTable>()): Attribute | undefined => {
    const own = attributeOf.get(table)?.get(key(column));
    if (own || seen.has(table)) return own;
    seen.add(table);
    for (const fk of fks.get(table)!) {
      const index = fk.columns.findIndex((c) => key(c) === key(column));
      if (index >= 0) return originOf(fk.target, fk.referencedColumns[index]!, seen);
    }
    return undefined;
  };

  /** Renommages pour que les clés étrangères régénérées gardent les noms du script. */
  const foreignKeyNames = (fk: ResolvedFk) => {
    const names: Record<Id, string> = {};
    fk.columns.forEach((column, i) => {
      const referenced = fk.referencedColumns[i]!;
      const origin = originOf(fk.target, referenced);
      const defaultName = foreignKeyDefaultName(
        doc.settings.keys.foreign,
        fk.target.name,
        referenced,
        fk.columns.length === 1,
      );
      if (origin && column !== defaultName) names[origin.id] = column;
    });
    return Object.keys(names).length ? names : undefined;
  };

  /** Commentaires des colonnes de la clé étrangère (rubriques référencées → texte). */
  const foreignKeyComments = (table: ParsedTable, fk: ResolvedFk) => {
    const comments: Record<Id, string> = {};
    fk.columns.forEach((column, i) => {
      const comment = table.columns.find((c) => key(c.name) === key(column))?.comment;
      const origin = originOf(fk.target, fk.referencedColumns[i]!);
      if (comment && origin) comments[origin.id] = comment;
    });
    return Object.keys(comments).length ? comments : undefined;
  };

  /**
   * Colonnes de `fk` déjà fournies par la clé primaire (hors identifiant relatif) ou par une
   * autre clé étrangère traitée avant : elles seront réutilisées, pas dupliquées (O-29).
   */
  const sharedColumns = (table: ParsedTable, fk: ResolvedFk, before: ResolvedFk[]) => {
    const relativeColumns = fks
      .get(table)!
      .filter((other) => other !== fk && within(other.columns, table.primaryKey))
      .flatMap((o) => o.columns);
    const provided = new Set([...table.primaryKey, ...relativeColumns, ...before.flatMap((o) => o.columns)].map(key));
    const shared = fk.columns.filter((c) => provided.has(key(c)));
    if (!shared.length || within(fk.columns, table.primaryKey)) return undefined;
    warnings.push(MSG.reverseSharedColumns(table.name, shared.join(", ")));
    return shared
      .map((c) => originOf(fk.target, fk.referencedColumns[fk.columns.findIndex((x) => key(x) === key(c))]!)?.id)
      .filter((id): id is Id => Boolean(id));
  };

  const usedNames = new Set<string>();
  const associationName = (wanted: string) => {
    let name = wanted;
    for (let i = 2; usedNames.has(key(name)); i++) name = `${wanted}_${i}`;
    usedNames.add(key(name));
    return name;
  };
  /**
   * Nom d'une association issue d'une clé étrangère (O-36, O-37), par ordre de priorité :
   *  a) nom de la contrainte sans préfixe ni nom de table (fk_premium_favori → favori) ;
   *  b) nom de la colonne sans suffixe _id / _fk (parrain_id → parrain) ;
   *  c) table_table, avec un suffixe distinctif si la paire est déjà reliée.
   * Un nom dérivé (a, b) est écarté s'il est déjà pris, ou s'il se réduit au nom d'une table
   * reliée ou à une abréviation de ce nom (« ex » pour Exemplaire, « labo » pour Laboratoire).
   */
  const entityNames = new Set(schema.tables.map((t) => key(t.name)));
  const taken = (name: string) => !name || usedNames.has(key(name)) || entityNames.has(key(name));
  const dependencyName = (table: ParsedTable, fk: ResolvedFk) => {
    const linked = [key(table.name), key(fk.target.name)];
    const acceptable = (name: string | undefined): name is string =>
      Boolean(name) && !taken(name!) && !linked.some((t) => t.startsWith(key(name!)));
    const tableTokens = key(table.name).split("_");
    const fromConstraint = fk.name
      ?.replace(/^(fk|fkey)_+/i, "")
      .replace(/_+(fk|fkey)$/i, "")
      .replace(/^([a-z0-9]+)_+/i, (match, token: string) => {
        const t = key(token);
        // Nom de la table, l'une de ses parties, ou son abréviation (ex. « ex » pour Exemplaire).
        return t === key(table.name) || tableTokens.includes(t) || (t.length >= 2 && key(table.name).startsWith(t))
          ? ""
          : match;
      });
    if (acceptable(fromConstraint)) return associationName(fromConstraint);
    // Règle b) : pas quand la colonne porte le nom de la colonne référencée (matricule, code_service) (O-39).
    if (fk.columns.length === 1 && key(fk.columns[0]!) !== key(fk.referencedColumns[0]!)) {
      const fromColumn = fk.columns[0]!.replace(/_+(id|fk)$/i, "").replace(/^(id|fk)_+/i, "");
      if (acceptable(fromColumn)) return associationName(fromColumn);
    }
    return associationName(`${table.name}_${fk.target.name}`);
  };

  /**
   * Rôle de l'occurrence RÉFÉRENCÉE d'une association réflexive (O-36, corrigé par O-37) : tiré
   * de la colonne de la clé étrangère, sans _id / id_ ni le nom de la colonne référencée
   * (parrain_id → parrain, isbn_originale → originale). Il est porté par la patte 0,n ; la patte
   * 0,1 (côté référençant) reste sans rôle.
   */
  const reflexiveRole = (table: ParsedTable, fk: ResolvedFk) => {
    const index = Math.max(
      0,
      fk.columns.findIndex((c) => !table.primaryKey.some((p) => key(p) === key(c))),
    );
    const column = fk.columns[index]!;
    const referenced = key(fk.referencedColumns[index]!);
    let role = key(column)
      .replace(/_+(id|fk)$/, "")
      .replace(/^(id|fk)_+/, "");
    // Sans le nom de la colonne référencée (isbn_originale → originale) ni celui de la table
    // (service_parent → parent) (O-39).
    for (const part of [referenced, key(table.name)]) {
      if (role.startsWith(`${part}_`)) role = role.slice(part.length + 1);
      else if (role.endsWith(`_${part}`)) role = role.slice(0, -part.length - 1);
    }
    return role || column;
  };

  /** Patte de l'entité référencée de chaque clé étrangère (membres des UNIQUE et index). */
  const referenceLink = new Map<ResolvedFk, Link>();
  const applyForeignKey = (link: Link, fk: ResolvedFk) => {
    link.onDelete = fk.onDelete;
    link.onUpdate = fk.onUpdate;
    link.foreignKeyConstraintName = fk.name;
    if (fk.state) link.foreignKeyState = fk.state;
  };

  // 5. Associations issues des tables d'association.
  const joinAssociations = new Map<ParsedTable, Association>();
  for (const table of joinTables) {
    const association = createAssociation(associationName(table.name));
    if (logicalName(association, naming) !== table.name) association.logicalName = table.name;
    association.comment = table.comment;
    const fkColumns = new Set(fks.get(table)!.flatMap((fk) => fk.columns.map(key)));
    association.attributes = table.columns.filter((c) => !fkColumns.has(key(c.name))).map((c) => toAttribute(c, table));
    attributeOf.set(table, new Map(association.attributes.map((a) => [key(a.name), a])));
    const links: Link[] = [];
    for (const fk of orderByKey(fks.get(table)!, table.primaryKey)) {
      const target = entities.get(fk.target);
      if (!target) {
        warnings.push(MSG.reverseReferencesAssociation(table.name, fk.target.name));
        continue;
      }
      const link = createLink(association.id, target.id);
      applyForeignKey(link, fk);
      link.foreignKeyNames = foreignKeyNames(fk);
      link.foreignKeyComments = foreignKeyComments(table, fk);
      referenceLink.set(fk, link);
      links.push(link);
    }
    doc.associations.push(association);
    doc.links.push(...links);
    joinAssociations.set(table, association);
  }

  // 6. Associations issues des clés étrangères des entités, et héritages.
  for (const table of entityTables) {
    const entity = entities.get(table)!;
    const before: ResolvedFk[] = [];
    for (const fk of fks.get(table)!) {
      if (inheritanceFk.get(table) === fk) continue;
      const parent = entities.get(fk.target);
      if (!parent) {
        warnings.push(MSG.reverseReferencesAssociation(table.name, fk.target.name));
        continue;
      }
      const relative = table.primaryKey.length > 0 && within(fk.columns, table.primaryKey);
      const columns = fk.columns.map((c) => table.columns.find((col) => key(col.name) === key(c)));
      const notNull = relative || columns.every((c) => c?.notNull);
      // Cardinalité max 1 côté référencé : colonnes exactement couvertes par un UNIQUE (sans
      // condition ni expression) ou la PK.
      const unique =
        (fk.columns.length === 1 && columns[0]?.unique) ||
        table.uniques.some(
          (u) => sameColumns(u.columns, fk.columns) && !u.where && !u.expression && !u.state?.disabled,
        ) ||
        sameColumns(fk.columns, table.primaryKey);
      const association = createAssociation(dependencyName(table, fk));
      const parentLink = createLink(association.id, parent.id);
      parentLink.cardinality = { min: 0, max: unique ? 1 : "n" };
      parentLink.foreignKeyNames = foreignKeyNames(fk);
      parentLink.foreignKeyComments = foreignKeyComments(table, fk);
      parentLink.sharedColumns = relative ? undefined : sharedColumns(table, fk, before);
      // Clé étrangère vers un identifiant alternatif (ex. oeuvre(isbn)) : rubriques référencées (O-35).
      if (!sameColumns(fk.referencedColumns, fk.target.primaryKey)) {
        const targets = fk.referencedColumns.map((c) => attributeOf.get(fk.target)?.get(key(c)));
        if (targets.every((a): a is Attribute => Boolean(a)))
          parentLink.referencedAttributes = targets.map((a) => a.id);
      }
      const childLink = createLink(association.id, entity.id);
      childLink.cardinality = { min: notNull ? 1 : 0, max: 1 };
      childLink.relativeId = relative;
      childLink.foreignKeyHolder = true;
      applyForeignKey(childLink, fk);
      if (fk.target === table) parentLink.role = reflexiveRole(table, fk);
      // MySQL analyse mais n'applique pas un REFERENCES écrit dans la définition de colonne.
      if (fk.inline && (dialect === "mysql" || dialect === "mariadb")) childLink.sourceNotEnforced = true;
      referenceLink.set(fk, parentLink);
      doc.associations.push(association);
      doc.links.push(parentLink, childLink);
      before.push(fk);
    }
  }
  const inheritanceLinkOf = new Map<ParsedTable, InheritanceLink>();
  for (const [parent, children] of childrenOf) {
    const inheritance = createInheritance();
    inheritance.parentId = entities.get(parent)!.id;
    doc.inheritances.push(inheritance);
    doc.inheritanceLinks.push(createInheritanceLink(inheritance.id, entities.get(parent)!.id));
    for (const child of children) {
      const link = createInheritanceLink(inheritance.id, entities.get(child)!.id);
      const fk = inheritanceFk.get(child)!;
      link.onDelete = fk.onDelete;
      link.onUpdate = fk.onUpdate;
      link.foreignKeyConstraintName = fk.name;
      if (fk.state) link.foreignKeyState = fk.state;
      // Clé héritée : même nom que celle de l'entité générique, sauf renommage (adherent_id → id).
      const names: Record<Id, string> = {};
      fk.columns.forEach((column, i) => {
        const origin = originOf(fk.target, fk.referencedColumns[i]!);
        if (origin && key(column) !== key(fk.referencedColumns[i]!)) names[origin.id] = column;
      });
      if (Object.keys(names).length) link.foreignKeyNames = names;
      doc.inheritanceLinks.push(link);
      inheritanceLinkOf.set(child, link);
    }
  }

  // 7. Annotations de table : nom quoté, nom de clé primaire, UNIQUE, CHECK, index, ordre des colonnes.
  for (const table of schema.tables) {
    const node: Entity | Association | undefined = entities.get(table) ?? joinAssociations.get(table);
    if (!node) continue;
    node.caseSensitive = table.quoted || undefined;
    node.primaryKeyName = table.primaryKeyName;
    node.columnOrder = table.columns.map((c) => c.name);
    const start = table.autoIncrementStart ?? table.columns.find((c) => c.identityStart !== undefined)?.identityStart;
    if (start !== undefined) node.autoIncrementStart = start;
    const step = table.columns.find((c) => c.identityIncrement !== undefined)?.identityIncrement;
    if (step !== undefined) node.autoIncrementStep = step;
    if (table.triggers.length) node.triggers = table.triggers.map((t) => ({ ...t, dialect }));
    if (table.primaryKeyState) node.primaryKeyState = table.primaryKeyState;
    if (table.storage.length) node.storage = table.storage;
    if (table.partition) node.partition = { sql: table.partition, dialect };
    if (table.schema) node.schema = table.schema;
    // Séquences utilisées par les colonnes de la table (O-39).
    const sequences = table.columns
      .map((c) => c.sequence && schema.sequences.get(key(c.sequence.name)))
      .filter((s): s is NonNullable<typeof s> => Boolean(s))
      .map(({ ownedBy: _owned, ...definition }) => definition);
    if (sequences.length) node.sequences = sequences;
    const memberOf = (column: string): KeyMember | undefined => {
      const attribute = attributeOf.get(table)?.get(key(column));
      if (attribute) return { attributeId: attribute.id };
      for (const fk of fks.get(table)!) {
        const index = fk.columns.findIndex((c) => key(c) === key(column));
        const link = referenceLink.get(fk);
        const origin = index >= 0 ? originOf(fk.target, fk.referencedColumns[index]!) : undefined;
        if (link && origin) return { linkId: link.id, originId: origin.id };
      }
      return undefined;
    };
    const members = (columns: string[]) => {
      const list = columns.map(memberOf);
      return list.every((m): m is KeyMember => Boolean(m)) ? list : null;
    };
    // UNIQUE : composés, nommés ou portant sur des clés étrangères → identifiants alternatifs.
    const uniques: ParsedKey[] = [
      ...table.uniques,
      // UNIQUE en ligne nommé, ou sur une colonne facultative SQL Server (un seul NULL admis, O-41).
      ...table.columns
        .filter((c) => c.unique && (c.uniqueName || (dialect === "sqlserver" && !c.notNull)))
        .map((c) => ({ name: c.uniqueName, columns: [c.name] })),
    ];
    for (const unique of uniques) {
      // Clé composée Oracle avec une colonne facultative : les NULL y sont égaux entre eux (O-39).
      const nullable = unique.columns.some(
        (c) =>
          !table.columns.find((col) => key(col.name) === key(c))?.notNull &&
          !table.primaryKey.some((p) => key(p) === key(c)),
      );
      // SQL Server : un seul NULL admis par UNIQUE, sauf index filtré « IS NOT NULL » (NULL distincts) (O-41).
      const nulls = unique.nullsDistinct
        ? "distinct"
        : unique.nullsNotDistinct || (dialect === "sqlserver" && nullable && !unique.where && !unique.expression)
          ? "not distinct"
          : dialect === "oracle" && unique.columns.length > 1 && nullable && !unique.expression
            ? "oracle"
            : undefined;
      const single = unique.columns.length === 1 ? attributeOf.get(table)?.get(key(unique.columns[0]!)) : undefined;
      const plain = plainKey(unique) && !unique.method && !nulls;
      if (single && !unique.name && plain) continue; // déjà porté par la rubrique
      const list = members(unique.columns);
      // UNIQUE anonyme couvrant exactement une clé étrangère : exprimé par la cardinalité 0,1.
      if (
        !unique.name &&
        plainKey(unique) &&
        !nulls &&
        fks.get(table)!.some((fk) => sameColumns(fk.columns, unique.columns))
      )
        continue;
      if (!list) continue;
      node.alternateKeys = [
        ...(node.alternateKeys ?? []),
        {
          name: unique.name,
          members: list,
          ...keyOptions(unique),
          ...(unique.state ? { state: unique.state } : {}),
          ...(unique.expression ? { expression: { expression: unique.expression, dialect } } : {}),
          ...(unique.where ? { where: { expression: unique.where, dialect } } : {}),
          ...(nulls ? { nulls } : {}),
          ...(unique.include && members(unique.include) ? { include: members(unique.include)! } : {}),
        },
      ];
    }
    for (const index of table.indexes) {
      const list = members(index.columns);
      if (list)
        node.indexes = [
          ...(node.indexes ?? []),
          {
            name: index.name,
            members: list,
            ...keyOptions(index),
            ...(index.kind ? { kind: index.kind } : {}),
            ...(index.include && members(index.include) ? { include: members(index.include)! } : {}),
          },
        ];
    }
    // CHECK : sur une seule rubrique → son domaine ; sinon contrainte de la table.
    const checks: { check: NamedExpression; column?: string }[] = [
      ...table.columns.filter((c) => c.check).map((c) => ({ check: c.check!, column: c.name })),
      ...table.checks.map((check) => ({ check })),
    ];
    for (const { check, column } of checks) {
      const annotation: CheckConstraint = {
        name: check.name,
        expression: check.expression,
        dialect,
        ...(check.state ? { state: check.state } : {}),
      };
      const cited = column
        ? [column]
        : referencedColumns(check.expression).filter((c) => table.columns.some((col) => key(col.name) === key(c)));
      const attribute = cited.length === 1 ? attributeOf.get(table)?.get(key(cited[0]!)) : undefined;
      if (attribute && !attribute.check) attribute.check = annotation;
      else {
        node.checks ??= [];
        node.checks.push(annotation);
      }
    }
  }

  // Séquences qu'aucune colonne n'utilise : non rattachées, signalées (O-39).
  const used = new Set(
    schema.tables.flatMap((t) => t.columns.map((c) => c.sequence && key(c.sequence.name)).filter(Boolean)),
  );
  for (const sequence of schema.sequences.values())
    if (!used.has(key(sequence.name)) && !sequence.ownedBy) warnings.push(MSG.reverseUnusedSequence(sequence.name));

  placeBetween(doc);
  return {
    doc,
    report: {
      tables: schema.tables.length,
      entities: doc.entities.length,
      associations: doc.associations.length,
      inheritances: doc.inheritances.length,
      ignored: schema.ignored,
      dialect,
      warnings,
    },
  };
}

/** UNIQUE simple : sur des colonnes entières, sans expression ni condition (O-35, O-39). */
const plainKey = (k: ParsedKey) =>
  !k.prefixes && !k.expression && !k.where && !k.state && !k.nullsNotDistinct && !k.nullsDistinct;

/** Préfixes et méthode d'un index ou d'une contrainte UNIQUE (s'ils sont présents). */
function keyOptions(k: ParsedKey) {
  return { ...(k.prefixes ? { prefixes: k.prefixes } : {}), ...(k.method ? { method: k.method } : {}) };
}

/** Domaine de valeurs d'un type ENUM(…) / SET(…) (MySQL) ou d'un type énuméré PostgreSQL. */
function valueDomain(type: string, enumTypes: Map<string, string[]>): ValueDomain | undefined {
  const match = /^\s*(enum|set)\s*\(/i.exec(type);
  if (match) {
    const values = tokenize(type)
      .filter((t) => t.type === "string")
      .map((t) => t.value);
    return { kind: match[1]!.toLowerCase() as "enum" | "set", values };
  }
  const named = enumTypes.get(type.trim().replace(/^"|"$/g, "").toLowerCase());
  return named ? { kind: "enum", values: named } : undefined;
}

/** Clés étrangères dans l'ordre de la clé primaire. */
function orderByKey<T extends ParsedForeignKey>(list: T[], primaryKey: string[]): T[] {
  const position = (fk: T) => Math.min(...fk.columns.map((c) => primaryKey.findIndex((p) => key(p) === key(c))));
  return [...list].sort((a, b) => position(a) - position(b));
}

/** Associations et héritages placés entre leurs entités (le placement automatique affinera). */
function placeBetween(doc: ModelDocument) {
  const { positions } = doc.layout;
  const center = (ids: Id[]) => {
    const points = ids.map((id) => positions[id]).filter((p) => p !== undefined);
    if (!points.length) return { x: 0, y: 0 };
    return {
      x: points.reduce((s, p) => s + p.x, 0) / points.length + 60,
      y: points.reduce((s, p) => s + p.y, 0) / points.length + 110,
    };
  };
  for (const a of doc.associations)
    positions[a.id] = center(doc.links.filter((l) => l.associationId === a.id).map((l) => l.entityId));
  for (const h of doc.inheritances)
    positions[h.id] = center(doc.inheritanceLinks.filter((l) => l.inheritanceId === h.id).map((l) => l.entityId));
}
