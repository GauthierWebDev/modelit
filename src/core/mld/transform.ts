import type { Association, Id, Link, ModelDocument } from "../model/document";
import { MSG } from "../validation/messages";
import { generatesTable, linksOf } from "../validation/rules";
import type { LogicalModel, LogicalTable } from "./logical";
import { checkAssociationModel, checkConceptualModel, checkInheritances, checkTables } from "./mldChecks";
import type { Context } from "./mldContext";
import { addReference } from "./mldKeys";
import { applyPhysical, associationTable, dependentSide, entityTable } from "./mldTables";

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
    if (!entity.fictive) {
      tables.set(entity.id, entityTable(ctx, entity));
    }
  }

  for (const association of doc.associations) {
    associationTables(ctx, association, tables);
  }

  const result = [...tables.values()];
  for (const table of result) {
    const node =
      table.source.kind === "entity"
        ? ctx.entities.get(table.source.id)
        : doc.associations.find((a) => a.id === table.source.id);
    if (node) {
      applyPhysical(ctx, table, node);
    }
  }
  checkTables(ctx, result);
  return { tables: result, issues: ctx.issues };
}

/** Association : table de correspondance, ou clé étrangère côté dépendant. */
function associationTables(ctx: Context, association: Association, tables: Map<Id, LogicalTable>) {
  const links = linksOf(ctx.doc, association.id).filter((l) => ctx.entities.has(l.entityId));
  if (!checkAssociationModel(ctx, association, links)) {
    return;
  }

  if (generatesTable(links) || links.length > 2) {
    if (!generatesTable(links)) {
      ctx.issues.push({
        severity: "warning",
        message: MSG.naryWithFunctionalLeg,
        target: { kind: "association", id: association.id },
      });
    }
    tables.set(association.id, associationTable(ctx, association, links));
    return;
  }

  const { child, parent } = dependentSide(links as [Link, Link]);
  const childTable = tables.get(child.entityId);
  if (!childTable || child.relativeId) {
    return; // entité fictive, ou FK déjà dans la clé
  }
  addReference(ctx, childTable, parent, child, {
    notNull: child.cardinality.min >= 1,
    inPrimaryKey: false,
    // 1:1 : la patte référencée est de cardinalité max 1.
    unique: parent.cardinality.max === 1,
  });
}
