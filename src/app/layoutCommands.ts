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
import { moveNodes } from "./commands";
import { diagramSizer } from "./diagramSizer";
import type { DocumentHandle } from "./document/handle";
import { layoutRunner } from "./layoutRunner";

/**
 * « Placement automatique » (overrides O-09, O-30), disposition commune aux trois vues (O-01) :
 * 1. Tous les objets du MCD (entités, associations, héritages) sont placés ensemble sur une grille qui évite
 *    les traits traversant un objet, les croisements et les cardinalités superposées. Chaque cellule a la
 *    taille de l'objet dans sa vue la plus grande (MCD ou MPD) : aucun chevauchement, dans aucune vue.
 * 2. Cassures : réflexives contournées, autres liens déplacés avec leurs extrémités ou redressés.
 * Renvoie faux si rien n'a été placé (schéma vide, placement déjà en cours sur ce document, ou objets changés
 * pendant le calcul). Le cadrage de la vue reste à l'interface (audit A-01, U-2).
 */
export async function autoLayout(handle: DocumentHandle): Promise<boolean> {
  const view = handle.view.getState();
  // Un seul placement à la fois par document : les clics répétés ne s'empilent pas dans la file des calculs.
  if (view.layoutRunning || diagramNodes(handle.store.getState().doc).length === 0) {
    return false;
  }
  view.setLayoutRunning(true);
  try {
    return await placeNodes(handle);
  } finally {
    handle.view.getState().setLayoutRunning(false);
  }
}

async function placeNodes(handle: DocumentHandle): Promise<boolean> {
  let { doc } = handle.store.getState();
  const placed = await layoutRunner().run(
    gridNodes(doc),
    diagramLinks(doc).map((l) => ({ a: linkSourceId(l), b: l.entityId })),
  );
  // Repartir du document courant ; s'il a changé d'objets pendant le calcul, résultat abandonné.
  ({ doc } = handle.store.getState());
  const nodes = diagramNodes(doc);
  if (nodes.length !== placed.size || nodes.some((n) => !placed.has(n.id))) {
    return false;
  }
  // Alignement sur la grille sans risque de chevauchement (décalage ≤ demi-pas, très inférieur aux écarts).
  const grid = doc.settings.grid.enabled && doc.settings.grid.size <= 20 ? doc.settings.grid.size : null;
  const snap = (p: Point) => (grid ? { x: Math.round(p.x / grid) * grid, y: Math.round(p.y / grid) * grid } : p);
  const positions = new Map<Id, Point>([...placed].map(([id, p]) => [id, snap(p)]));
  const mcd = diagramSizer().mcdBoxes(doc);
  const mcdRect = (id: Id): Rect => ({ ...positions.get(id)!, width: mcd.get(id)!.width, height: mcd.get(id)!.height });
  moveNodes(handle, positions, autoLayoutBends(doc, positions, mcdRect, grid));
  return true;
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
