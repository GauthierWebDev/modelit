import type { Association, Attribute, Entity, Id, Link } from "../model/document";
import { createAssociation, createInheritance, createInheritanceLink, createLink } from "../model/factory";
import { logicalName } from "../naming/typology";
import { MSG } from "../validation/messages";
import { toAttribute } from "./buildAttributes";
import { applyForeignKey, foreignKeyComments, foreignKeyNames, sharedColumns } from "./buildLinks";
import { associationName, dependencyName, reflexiveRole } from "./buildNames";
import { type Build, key, orderByKey, originOf, type ResolvedFk, sameColumns, within } from "./buildState";
import type { ParsedTable } from "./parse";

/** 5. Associations issues des tables d'association. */
export function createJoinAssociations(b: Build): Map<ParsedTable, Association> {
  const { doc } = b;
  const joinAssociations = new Map<ParsedTable, Association>();
  for (const table of b.joinTables) {
    const association = createAssociation(associationName(b, table.name));
    if (logicalName(association, doc.settings.naming) !== table.name) {
      association.logicalName = table.name;
    }
    association.comment = table.comment;
    const fkColumns = new Set(b.fks.get(table)!.flatMap((fk) => fk.columns.map(key)));
    association.attributes = table.columns
      .filter((c) => !fkColumns.has(key(c.name)))
      .map((c) => toAttribute(b, c, table));
    b.attributeOf.set(table, new Map(association.attributes.map((a) => [key(a.name), a])));
    const links: Link[] = [];
    for (const fk of orderByKey(b.fks.get(table)!, table.primaryKey)) {
      const target = b.entities.get(fk.target);
      if (!target) {
        b.warnings.push(MSG.reverseReferencesAssociation(table.name, fk.target.name));
        continue;
      }
      const link = createLink(association.id, target.id);
      applyForeignKey(link, fk);
      link.foreignKeyNames = foreignKeyNames(b, fk);
      link.foreignKeyComments = foreignKeyComments(b, table, fk);
      b.referenceLink.set(fk, link);
      links.push(link);
    }
    doc.associations.push(association);
    doc.links.push(...links);
    joinAssociations.set(table, association);
  }
  return joinAssociations;
}

/** 6. Associations issues des clés étrangères des entités (hors clé d'héritage). */
export function createDependencies(b: Build, entityTables: ParsedTable[], inheritanceFk: Map<ParsedTable, ResolvedFk>) {
  for (const table of entityTables) {
    const entity = b.entities.get(table)!;
    const before: ResolvedFk[] = [];
    for (const fk of b.fks.get(table)!) {
      if (inheritanceFk.get(table) === fk) {
        continue;
      }
      const parent = b.entities.get(fk.target);
      if (!parent) {
        b.warnings.push(MSG.reverseReferencesAssociation(table.name, fk.target.name));
        continue;
      }
      createDependency(b, table, entity, parent, fk, before);
      before.push(fk);
    }
  }
}

/** Association 1,1 / 0,1 face à 0,n (ou 0,1) issue d'une clé étrangère. */
function createDependency(
  b: Build,
  table: ParsedTable,
  entity: Entity,
  parent: Entity,
  fk: ResolvedFk,
  before: ResolvedFk[],
) {
  const { doc, dialect } = b;
  const relative = table.primaryKey.length > 0 && within(fk.columns, table.primaryKey);
  const columns = fk.columns.map((c) => table.columns.find((col) => key(col.name) === key(c)));
  const notNull = relative || columns.every((c) => c?.notNull);
  // Cardinalité max 1 côté référencé : colonnes exactement couvertes par un UNIQUE (sans
  // condition ni expression) ou la PK.
  const unique =
    (fk.columns.length === 1 && columns[0]?.unique) ||
    table.uniques.some((u) => sameColumns(u.columns, fk.columns) && !u.where && !u.expression && !u.state?.disabled) ||
    sameColumns(fk.columns, table.primaryKey);
  const association = createAssociation(dependencyName(b, table, fk));
  const parentLink = createLink(association.id, parent.id);
  parentLink.cardinality = { min: 0, max: unique ? 1 : "n" };
  parentLink.foreignKeyNames = foreignKeyNames(b, fk);
  parentLink.foreignKeyComments = foreignKeyComments(b, table, fk);
  parentLink.sharedColumns = relative ? undefined : sharedColumns(b, table, fk, before);
  referencedAttributes(b, parentLink, fk);
  const childLink = createLink(association.id, entity.id);
  childLink.cardinality = { min: notNull ? 1 : 0, max: 1 };
  childLink.relativeId = relative;
  childLink.foreignKeyHolder = true;
  applyForeignKey(childLink, fk);
  if (fk.target === table) {
    parentLink.role = reflexiveRole(table, fk);
  }
  // MySQL analyse mais n'applique pas un REFERENCES écrit dans la définition de colonne.
  if (fk.inline && (dialect === "mysql" || dialect === "mariadb")) {
    childLink.sourceNotEnforced = true;
  }
  b.referenceLink.set(fk, parentLink);
  doc.associations.push(association);
  doc.links.push(parentLink, childLink);
}

/** Clé étrangère vers un identifiant alternatif (ex. oeuvre(isbn)) : rubriques référencées (O-35). */
function referencedAttributes(b: Build, parentLink: Link, fk: ResolvedFk) {
  if (sameColumns(fk.referencedColumns, fk.target.primaryKey)) {
    return;
  }
  const targets = fk.referencedColumns.map((c) => b.attributeOf.get(fk.target)?.get(key(c)));
  if (targets.every((a): a is Attribute => Boolean(a))) {
    parentLink.referencedAttributes = targets.map((a) => a.id);
  }
}

/** Héritages : entité générique et entités spécialisées, clé héritée renommée au besoin. */
export function createInheritances(
  b: Build,
  childrenOf: Map<ParsedTable, ParsedTable[]>,
  inheritanceFk: Map<ParsedTable, ResolvedFk>,
) {
  const { doc } = b;
  for (const [parent, children] of childrenOf) {
    const inheritance = createInheritance();
    inheritance.parentId = b.entities.get(parent)!.id;
    doc.inheritances.push(inheritance);
    doc.inheritanceLinks.push(createInheritanceLink(inheritance.id, b.entities.get(parent)!.id));
    for (const child of children) {
      const link = createInheritanceLink(inheritance.id, b.entities.get(child)!.id);
      const fk = inheritanceFk.get(child)!;
      link.onDelete = fk.onDelete;
      link.onUpdate = fk.onUpdate;
      link.foreignKeyConstraintName = fk.name;
      if (fk.state) {
        link.foreignKeyState = fk.state;
      }
      // Clé héritée : même nom que celle de l'entité générique, sauf renommage (adherent_id → id).
      const names: Record<Id, string> = {};
      fk.columns.forEach((column, i) => {
        const origin = originOf(b, fk.target, fk.referencedColumns[i]!);
        if (origin && key(column) !== key(fk.referencedColumns[i]!)) {
          names[origin.id] = column;
        }
      });
      if (Object.keys(names).length > 0) {
        link.foreignKeyNames = names;
      }
      doc.inheritanceLinks.push(link);
    }
  }
}
