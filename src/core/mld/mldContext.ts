import type { Association, Entity, Id, Link, ModelDocument } from "../model/document";
import type { ConstraintState, ReferentialAction, SourceType } from "../model/physical";
import { attributeLogicalName } from "../naming/keys";
import { logicalName } from "../naming/typology";
import type { Issue, LogicalColumn, LogicalTable } from "./logical";

/** Origine d'une colonne migrée (clé étrangère). */
export interface Migration {
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
export interface KeyColumn {
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

export interface Context {
  doc: ModelDocument;
  issues: Issue[];
  entities: Map<Id, Entity>;
  keys: Map<Id, KeyColumn[]>;
  /** Sous-type → héritage valide dont il dépend (surtype) et lien d'héritage du sous-type. */
  parents: Map<Id, { inheritanceId: Id; parentId: Id; linkId: Id }>;
  /** Par table : colonne de chaque membre « patte:rubrique d'origine » (identifiants alternatifs, index). */
  members: Map<LogicalTable, Map<string, string>>;
}

export const memberKey = (linkId: Id, originId: Id) => `${linkId}:${originId}`;

export function recordMembers(ctx: Context, table: LogicalTable, columns: (KeyColumn & { via: Migration })[]) {
  const map = ctx.members.get(table) ?? new Map<string, string>();
  for (const c of columns) {
    if (c.via.reference) {
      map.set(memberKey(c.via.reference.id, c.originId), c.name);
    }
  }
  ctx.members.set(table, map);
}

export const byKeyOrder = <T extends { keyOrder?: number }>(items: T[]) =>
  items
    .map((item, index) => ({ item, index }))
    .sort(
      (a, b) =>
        (a.item.keyOrder ?? Number.POSITIVE_INFINITY) - (b.item.keyOrder ?? Number.POSITIVE_INFINITY) ||
        a.index - b.index,
    )
    .map(({ item }) => item);

export const tableName = (ctx: Context, node: Entity | Association) => logicalName(node, ctx.doc.settings.naming);

export const columnName = (
  ctx: Context,
  attribute: Entity["attributes"][number],
  table: string,
  owner: Entity | Association,
) => attributeLogicalName(attribute, table, ctx.doc.settings.naming, ctx.doc.settings.keys.primary, owner.name);
