import { type Alignment, alignBoxes, type Box, type DistributeAxis, distributeBoxes, type Point } from "@core/index";
import { offsetNodes } from "@/app/commands";
import { logicalModelOf } from "@/app/derived";
import type { DocumentHandle } from "@/app/document/handle";
import { beginMove, type MoveSession } from "@/app/moveCommands";
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
const nudges = new Map<string, { move: MoveSession; offset: Point }>();

/** Décale la sélection de (dx, dy) ; les appuis successifs s'ajoutent jusqu'à `endNudge`. */
export function nudgeSelection(doc: DocumentHandle, dx: number, dy: number) {
  const store = doc.store.getState();
  let nudge = nudges.get(doc.id);
  if (!nudge) {
    if (store.transactionStart) {
      return; // un glisser est en cours
    }
    // Sans alignement : le pas du clavier (celui de la grille, ou 1 ; ×10 avec Maj) est appliqué tel quel.
    const move = beginMove(
      doc,
      selectedBoxes(doc).map((b) => b.id),
      null,
    );
    if (!move) {
      return;
    }
    nudge = { move, offset: { x: 0, y: 0 } };
    nudges.set(doc.id, nudge);
  }
  nudge.offset = { x: nudge.offset.x + dx, y: nudge.offset.y + dy };
  nudge.move.update(nudge.offset);
}

/** Fin du déplacement au clavier : une seule entrée d'historique. */
export function endNudge(doc: DocumentHandle) {
  const nudge = nudges.get(doc.id);
  if (!nudge) {
    return;
  }
  nudges.delete(doc.id);
  nudge.move.commit("history.moveSelection");
}
