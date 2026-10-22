import type { Id, ModelDocument } from "../model/document";
import type { SqlDialect } from "../model/physical";
import { MSG } from "../validation/messages";
import { annotateTables, warnUnusedSequences } from "./buildAnnotations";
import { createDependencies, createInheritances, createJoinAssociations } from "./buildAssociations";
import { createEntities } from "./buildAttributes";
import { type Build, key } from "./buildState";
import { inheritanceCandidates, isJoinTable, markStateDialect, resolveForeignKeys } from "./buildTables";
import { detectDialect } from "./dialect";
import { parseSql } from "./parse";

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
  markStateDialect(schema, dialect);
  const warnings = [
    ...schema.skipped.map((text) => MSG.reverseUnreadable(text)),
    ...schema.warnings.map((where) => MSG.reverseOrphanComment(where)),
  ];
  const doc: ModelDocument = structuredClone(base);
  const fks = resolveForeignKeys(schema, warnings);
  const joinTables = new Set(schema.tables.filter((t) => isJoinTable(t, fks)));
  const { childrenOf, inheritanceFk } = inheritanceCandidates(schema, fks, joinTables);
  const b: Build = {
    schema,
    dialect,
    doc,
    warnings,
    fks,
    joinTables,
    entities: new Map(),
    attributeOf: new Map(),
    referenceLink: new Map(),
    usedNames: new Set(),
    entityNames: new Set(schema.tables.map((t) => key(t.name))),
  };
  const entityTables = schema.tables.filter((t) => !joinTables.has(t));
  createEntities(b, entityTables);
  const joinAssociations = createJoinAssociations(b);
  createDependencies(b, entityTables, inheritanceFk);
  createInheritances(b, childrenOf, inheritanceFk);
  annotateTables(b, joinAssociations);
  warnUnusedSequences(b);
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

/** Associations et héritages placés entre leurs entités (le placement automatique affinera). */
function placeBetween(doc: ModelDocument) {
  const { positions } = doc.layout;
  const center = (ids: Id[]) => {
    const points = ids.map((id) => positions[id]).filter((p) => p !== undefined);
    if (points.length === 0) {
      return { x: 0, y: 0 };
    }
    return {
      x: points.reduce((s, p) => s + p.x, 0) / points.length + 60,
      y: points.reduce((s, p) => s + p.y, 0) / points.length + 110,
    };
  };
  for (const a of doc.associations) {
    positions[a.id] = center(doc.links.filter((l) => l.associationId === a.id).map((l) => l.entityId));
  }
  for (const h of doc.inheritances) {
    positions[h.id] = center(doc.inheritanceLinks.filter((l) => l.inheritanceId === h.id).map((l) => l.entityId));
  }
}
