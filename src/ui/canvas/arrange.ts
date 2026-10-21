import {
  type Alignment,
  alignBoxes,
  type Box,
  bendsOf,
  type DistributeAxis,
  diagramLinks,
  distributeBoxes,
  type Id,
  linkSourceId,
  type Point,
  positionOf,
  setBends,
} from "@core/index";
import { offsetNodes } from "@/app/commands";
import { logicalModelOf } from "@/app/derived";
import type { DocumentHandle } from "@/app/document/handle";
import { tableLayouts } from "./logicalGeometry";
import { layoutsOf } from "./viewport";

/**
 * Outils de disposition (override O-57) : aligner, répartir, déplacer la sélection au clavier.
 * Les boîtes sont celles de la vue courante (tables dans le MLD / MPD).
 */

/** Objets sélectionnés qui se disposent (entités, associations, héritages, tables), avec leur boîte. */
export function selectedBoxes(doc: DocumentHandle): Box[] {
  const model = doc.store.getState().doc;
  const { view, selection } = doc.view.getState();
  const wanted = new Set(selection);
  if (view === "mcd") {
    return [...layoutsOf(model)]
      .filter(([id]) => wanted.has(id))
      .map(([id, r]) => ({ id, x: r.x, y: r.y, width: r.width, height: r.height }));
  }
  return tableLayouts(logicalModelOf(model), model, view)
    .filter((t) => wanted.has(t.sourceId))
    .map((t) => ({ id: t.sourceId, x: t.x, y: t.y, width: t.width, height: t.height }));
}

export const alignSelection = (doc: DocumentHandle, alignment: Alignment) =>
  offsetNodes(doc, alignBoxes(selectedBoxes(doc), alignment), "history.align");

export const distributeSelection = (doc: DocumentHandle, axis: DistributeAxis) =>
  offsetNodes(doc, distributeBoxes(selectedBoxes(doc), axis), "history.distribute");

/** Déplacement au clavier en cours : une transaction par document, validée au relâchement. */
const nudges = new Map<string, { origins: Map<Id, Point>; bends: Map<Id, Point[]>; offset: Point }>();

/** Décale la sélection de (dx, dy) ; les appuis successifs s'ajoutent jusqu'à `endNudge`. */
export function nudgeSelection(doc: DocumentHandle, dx: number, dy: number) {
  const store = doc.store.getState();
  let nudge = nudges.get(doc.id);
  if (!nudge) {
    if (store.transactionStart) {
      return; // un glisser est en cours
    }
    const ids = new Set(selectedBoxes(doc).map((b) => b.id));
    if (!ids.size) {
      return;
    }
    const model = store.doc;
    const origins = new Map([...ids].map((id) => [id, positionOf(model.layout, id)]));
    // Les cassures d'un trait suivent quand ses deux extrémités bougent ensemble.
    const bends = new Map<Id, Point[]>();
    for (const l of diagramLinks(model)) {
      if (ids.has(linkSourceId(l)) && ids.has(l.entityId)) {
        bends.set(l.id, bendsOf(model.layout, l.id));
      }
    }
    nudge = { origins, bends, offset: { x: 0, y: 0 } };
    nudges.set(doc.id, nudge);
    store.begin();
  }
  nudge.offset = { x: nudge.offset.x + dx, y: nudge.offset.y + dy };
  const { origins, bends, offset } = nudge;
  store.preview((d) => {
    for (const [id, p] of origins) {
      d.layout.positions[id] = { x: p.x + offset.x, y: p.y + offset.y };
    }
    for (const [id, points] of bends) {
      setBends(
        d.layout,
        id,
        points.map((b) => ({ x: b.x + offset.x, y: b.y + offset.y })),
      );
    }
  });
}

/** Fin du déplacement au clavier : une seule entrée d'historique. */
export function endNudge(doc: DocumentHandle) {
  if (!nudges.delete(doc.id)) {
    return;
  }
  doc.store.getState().commit("history.moveSelection");
}
