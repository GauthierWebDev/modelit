import {
  autoLayoutBends,
  diagramLinks,
  diagramNodes,
  type GridNode,
  type Id,
  linkSourceId,
  type ModelDocument,
  type Point,
  type Rect,
} from "@core/index";
import { t } from "@/i18n";
import { moveNodes } from "./commands";
import { diagramSizer } from "./diagramSizer";
import type { DocumentHandle } from "./document/handle";
import { layoutRunner } from "./layoutRunner";
import { useUiStore } from "./uiStore";

/**
 * « Placement automatique » (overrides O-09, O-30), disposition commune aux trois vues (O-01) :
 * 1. Tous les objets du MCD (entités, associations, héritages) sont placés ensemble sur une grille qui évite
 *    les traits traversant un objet, les croisements et les cardinalités superposées. Chaque cellule a la
 *    taille de l'objet dans sa vue la plus grande (MCD ou MPD) : aucun chevauchement, dans aucune vue.
 * 2. Cassures : réflexives contournées, autres liens déplacés avec leurs extrémités ou redressés.
 * Le cadrage de la vue reste à l'interface (audit A-01, U-2).
 *
 * Un seul placement à la fois par document, annulable (override O-62) : `skipped` si rien n'a été placé
 * (schéma vide, placement déjà en cours, objets changés pendant le calcul), `cancelled` si annulé
 * (`cancelAutoLayout`), `failed` si le calcul a échoué (signalé dans la barre d'état). Seul `placed` modifie
 * le document.
 */
export type AutoLayoutOutcome = "placed" | "skipped" | "cancelled" | "failed";

/** Placements en cours, par document : de quoi les annuler. */
const running = new WeakMap<DocumentHandle, AbortController>();

export async function autoLayout(handle: DocumentHandle): Promise<AutoLayoutOutcome> {
  if (running.has(handle) || diagramNodes(handle.store.getState().doc).length === 0) {
    return "skipped";
  }
  const controller = new AbortController();
  running.set(handle, controller);
  handle.view.getState().setLayoutRunning(true);
  try {
    return await placeNodes(handle, controller.signal);
  } catch (e: unknown) {
    if (controller.signal.aborted) {
      return "cancelled";
    }
    useUiStore.getState().notify({ kind: "error", text: t("layout.failed", { error: String(e) }) });
    return "failed";
  } finally {
    running.delete(handle);
    handle.view.getState().setLayoutRunning(false);
  }
}

/** Annule le placement en cours sur ce document (second clic sur le bouton, menu contextuel) ; sinon rien. */
export function cancelAutoLayout(handle: DocumentHandle) {
  running.get(handle)?.abort();
}

async function placeNodes(handle: DocumentHandle, signal: AbortSignal): Promise<AutoLayoutOutcome> {
  let { doc } = handle.store.getState();
  const placed = await layoutRunner().run(
    gridNodes(doc),
    diagramLinks(doc).map((l) => ({ a: linkSourceId(l), b: l.entityId })),
    signal,
  );
  // Un calcul qui répond malgré l'annulation ne modifie rien.
  if (signal.aborted) {
    return "cancelled";
  }
  // Repartir du document courant ; s'il a changé d'objets pendant le calcul, résultat abandonné.
  ({ doc } = handle.store.getState());
  const nodes = diagramNodes(doc);
  if (nodes.length !== placed.size || nodes.some((n) => !placed.has(n.id))) {
    return "skipped";
  }
  // Alignement sur la grille sans risque de chevauchement (décalage ≤ demi-pas, très inférieur aux écarts).
  const grid = doc.settings.grid.enabled && doc.settings.grid.size <= 20 ? doc.settings.grid.size : null;
  const snap = (p: Point) => (grid ? { x: Math.round(p.x / grid) * grid, y: Math.round(p.y / grid) * grid } : p);
  const positions = new Map<Id, Point>([...placed].map(([id, p]) => [id, snap(p)]));
  const mcd = diagramSizer().mcdBoxes(doc);
  const mcdRect = (id: Id): Rect => ({ ...positions.get(id)!, width: mcd.get(id)!.width, height: mcd.get(id)!.height });
  moveNodes(handle, positions, autoLayoutBends(doc, positions, mcdRect, grid));
  return "placed";
}

/** Boîtes à placer : la plus grande des boîtes MCD et MPD de chaque objet (O-60), et sa boîte MCD. */
function gridNodes(doc: ModelDocument): GridNode[] {
  const sizer = diagramSizer();
  const mcd = sizer.mcdBoxes(doc);
  const largest = sizer.placementBoxes(doc);
  return diagramNodes(doc).map((node) => ({
    id: node.id,
    width: largest.get(node.id)!.width,
    height: largest.get(node.id)!.height,
    mcdWidth: mcd.get(node.id)!.width,
    mcdHeight: mcd.get(node.id)!.height,
  }));
}
