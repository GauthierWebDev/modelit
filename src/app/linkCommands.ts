import {
  bendsOf,
  type Cardinality,
  type Check,
  checkLinkCardinality,
  checkLogicalRename,
  createAssociation,
  createLink,
  type Id,
  type Link,
  type LogicalColumn,
  type LogicalModel,
  type LogicalTable,
  type ModelDocument,
  MSG,
  nextFreeName,
  type Point,
  setBends,
} from "@core/index";
import type { Draft } from "immer";
import { t } from "@/i18n";
import { setAttributes } from "./attributeCommands";
import { change, current, findNode } from "./commandSupport";
import type { DocumentHandle } from "./document/handle";
import { addInheritanceLink } from "./nodeCommands";

/** Résultat d'une liaison : objet créé à sélectionner, ou message d'erreur. */
export type ConnectResult = { created: Id } | { error: string } | null;

/** Association que crée l'outil Lien entre deux entités : nom par défaut libre (« Association 2 »…). */
export const newAssociation = (doc: ModelDocument) =>
  createAssociation(
    nextFreeName(
      t("default.association"),
      doc.associations.map((a) => a.name),
    ),
  );

/**
 * Crée une patte entre une association et une entité, dans n'importe quel ordre.
 * Une seule patte par couple association / entité (override O-08) ; la réflexive
 * se crée en reliant une entité à elle-même (cf. `connectNodes`).
 */
export function addLink(doc: DocumentHandle, fromId: Id, toId: Id): ConnectResult {
  const { entities, associations, links } = current(doc);
  const isEntity = (id: Id) => entities.some((e) => e.id === id);
  const isAssociation = (id: Id) => associations.some((a) => a.id === id);
  const pair =
    isAssociation(fromId) && isEntity(toId)
      ? [fromId, toId]
      : isEntity(fromId) && isAssociation(toId)
        ? [toId, fromId]
        : null;
  if (!pair) {
    return null;
  }
  const [associationId, entityId] = pair as [Id, Id];
  if (links.some((l) => l.associationId === associationId && l.entityId === entityId)) {
    return { error: MSG.alreadyLinked };
  }
  const link = createLink(associationId, entityId);
  change(doc, "history.createLink", (d) => void d.links.push(link));
  return { created: link.id };
}

/**
 * Relie deux objets avec l'outil Lien (overrides O-02 et O-08) :
 *  - association + entité → une patte ;
 *  - entité + autre entité → une nouvelle association en `associationPosition`, avec ses deux pattes ;
 *  - entité + elle-même → une association réflexive (deux pattes vers la même entité),
 *    la seconde patte suivant `reflexiveBends` pour ne pas se confondre avec la première ;
 *  - héritage + entité → un lien d'héritage (override O-18).
 * Une seule entrée d'historique dans tous les cas.
 */
export function connectNodes(
  doc: DocumentHandle,
  fromId: Id,
  toId: Id,
  placement: { associationPosition: Point; reflexiveBends?: Point[] },
): ConnectResult {
  const { entities, inheritances } = current(doc);
  const isEntity = (id: Id) => entities.some((e) => e.id === id);
  const isInheritance = (id: Id) => inheritances.some((h) => h.id === id);
  if (isInheritance(fromId) && isEntity(toId)) {
    return addInheritanceLink(doc, fromId, toId);
  }
  if (isEntity(fromId) && isInheritance(toId)) {
    return addInheritanceLink(doc, toId, fromId);
  }
  if (!(isEntity(fromId) && isEntity(toId))) {
    return addLink(doc, fromId, toId);
  }
  const association = newAssociation(current(doc));
  const first = createLink(association.id, fromId);
  const second = createLink(association.id, toId);
  change(doc, fromId === toId ? "history.createReflexive" : "history.createAssociation", (d) => {
    d.associations.push(association);
    d.links.push(first, second);
    d.layout.positions[association.id] = placement.associationPosition;
    if (fromId === toId) {
      setBends(d.layout, second.id, placement.reflexiveBends ?? []);
    }
  });
  return { created: association.id };
}

/**
 * Renomme une clé étrangère (override O-07). `linkId` est la patte de l'entité référencée,
 * `attributeId` la rubrique discriminante d'origine (cf. `LogicalColumn.origin`).
 * Un nom vide rétablit le nom par défaut.
 */
export function renameForeignKey(doc: DocumentHandle, linkId: Id, attributeId: Id, name: string): Check {
  const trimmed = name.trim();
  change(doc, "history.renameForeignKey", (d) => {
    const link = d.links.find((l) => l.id === linkId);
    if (!link) {
      return;
    }
    const names = { ...link.foreignKeyNames };
    if (trimmed) {
      names[attributeId] = trimmed;
    } else {
      delete names[attributeId];
    }
    link.foreignKeyNames = Object.keys(names).length > 0 ? names : undefined;
  });
  return null;
}

/**
 * Renomme une table (`column` absent) ou une colonne depuis le MLD / MPD (override O-56), dans le
 * MCD : nom logique de l'entité ou de l'association, nom logique de la rubrique, ou nom de la clé
 * étrangère (O-07). Un nom vide rend le nom par défaut ; un nom inchangé ne fait rien.
 */
export function renameLogical(
  doc: DocumentHandle,
  logical: LogicalModel,
  table: LogicalTable,
  column: LogicalColumn | null,
  name: string,
): Check {
  const trimmed = name.trim();
  if (trimmed === (column ?? table).name) {
    return null;
  }
  const error = checkLogicalRename(logical, table.name, column?.name ?? null, trimmed);
  if (error) {
    return error;
  }
  const value = trimmed || undefined;
  const ownerId = table.source.id;
  if (!column) {
    change(doc, "history.renameTable", (d) => {
      const node = findNode(d, ownerId);
      if (node) {
        node.logicalName = value;
      }
    });
    return null;
  }
  if (column.origin) {
    return renameForeignKey(doc, column.origin.linkId, column.origin.attributeId, trimmed);
  }
  const owner = [...current(doc).entities, ...current(doc).associations].find((n) => n.id === ownerId);
  if (!(owner && column.attributeId)) {
    return null;
  }
  const attributes = owner.attributes.map((a) => (a.id === column.attributeId ? { ...a, logicalName: value } : a));
  return setAttributes(doc, ownerId, attributes, "history.renameColumn");
}

/** Patte d'association ou lien d'héritage, dans un brouillon. */
export const findDiagramLink = (d: Draft<ModelDocument>, id: Id) =>
  d.links.find((l) => l.id === id) ?? d.inheritanceLinks.find((l) => l.id === id);

/** Supprime les cassures d'un lien. */
export function straightenLink(doc: DocumentHandle, linkId: Id) {
  change(doc, "history.straighten", (d) => setBends(d.layout, linkId, []));
}

export function removeBend(doc: DocumentHandle, linkId: Id, index: number) {
  doc.view.getState().setActiveBend(null);
  change(doc, "history.removeBend", (d) =>
    setBends(
      d.layout,
      linkId,
      bendsOf(d.layout, linkId).filter((_, i) => i !== index),
    ),
  );
}

export function setLinkCardinality(doc: DocumentHandle, linkId: Id, cardinality: Cardinality): Check {
  const error = checkLinkCardinality(current(doc), linkId, cardinality);
  if (error) {
    return error;
  }
  change(doc, "history.editCardinality", (d) => {
    const link = d.links.find((l) => l.id === linkId);
    if (link) {
      link.cardinality = cardinality;
    }
  });
  return null;
}

export function updateLink(
  doc: DocumentHandle,
  linkId: Id,
  patch: Partial<Pick<Link, "relativeId" | "role" | "onDelete" | "onUpdate" | "foreignKeyConstraintName">>,
) {
  change(doc, "history.editLink", (d) => {
    const link = d.links.find((l) => l.id === linkId);
    if (link) {
      Object.assign(link, patch);
    }
  });
}

/** Texte libre du trait entre tables d'une patte ou d'un lien d'héritage (override O-25). */
export function setRelationLabel(doc: DocumentHandle, linkId: Id, text: string) {
  change(doc, "history.relationText", (d) => {
    const link = findDiagramLink(d, linkId);
    if (link) {
      link.relationLabel = text.trim() || undefined;
    }
  });
}
