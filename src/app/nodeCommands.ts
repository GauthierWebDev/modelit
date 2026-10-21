import {
  type Association,
  bendsOf,
  type Check,
  checkAssociation,
  checkAssociationName,
  checkEntityName,
  createAssociation,
  createEntity,
  createInheritance,
  createInheritanceLink,
  diagramLinks,
  diagramNodes,
  type Entity,
  type Id,
  type InheritanceConstraint,
  linkSourceId,
  MSG,
  nextFreeName,
  type Point,
  positionOf,
  setBends,
} from "@core/index";
import { type MessageKey, t } from "@/i18n";
import { change, current, findNode } from "./commandSupport";
import type { DocumentHandle } from "./document/handle";
import type { ConnectResult } from "./linkCommands";

export function addEntity(doc: DocumentHandle, position: Point): Id {
  const entity = createEntity(
    nextFreeName(
      t("default.entity"),
      current(doc).entities.map((e) => e.name),
    ),
  );
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
    if (inheritance && !inheritance.parentId) {
      inheritance.parentId = entityId;
    }
  });
  return { created: link.id };
}

export function setInheritanceParent(doc: DocumentHandle, inheritanceId: Id, entityId: Id) {
  change(doc, "history.changeTarget", (d) => {
    const inheritance = d.inheritances.find((h) => h.id === inheritanceId);
    if (inheritance) {
      inheritance.parentId = entityId;
    }
  });
}

export function setInheritanceConstraint(doc: DocumentHandle, inheritanceId: Id, constraint: InheritanceConstraint) {
  change(doc, "history.changeConstraint", (d) => {
    const inheritance = d.inheritances.find((h) => h.id === inheritanceId);
    if (inheritance) {
      inheritance.constraint = constraint;
    }
  });
}

export function updateInheritance(doc: DocumentHandle, inheritanceId: Id, patch: { comment?: string }) {
  change(doc, "history.editInheritance", (d) => {
    const inheritance = d.inheritances.find((h) => h.id === inheritanceId);
    if (inheritance) {
      Object.assign(inheritance, patch);
    }
  });
}

export function addAssociation(doc: DocumentHandle, position: Point): Id {
  const association = createAssociation(
    nextFreeName(
      t("default.association"),
      current(doc).associations.map((a) => a.name),
    ),
  );
  change(doc, "history.createAssociation", (d) => {
    d.associations.push(association);
    d.layout.positions[association.id] = position;
  });
  return association.id;
}

/**
 * Décale des objets (aligner, répartir, override O-57). Les cassures d'un trait dont les deux
 * extrémités bougent suivent leur décalage moyen ; les autres restent en place.
 */
export function offsetNodes(doc: DocumentHandle, offsets: Map<Id, Point>, label: MessageKey) {
  if (offsets.size === 0) {
    return;
  }
  const model = current(doc);
  const positions = new Map<Id, Point>();
  for (const [id, o] of offsets) {
    const p = positionOf(model.layout, id);
    positions.set(id, { x: p.x + o.x, y: p.y + o.y });
  }
  const kept = new Map<Id, Point[]>();
  for (const link of diagramLinks(model)) {
    if (!(offsets.has(linkSourceId(link)) && offsets.has(link.entityId))) {
      kept.set(link.id, bendsOf(model.layout, link.id));
    }
  }
  moveNodes(doc, positions, kept, label);
}

/**
 * Déplace des entités et associations (placement automatique, override O-09). La disposition
 * est commune aux vues MCD, MLD et MPD (override O-01). `bends` remplace les cassures des
 * liens indiqués ; les autres suivent le déplacement moyen de leurs deux extrémités.
 */
export function moveNodes(
  doc: DocumentHandle,
  positions: Map<Id, Point>,
  bends = new Map<Id, Point[]>(),
  label: MessageKey = "history.autoLayout",
) {
  change(doc, label, (d) => {
    const delta = new Map<Id, Point>();
    for (const node of diagramNodes(d)) {
      const p = positions.get(node.id);
      if (!p) {
        continue;
      }
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
      if (dx || dy) {
        setBends(
          d.layout,
          link.id,
          bendsOf(d.layout, link.id).map((b) => ({ x: b.x + dx, y: b.y + dy })),
        );
      }
    }
  });
}

export function deleteObjects(doc: DocumentHandle, ids: Id[], label: MessageKey = "history.delete") {
  if (ids.length === 0) {
    return;
  }
  const gone = new Set(ids);
  change(doc, label, (d) => {
    d.entities = d.entities.filter((e) => !gone.has(e.id));
    d.associations = d.associations.filter((a) => !gone.has(a.id));
    d.links = d.links.filter((l) => !(gone.has(l.id) || gone.has(l.entityId) || gone.has(l.associationId)));
    d.inheritances = d.inheritances.filter((h) => !gone.has(h.id));
    d.inheritanceLinks = d.inheritanceLinks.filter(
      (l) => !(gone.has(l.id) || gone.has(l.entityId) || gone.has(l.inheritanceId)),
    );
    // Entité cible dont le lien a disparu : l'héritage n'a plus de cible.
    for (const h of d.inheritances) {
      if (h.parentId && !d.inheritanceLinks.some((l) => l.inheritanceId === h.id && l.entityId === h.parentId)) {
        h.parentId = undefined;
      }
    }
    // Géométrie des objets et des traits disparus.
    const kept = new Set([...diagramNodes(d), ...diagramLinks(d)].map((o) => o.id));
    for (const id of Object.keys(d.layout.positions)) {
      if (!kept.has(id)) {
        delete d.layout.positions[id];
      }
    }
    for (const id of Object.keys(d.layout.bends)) {
      if (!kept.has(id)) {
        delete d.layout.bends[id];
      }
    }
  });
  doc.view.getState().select([]);
}

export function renameNode(doc: DocumentHandle, id: Id, name: string): Check {
  const trimmed = name.trim();
  const model = current(doc);
  const isEntity = model.entities.some((e) => e.id === id);
  const error = isEntity ? checkEntityName(model, trimmed, id) : checkAssociationName(model, trimmed, id);
  if (error) {
    return error;
  }
  change(doc, "history.rename", (d) => {
    const node = findNode(d, id);
    if (node) {
      node.name = trimmed;
    }
  });
  return null;
}

export function updateEntity(
  doc: DocumentHandle,
  id: Id,
  patch: Partial<Pick<Entity, "logicalName" | "fictive" | "comment">>,
) {
  change(doc, "history.editEntity", (d) => {
    const entity = d.entities.find((e) => e.id === id);
    if (entity) {
      Object.assign(entity, patch);
    }
  });
}

export function updateAssociation(
  doc: DocumentHandle,
  id: Id,
  patch: Partial<Pick<Association, "logicalName" | "comment">>,
): Check {
  const existing = current(doc).associations.find((a) => a.id === id);
  if (!existing) {
    return null;
  }
  const error = checkAssociation(current(doc), { ...existing, ...patch });
  if (error) {
    return error;
  }
  change(doc, "history.editAssociation", (d) => {
    const association = d.associations.find((a) => a.id === id);
    if (association) {
      Object.assign(association, patch);
    }
  });
  return null;
}

/** Annotations physiques d'une entité ou d'une association (bloc « Avancé », overrides O-29, O-50). */
export function updatePhysical(doc: DocumentHandle, nodeId: Id, recipe: (node: Entity | Association) => void) {
  change(doc, "history.editPhysical", (d) => {
    const node = findNode(d, nodeId);
    if (node) {
      recipe(node as Entity | Association);
    }
  });
}
