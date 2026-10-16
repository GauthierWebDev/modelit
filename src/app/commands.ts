import {
  MSG,
  resolveVersion,
  checkAssociation,
  checkAssociationName,
  checkAttributes,
  checkEntityName,
  checkLinkCardinality,
  checkLogicalRename,
  createAssociation,
  createInheritance,
  createInheritanceLink,
  bendsOf,
  diagramLinks,
  diagramNodes,
  linkSourceId,
  positionOf,
  setBends,
  createAttribute,
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
  type LogicalColumn,
  type LogicalModel,
  type LogicalTable,
  type ModelDocument,
  type Point,
} from "@core/index";
import type { Draft } from "immer";
import { t, type MessageKey } from "@/i18n";
import type { DocumentHandle } from "./document/handle";
import { applyModelDefaults } from "./modelDefaults";

/**
 * Commandes métier : seul point d'entrée de l'interface pour modifier le modèle.
 * Chaque commande valide la modification avec les règles de `core/validation`
 * et renvoie le message d'erreur à afficher, ou `null` si elle a été appliquée.
 * Chaque commande reçoit le document sur lequel elle agit (docs/jalons/J-01, phase 1).
 */

const current = (doc: DocumentHandle) => doc.store.getState().doc;
const change = (doc: DocumentHandle, label: MessageKey, recipe: (d: Draft<ModelDocument>) => void) =>
  doc.store.getState().change(label, recipe);

const findNode = (d: Draft<ModelDocument>, id: Id) =>
  d.entities.find((e) => e.id === id) ?? d.associations.find((a) => a.id === id);

export function addEntity(doc: DocumentHandle, position: Point): Id {
  const entity = createEntity(nextFreeName(t("default.entity"), current(doc).entities.map((e) => e.name)));
  change(doc, "history.createEntity", (d) => {
    d.entities.push(entity);
    d.layout.positions[entity.id] = position;
  });
  return entity.id;
}

export function addInheritance(doc: DocumentHandle, position: Point): Id {
  const inheritance = createInheritance();
  change(doc, "history.createInheritance", (d) => {
    d.inheritances.push(inheritance);
    d.layout.positions[inheritance.id] = position;
  });
  return inheritance.id;
}

/**
 * Relie un héritage et une entité (override O-18). La première entité reliée devient
 * l'entité cible (surtype) ; elle se change ensuite dans l'inspecteur.
 */
export function addInheritanceLink(doc: DocumentHandle, inheritanceId: Id, entityId: Id): ConnectResult {
  const { inheritanceLinks } = current(doc);
  if (inheritanceLinks.some((l) => l.inheritanceId === inheritanceId && l.entityId === entityId)) {
    return { error: MSG.alreadyInherits };
  }
  const link = createInheritanceLink(inheritanceId, entityId);
  change(doc, "history.createInheritanceLink", (d) => {
    d.inheritanceLinks.push(link);
    const inheritance = d.inheritances.find((h) => h.id === inheritanceId);
    if (inheritance && !inheritance.parentId) inheritance.parentId = entityId;
  });
  return { created: link.id };
}

export function setInheritanceParent(doc: DocumentHandle, inheritanceId: Id, entityId: Id) {
  change(doc, "history.changeTarget", (d) => {
    const inheritance = d.inheritances.find((h) => h.id === inheritanceId);
    if (inheritance) inheritance.parentId = entityId;
  });
}

export function setInheritanceConstraint(doc: DocumentHandle, inheritanceId: Id, constraint: InheritanceConstraint) {
  change(doc, "history.changeConstraint", (d) => {
    const inheritance = d.inheritances.find((h) => h.id === inheritanceId);
    if (inheritance) inheritance.constraint = constraint;
  });
}

export function updateInheritance(doc: DocumentHandle, inheritanceId: Id, patch: { comment?: string }) {
  change(doc, "history.editInheritance", (d) => {
    const inheritance = d.inheritances.find((h) => h.id === inheritanceId);
    if (inheritance) Object.assign(inheritance, patch);
  });
}

export function addAssociation(doc: DocumentHandle, position: Point): Id {
  const association = createAssociation(nextFreeName(t("default.association"), current(doc).associations.map((a) => a.name)));
  change(doc, "history.createAssociation", (d) => {
    d.associations.push(association);
    d.layout.positions[association.id] = position;
  });
  return association.id;
}

/** Résultat d'une liaison : objet créé à sélectionner, ou message d'erreur. */
export type ConnectResult = { created: Id } | { error: string } | null;

/**
 * Crée une patte entre une association et une entité, dans n'importe quel ordre.
 * Une seule patte par couple association / entité (override O-08) ; la réflexive
 * se crée en reliant une entité à elle-même (cf. `connectNodes`).
 */
export function addLink(doc: DocumentHandle, fromId: Id, toId: Id): ConnectResult {
  const { entities, associations, links } = current(doc);
  const isEntity = (id: Id) => entities.some((e) => e.id === id);
  const isAssociation = (id: Id) => associations.some((a) => a.id === id);
  const pair = isAssociation(fromId) && isEntity(toId) ? [fromId, toId] : isEntity(fromId) && isAssociation(toId) ? [toId, fromId] : null;
  if (!pair) return null;
  const [associationId, entityId] = pair as [Id, Id];
  if (links.some((l) => l.associationId === associationId && l.entityId === entityId)) return { error: MSG.alreadyLinked };
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
  if (isInheritance(fromId) && isEntity(toId)) return addInheritanceLink(doc, fromId, toId);
  if (isEntity(fromId) && isInheritance(toId)) return addInheritanceLink(doc, toId, fromId);
  if (!isEntity(fromId) || !isEntity(toId)) return addLink(doc, fromId, toId);
  const association = createAssociation(nextFreeName(t("default.association"), current(doc).associations.map((a) => a.name)));
  const first = createLink(association.id, fromId);
  const second = createLink(association.id, toId);
  change(doc, fromId === toId ? "history.createReflexive" : "history.createAssociation", (d) => {
    d.associations.push(association);
    d.links.push(first, second);
    d.layout.positions[association.id] = placement.associationPosition;
    if (fromId === toId) setBends(d.layout, second.id, placement.reflexiveBends ?? []);
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
    if (!link) return;
    const names = { ...link.foreignKeyNames };
    if (trimmed) names[attributeId] = trimmed;
    else delete names[attributeId];
    link.foreignKeyNames = Object.keys(names).length ? names : undefined;
  });
  return null;
}

/**
 * Renomme une table (`column` absent) ou une colonne depuis le MLD / MPD (override O-56), dans le
 * MCD : nom logique de l'entité ou de l'association, nom logique de la rubrique, ou nom de la clé
 * étrangère (O-07). Un nom vide rend le nom par défaut ; un nom inchangé ne fait rien.
 */
export function renameLogical(doc: DocumentHandle, logical: LogicalModel, table: LogicalTable, column: LogicalColumn | null, name: string): Check {
  const trimmed = name.trim();
  if (trimmed === (column ?? table).name) return null;
  const error = checkLogicalRename(logical, table.name, column?.name ?? null, trimmed);
  if (error) return error;
  const value = trimmed || undefined;
  const ownerId = table.source.id;
  if (!column) {
    change(doc, "history.renameTable", (d) => {
      const node = findNode(d, ownerId);
      if (node) node.logicalName = value;
    });
    return null;
  }
  if (column.origin) return renameForeignKey(doc, column.origin.linkId, column.origin.attributeId, trimmed);
  const owner = [...current(doc).entities, ...current(doc).associations].find((n) => n.id === ownerId);
  if (!owner || !column.attributeId) return null;
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
  change(doc, "history.removeBend", (d) => setBends(d.layout, linkId, bendsOf(d.layout, linkId).filter((_, i) => i !== index)));
}

/**
 * Décale des objets (aligner, répartir, override O-57). Les cassures d'un trait dont les deux
 * extrémités bougent suivent leur décalage moyen ; les autres restent en place.
 */
export function offsetNodes(doc: DocumentHandle, offsets: Map<Id, Point>, label: MessageKey) {
  if (!offsets.size) return;
  const model = current(doc);
  const positions = new Map<Id, Point>();
  for (const [id, o] of offsets) {
    const p = positionOf(model.layout, id);
    positions.set(id, { x: p.x + o.x, y: p.y + o.y });
  }
  const kept = new Map<Id, Point[]>();
  for (const link of diagramLinks(model)) {
    if (!offsets.has(linkSourceId(link)) || !offsets.has(link.entityId)) kept.set(link.id, bendsOf(model.layout, link.id));
  }
  moveNodes(doc, positions, kept, label);
}

/**
 * Déplace des entités et associations (placement automatique, override O-09). La disposition
 * est commune aux vues MCD, MLD et MPD (override O-01). `bends` remplace les cassures des
 * liens indiqués ; les autres suivent le déplacement moyen de leurs deux extrémités.
 */
export function moveNodes(doc: DocumentHandle, positions: Map<Id, Point>, bends = new Map<Id, Point[]>(), label: MessageKey = "history.autoLayout") {
  change(doc, label, (d) => {
    const delta = new Map<Id, Point>();
    for (const node of diagramNodes(d)) {
      const p = positions.get(node.id);
      if (!p) continue;
      const old = positionOf(d.layout, node.id);
      delta.set(node.id, { x: p.x - old.x, y: p.y - old.y });
      d.layout.positions[node.id] = p;
    }
    for (const link of diagramLinks(d)) {
      const replaced = bends.get(link.id);
      if (replaced) {
        setBends(d.layout, link.id, replaced);
        continue;
      }
      const a = delta.get(linkSourceId(link)) ?? { x: 0, y: 0 };
      const e = delta.get(link.entityId) ?? { x: 0, y: 0 };
      const dx = (a.x + e.x) / 2;
      const dy = (a.y + e.y) / 2;
      if (dx || dy) setBends(d.layout, link.id, bendsOf(d.layout, link.id).map((b) => ({ x: b.x + dx, y: b.y + dy })));
    }
  });
}

export function deleteObjects(doc: DocumentHandle, ids: Id[], label: MessageKey = "history.delete") {
  if (ids.length === 0) return;
  const gone = new Set(ids);
  change(doc, label, (d) => {
    d.entities = d.entities.filter((e) => !gone.has(e.id));
    d.associations = d.associations.filter((a) => !gone.has(a.id));
    d.links = d.links.filter((l) => !gone.has(l.id) && !gone.has(l.entityId) && !gone.has(l.associationId));
    d.inheritances = d.inheritances.filter((h) => !gone.has(h.id));
    d.inheritanceLinks = d.inheritanceLinks.filter((l) => !gone.has(l.id) && !gone.has(l.entityId) && !gone.has(l.inheritanceId));
    // Entité cible dont le lien a disparu : l'héritage n'a plus de cible.
    for (const h of d.inheritances) {
      if (h.parentId && !d.inheritanceLinks.some((l) => l.inheritanceId === h.id && l.entityId === h.parentId)) h.parentId = undefined;
    }
    // Géométrie des objets et des traits disparus.
    const kept = new Set([...diagramNodes(d), ...diagramLinks(d)].map((o) => o.id));
    for (const id of Object.keys(d.layout.positions)) if (!kept.has(id)) delete d.layout.positions[id];
    for (const id of Object.keys(d.layout.bends)) if (!kept.has(id)) delete d.layout.bends[id];
  });
  doc.view.getState().select([]);
}

export function renameNode(doc: DocumentHandle, id: Id, name: string): Check {
  const trimmed = name.trim();
  const model = current(doc);
  const isEntity = model.entities.some((e) => e.id === id);
  const error = isEntity ? checkEntityName(model, trimmed, id) : checkAssociationName(model, trimmed, id);
  if (error) return error;
  change(doc, "history.rename", (d) => {
    const node = findNode(d, id);
    if (node) node.name = trimmed;
  });
  return null;
}

export function updateEntity(doc: DocumentHandle, id: Id, patch: Partial<Pick<Entity, "logicalName" | "fictive" | "comment">>) {
  change(doc, "history.editEntity", (d) => {
    const entity = d.entities.find((e) => e.id === id);
    if (entity) Object.assign(entity, patch);
  });
}

export function updateAssociation(
  doc: DocumentHandle,
  id: Id,
  patch: Partial<Pick<Association, "logicalName" | "comment">>,
): Check {
  const existing = current(doc).associations.find((a) => a.id === id);
  if (!existing) return null;
  const error = checkAssociation(current(doc), { ...existing, ...patch });
  if (error) return error;
  change(doc, "history.editAssociation", (d) => {
    const association = d.associations.find((a) => a.id === id);
    if (association) Object.assign(association, patch);
  });
  return null;
}

/** Remplace la liste des rubriques d'une entité ou d'une association. */
export function setAttributes(doc: DocumentHandle, ownerId: Id, attributes: Attribute[], label: MessageKey = "history.editAttributes"): Check {
  const error = checkAttributes(attributes);
  if (error) return error;
  const association = current(doc).associations.find((a) => a.id === ownerId);
  if (association) {
    const assocError = checkAssociation(current(doc), { ...association, attributes });
    if (assocError) return assocError;
  }
  change(doc, label, (d) => {
    const owner = findNode(d, ownerId);
    if (owner) owner.attributes = attributes;
  });
  return null;
}

/** Renomme une rubrique (nom conceptuel, renommage sur place dans le MCD, override O-58). */
export function renameAttribute(doc: DocumentHandle, ownerId: Id, attributeId: Id, name: string): Check {
  const owner = [...current(doc).entities, ...current(doc).associations].find((n) => n.id === ownerId);
  const attribute = owner?.attributes.find((a) => a.id === attributeId);
  if (!owner || !attribute || attribute.name === name.trim()) return null;
  const attributes = owner.attributes.map((a) => (a.id === attributeId ? { ...a, name: name.trim() } : a));
  return setAttributes(doc, ownerId, attributes, "history.renameAttribute");
}

/** Ajoute en fin de liste une rubrique au nom libre (« rubrique_N ») ; renvoie son identifiant. */
export function addAttribute(doc: DocumentHandle, ownerId: Id): Id | null {
  const owner = [...current(doc).entities, ...current(doc).associations].find((n) => n.id === ownerId);
  if (!owner) return null;
  const taken = new Set(owner.attributes.map((a) => a.name));
  let n = owner.attributes.length + 1;
  while (taken.has(t("attribute.defaultName", { n }))) n++;
  const created = createAttribute(t("attribute.defaultName", { n }));
  return setAttributes(doc, ownerId, [...owner.attributes, created], "history.addAttribute") ? null : created.id;
}

export function addAutoIdentifier(doc: DocumentHandle, entityId: Id): Check {
  const model = current(doc);
  const entity = model.entities.find((e) => e.id === entityId);
  if (!entity) return null;
  const id = createAutoIdentifier(model.settings.autoIdMask, entity.name);
  return setAttributes(doc, entityId, [id, ...entity.attributes], "history.autoIdentifier");
}

export function setLinkCardinality(doc: DocumentHandle, linkId: Id, cardinality: Cardinality): Check {
  const error = checkLinkCardinality(current(doc), linkId, cardinality);
  if (error) return error;
  change(doc, "history.editCardinality", (d) => {
    const link = d.links.find((l) => l.id === linkId);
    if (link) link.cardinality = cardinality;
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
    if (link) Object.assign(link, patch);
  });
}

/** Annotations physiques d'une entité ou d'une association (bloc « Avancé », overrides O-29, O-50). */
export function updatePhysical(doc: DocumentHandle, nodeId: Id, recipe: (node: Entity | Association) => void) {
  change(doc, "history.editPhysical", (d) => {
    const node = findNode(d, nodeId);
    if (node) recipe(node as Entity | Association);
  });
}

/** Change de SGBD cible ; la version passe à la plus récente de ce SGBD (override O-04). */
export function setTargetDbms(doc: DocumentHandle, dbms: Dbms) {
  updateSettings(doc, "history.changeDbms", (s) => {
    s.dbms = dbms;
    s.dbmsVersion = resolveVersion(dbms, undefined);
  });
}

export function setDbmsVersion(doc: DocumentHandle, version: string) {
  updateSettings(doc, "history.changeVersion", (s) => void (s.dbmsVersion = resolveVersion(s.dbms, version)));
}

export function updateSettings(doc: DocumentHandle, label: MessageKey, recipe: (s: Draft<DocumentSettings>) => void) {
  change(doc, label, (d) => recipe(d.settings));
}

/** Texte libre du trait entre tables d'une patte ou d'un lien d'héritage (override O-25). */
export function setRelationLabel(doc: DocumentHandle, linkId: Id, text: string) {
  change(doc, "history.relationText", (d) => {
    const link = findDiagramLink(d, linkId);
    if (link) link.relationLabel = text.trim() || undefined;
  });
}

/** « Appliquer au modèle ouvert » (options générales). */
export function applyDefaultsToCurrent(doc: DocumentHandle) {
  updateSettings(doc, "history.applyDefaults", (s) => applyModelDefaults(s));
}
