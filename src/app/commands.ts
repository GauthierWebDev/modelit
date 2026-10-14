import {
  MSG,
  resolveVersion,
  checkAssociation,
  checkAssociationName,
  checkAttributes,
  checkEntityName,
  checkLinkCardinality,
  createAssociation,
  createInheritance,
  createInheritanceLink,
  diagramLinks,
  diagramNodes,
  linkSourceId,
  createAutoIdentifier,
  createEntity,
  createLink,
  nextFreeName,
  type Association,
  type Attribute,
  type Cardinality,
  type Check,
  type Dbms,
  type DocumentSettings,
  type Entity,
  type Id,
  type InheritanceConstraint,
  type Link,
  type ModelDocument,
  type Point,
} from "@core/index";
import type { Draft } from "immer";
import { t, type MessageKey } from "@/i18n";
import { useDocumentStore } from "./documentStore";
import { applyModelDefaults } from "./modelDefaults";
import { useUiStore } from "./uiStore";

/**
 * Commandes métier : seul point d'entrée de l'interface pour modifier le modèle.
 * Chaque commande valide la modification avec les règles de `core/validation`
 * et renvoie le message d'erreur à afficher, ou `null` si elle a été appliquée.
 */

const doc = () => useDocumentStore.getState().doc;
const change = (label: MessageKey, recipe: (d: Draft<ModelDocument>) => void) =>
  useDocumentStore.getState().change(label, recipe);

const findNode = (d: Draft<ModelDocument>, id: Id) =>
  d.entities.find((e) => e.id === id) ?? d.associations.find((a) => a.id === id);

export function addEntity(position: Point): Id {
  const entity = createEntity(nextFreeName(t("default.entity"), doc().entities.map((e) => e.name)), position);
  change("history.createEntity", (d) => void d.entities.push(entity));
  return entity.id;
}

export function addInheritance(position: Point): Id {
  const inheritance = createInheritance(position);
  change("history.createInheritance", (d) => void d.inheritances.push(inheritance));
  return inheritance.id;
}

/**
 * Relie un héritage et une entité (override O-18). La première entité reliée devient
 * l'entité cible (surtype) ; elle se change ensuite dans l'inspecteur.
 */
export function addInheritanceLink(inheritanceId: Id, entityId: Id): ConnectResult {
  const { inheritanceLinks } = doc();
  if (inheritanceLinks.some((l) => l.inheritanceId === inheritanceId && l.entityId === entityId)) {
    return { error: MSG.alreadyInherits };
  }
  const link = createInheritanceLink(inheritanceId, entityId);
  change("history.createInheritanceLink", (d) => {
    d.inheritanceLinks.push(link);
    const inheritance = d.inheritances.find((h) => h.id === inheritanceId);
    if (inheritance && !inheritance.parentId) inheritance.parentId = entityId;
  });
  return { created: link.id };
}

export function setInheritanceParent(inheritanceId: Id, entityId: Id) {
  change("history.changeTarget", (d) => {
    const inheritance = d.inheritances.find((h) => h.id === inheritanceId);
    if (inheritance) inheritance.parentId = entityId;
  });
}

export function setInheritanceConstraint(inheritanceId: Id, constraint: InheritanceConstraint) {
  change("history.changeConstraint", (d) => {
    const inheritance = d.inheritances.find((h) => h.id === inheritanceId);
    if (inheritance) inheritance.constraint = constraint;
  });
}

export function updateInheritance(inheritanceId: Id, patch: { comment?: string }) {
  change("history.editInheritance", (d) => {
    const inheritance = d.inheritances.find((h) => h.id === inheritanceId);
    if (inheritance) Object.assign(inheritance, patch);
  });
}

export function addAssociation(position: Point): Id {
  const association = createAssociation(nextFreeName(t("default.association"), doc().associations.map((a) => a.name)), position);
  change("history.createAssociation", (d) => void d.associations.push(association));
  return association.id;
}

/** Résultat d'une liaison : objet créé à sélectionner, ou message d'erreur. */
export type ConnectResult = { created: Id } | { error: string } | null;

/**
 * Crée une patte entre une association et une entité, dans n'importe quel ordre.
 * Une seule patte par couple association / entité (override O-08) ; la réflexive
 * se crée en reliant une entité à elle-même (cf. `connectNodes`).
 */
export function addLink(fromId: Id, toId: Id): ConnectResult {
  const { entities, associations, links } = doc();
  const isEntity = (id: Id) => entities.some((e) => e.id === id);
  const isAssociation = (id: Id) => associations.some((a) => a.id === id);
  const pair = isAssociation(fromId) && isEntity(toId) ? [fromId, toId] : isEntity(fromId) && isAssociation(toId) ? [toId, fromId] : null;
  if (!pair) return null;
  const [associationId, entityId] = pair as [Id, Id];
  if (links.some((l) => l.associationId === associationId && l.entityId === entityId)) return { error: MSG.alreadyLinked };
  const link = createLink(associationId, entityId);
  change("history.createLink", (d) => void d.links.push(link));
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
  fromId: Id,
  toId: Id,
  placement: { associationPosition: Point; reflexiveBends?: Point[] },
): ConnectResult {
  const { entities, inheritances } = doc();
  const isEntity = (id: Id) => entities.some((e) => e.id === id);
  const isInheritance = (id: Id) => inheritances.some((h) => h.id === id);
  if (isInheritance(fromId) && isEntity(toId)) return addInheritanceLink(fromId, toId);
  if (isEntity(fromId) && isInheritance(toId)) return addInheritanceLink(toId, fromId);
  if (!isEntity(fromId) || !isEntity(toId)) return addLink(fromId, toId);
  const association = createAssociation(
    nextFreeName(t("default.association"), doc().associations.map((a) => a.name)),
    placement.associationPosition,
  );
  const first = createLink(association.id, fromId);
  const second = createLink(association.id, toId);
  if (fromId === toId) second.bends = placement.reflexiveBends ?? [];
  change(fromId === toId ? "history.createReflexive" : "history.createAssociation", (d) => {
    d.associations.push(association);
    d.links.push(first, second);
  });
  return { created: association.id };
}

/**
 * Renomme une clé étrangère (override O-07). `linkId` est la patte de l'entité référencée,
 * `attributeId` la rubrique discriminante d'origine (cf. `LogicalColumn.origin`).
 * Un nom vide rétablit le nom par défaut.
 */
export function renameForeignKey(linkId: Id, attributeId: Id, name: string): Check {
  const trimmed = name.trim();
  change("history.renameForeignKey", (d) => {
    const link = d.links.find((l) => l.id === linkId);
    if (!link) return;
    const names = { ...link.foreignKeyNames };
    if (trimmed) names[attributeId] = trimmed;
    else delete names[attributeId];
    link.foreignKeyNames = Object.keys(names).length ? names : undefined;
  });
  return null;
}

/** Patte d'association ou lien d'héritage, dans un brouillon. */
export const findDiagramLink = (d: Draft<ModelDocument>, id: Id) =>
  d.links.find((l) => l.id === id) ?? d.inheritanceLinks.find((l) => l.id === id);

/** Supprime les cassures d'un lien. */
export function straightenLink(linkId: Id) {
  change("history.straighten", (d) => {
    const link = findDiagramLink(d, linkId);
    if (link) link.bends = [];
  });
}

export function removeBend(linkId: Id, index: number) {
  useUiStore.getState().setActiveBend(null);
  change("history.removeBend", (d) => {
    const link = findDiagramLink(d, linkId);
    if (link) link.bends.splice(index, 1);
  });
}

/**
 * Déplace des entités et associations (placement automatique, override O-09). La disposition
 * est commune aux vues MCD, MLD et MPD (override O-01). `bends` remplace les cassures des
 * liens indiqués ; les autres suivent le déplacement moyen de leurs deux extrémités.
 */
export function moveNodes(positions: Map<Id, Point>, bends = new Map<Id, Point[]>(), label: MessageKey = "history.autoLayout") {
  change(label, (d) => {
    const delta = new Map<Id, Point>();
    for (const node of diagramNodes(d)) {
      const p = positions.get(node.id);
      if (!p) continue;
      delta.set(node.id, { x: p.x - node.position.x, y: p.y - node.position.y });
      node.position = p;
    }
    for (const link of diagramLinks(d)) {
      const replaced = bends.get(link.id);
      if (replaced) {
        link.bends = replaced;
        continue;
      }
      const a = delta.get(linkSourceId(link)) ?? { x: 0, y: 0 };
      const e = delta.get(link.entityId) ?? { x: 0, y: 0 };
      const dx = (a.x + e.x) / 2;
      const dy = (a.y + e.y) / 2;
      if (dx || dy) link.bends = link.bends.map((b) => ({ x: b.x + dx, y: b.y + dy }));
    }
  });
}

export function deleteObjects(ids: Id[]) {
  if (ids.length === 0) return;
  const gone = new Set(ids);
  change("history.delete", (d) => {
    d.entities = d.entities.filter((e) => !gone.has(e.id));
    d.associations = d.associations.filter((a) => !gone.has(a.id));
    d.links = d.links.filter((l) => !gone.has(l.id) && !gone.has(l.entityId) && !gone.has(l.associationId));
    d.inheritances = d.inheritances.filter((h) => !gone.has(h.id));
    d.inheritanceLinks = d.inheritanceLinks.filter((l) => !gone.has(l.id) && !gone.has(l.entityId) && !gone.has(l.inheritanceId));
    // Entité cible dont le lien a disparu : l'héritage n'a plus de cible.
    for (const h of d.inheritances) {
      if (h.parentId && !d.inheritanceLinks.some((l) => l.inheritanceId === h.id && l.entityId === h.parentId)) h.parentId = undefined;
    }
  });
  useUiStore.getState().select([]);
}

export function renameNode(id: Id, name: string): Check {
  const trimmed = name.trim();
  const current = doc();
  const isEntity = current.entities.some((e) => e.id === id);
  const error = isEntity ? checkEntityName(current, trimmed, id) : checkAssociationName(current, trimmed, id);
  if (error) return error;
  change("history.rename", (d) => {
    const node = findNode(d, id);
    if (node) node.name = trimmed;
  });
  return null;
}

export function updateEntity(id: Id, patch: Partial<Pick<Entity, "logicalName" | "fictive" | "comment">>) {
  change("history.editEntity", (d) => {
    const entity = d.entities.find((e) => e.id === id);
    if (entity) Object.assign(entity, patch);
  });
}

export function updateAssociation(
  id: Id,
  patch: Partial<Pick<Association, "logicalName" | "comment">>,
): Check {
  const current = doc().associations.find((a) => a.id === id);
  if (!current) return null;
  const error = checkAssociation(doc(), { ...current, ...patch });
  if (error) return error;
  change("history.editAssociation", (d) => {
    const association = d.associations.find((a) => a.id === id);
    if (association) Object.assign(association, patch);
  });
  return null;
}

/** Remplace la liste des rubriques d'une entité ou d'une association. */
export function setAttributes(ownerId: Id, attributes: Attribute[], label: MessageKey = "history.editAttributes"): Check {
  const error = checkAttributes(attributes);
  if (error) return error;
  const association = doc().associations.find((a) => a.id === ownerId);
  if (association) {
    const assocError = checkAssociation(doc(), { ...association, attributes });
    if (assocError) return assocError;
  }
  change(label, (d) => {
    const owner = findNode(d, ownerId);
    if (owner) owner.attributes = attributes;
  });
  return null;
}

export function addAutoIdentifier(entityId: Id): Check {
  const current = doc();
  const entity = current.entities.find((e) => e.id === entityId);
  if (!entity) return null;
  const id = createAutoIdentifier(current.settings.autoIdMask, entity.name);
  return setAttributes(entityId, [id, ...entity.attributes], "history.autoIdentifier");
}

export function setLinkCardinality(linkId: Id, cardinality: Cardinality): Check {
  const error = checkLinkCardinality(doc(), linkId, cardinality);
  if (error) return error;
  change("history.editCardinality", (d) => {
    const link = d.links.find((l) => l.id === linkId);
    if (link) link.cardinality = cardinality;
  });
  return null;
}

export function updateLink(
  linkId: Id,
  patch: Partial<Pick<Link, "relativeId" | "role" | "onDelete" | "onUpdate" | "foreignKeyConstraintName">>,
) {
  change("history.editLink", (d) => {
    const link = d.links.find((l) => l.id === linkId);
    if (link) Object.assign(link, patch);
  });
}

/** Annotations physiques d'une entité ou d'une association (vue avancée, override O-29). */
export function updatePhysical(nodeId: Id, recipe: (node: Entity | Association) => void) {
  change("history.editPhysical", (d) => {
    const node = findNode(d, nodeId);
    if (node) recipe(node as Entity | Association);
  });
}

/** Change de SGBD cible ; la version passe à la plus récente de ce SGBD (override O-04). */
export function setTargetDbms(dbms: Dbms) {
  updateSettings("history.changeDbms", (s) => {
    s.dbms = dbms;
    s.dbmsVersion = resolveVersion(dbms, undefined);
  });
}

export function setDbmsVersion(version: string) {
  updateSettings("history.changeVersion", (s) => void (s.dbmsVersion = resolveVersion(s.dbms, version)));
}

export function updateSettings(label: MessageKey, recipe: (s: Draft<DocumentSettings>) => void) {
  change(label, (d) => recipe(d.settings));
}

/** Texte libre du trait entre tables d'une patte ou d'un lien d'héritage (override O-25). */
export function setRelationLabel(linkId: Id, text: string) {
  change("history.relationText", (d) => {
    const link = findDiagramLink(d, linkId);
    if (link) link.relationLabel = text.trim() || undefined;
  });
}

/** « Appliquer au modèle ouvert » (options générales). */
export function applyDefaultsToCurrent() {
  updateSettings("history.applyDefaults", (s) => applyModelDefaults(s));
}
