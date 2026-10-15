import { diagramNodes, positionOf, type ModelDocument, type Point } from "@core/index";
import { logicalModelOf } from "@/app/derived";
import type { ViewMode } from "@/app/document/documentView";
import type { DocumentHandle } from "@/app/document/handle";
import { associationNamesByLink, nodeLayout, type NodeLayout, type Rect } from "./geometry";
import { tableLayouts } from "./logicalGeometry";

/**
 * Opérations de zoom et de cadrage, partagées par la barre d'outils, les raccourcis et le canevas.
 * Elles agissent sur le cadrage du document reçu.
 */

let observedSize = { width: 800, height: 600 };
let canvasElement: Element | null = null;
export const setCanvasSize = (size: { width: number; height: number }) => (observedSize = size);
/** Élément du canevas affiché, mesuré directement au moment de zoomer ou de cadrer. */
export const setCanvasElement = (element: Element | null) => (canvasElement = element);

/**
 * Taille réelle du canevas. La valeur relevée par ResizeObserver peut manquer (moteur qui ne la
 * signale pas pour un <svg>, ou pas encore) : on mesure l'élément, la valeur observée en dernier recours.
 */
function canvasSizeNow() {
  const rect = canvasElement?.isConnected ? canvasElement.getBoundingClientRect() : null;
  return rect && rect.width > 0 && rect.height > 0 ? { width: rect.width, height: rect.height } : observedSize;
}

export function layoutsOf(doc: ModelDocument): Map<string, NodeLayout> {
  const display = doc.settings.display;
  const linkNames = associationNamesByLink(doc);
  return new Map(diagramNodes(doc).map((n) => [n.id, nodeLayout(n, positionOf(doc.layout, n.id), display, linkNames)]));
}

/** Zoome en gardant fixe le point écran `anchor` (par défaut le centre du canevas). */
export function zoomTo(
  doc: DocumentHandle,
  zoom: number,
  anchor: Point = { x: canvasSizeNow().width / 2, y: canvasSizeNow().height / 2 },
) {
  const { viewport, setViewport } = doc.view.getState();
  const modelX = (anchor.x - viewport.x) / viewport.zoom;
  const modelY = (anchor.y - viewport.y) / viewport.zoom;
  setViewport({ zoom, x: anchor.x - modelX * zoom, y: anchor.y - modelY * zoom });
  // Le zoom peut avoir été borné : recaler sur la valeur effective.
  const effective = doc.view.getState().viewport.zoom;
  if (effective !== zoom) setViewport({ zoom: effective, x: anchor.x - modelX * effective, y: anchor.y - modelY * effective });
}

export const zoomBy = (doc: DocumentHandle, factor: number, anchor?: Point) =>
  zoomTo(doc, doc.view.getState().viewport.zoom * factor, anchor);

/** Emprise de la vue : objets, et en MCD les cassures des liens (boucles des réflexives, qui débordent). */
function rectsOf(doc: ModelDocument, view: ViewMode): Rect[] {
  if (view !== "mcd") return tableLayouts(logicalModelOf(doc), doc, view);
  const bends = Object.values(doc.layout.bends).flatMap((points) => points.map((b) => ({ x: b.x, y: b.y, width: 0, height: 0 })));
  return [...layoutsOf(doc).values(), ...bends];
}

/** « Ajuster à la fenêtre » : cadre tout le modèle, dans la vue courante. */
export function fitToWindow(doc: DocumentHandle, maxZoom?: number) {
  fitToRects(doc, rectsOf(doc.store.getState().doc, doc.view.getState().view), maxZoom);
}

/** Cadre les rectangles donnés, sans dépasser le zoom `maxZoom`. */
export function fitToRects(doc: DocumentHandle, layouts: Rect[], maxZoom = 1.5) {
  const { setViewport } = doc.view.getState();
  if (layouts.length === 0) return setViewport({ x: 40, y: 40, zoom: 1 });
  const canvasSize = canvasSizeNow();
  const minX = Math.min(...layouts.map((l) => l.x));
  const minY = Math.min(...layouts.map((l) => l.y));
  const maxX = Math.max(...layouts.map((l) => l.x + l.width));
  const maxY = Math.max(...layouts.map((l) => l.y + l.height));
  const margin = 40;
  const zoom = Math.min(
    (canvasSize.width - 2 * margin) / Math.max(1, maxX - minX),
    (canvasSize.height - 2 * margin) / Math.max(1, maxY - minY),
    maxZoom,
  );
  setViewport({
    zoom,
    x: (canvasSize.width - (maxX - minX) * zoom) / 2 - minX * zoom,
    y: (canvasSize.height - (maxY - minY) * zoom) / 2 - minY * zoom,
  });
}
