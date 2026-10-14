import { diagramLinks, diagramNodes, type ModelDocument, type Point } from "@core/index";
import { logicalModelOf } from "@/app/derived";
import { useUiStore, type ViewMode } from "@/app/uiStore";
import { associationNamesByLink, nodeLayout, type NodeLayout, type Rect } from "./geometry";
import { tableLayouts } from "./logicalGeometry";

/** Opérations de zoom et de cadrage, partagées par la barre d'outils, les raccourcis et le canevas. */

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
  return new Map(diagramNodes(doc).map((n) => [n.id, nodeLayout(n, display, linkNames)]));
}

/** Zoome en gardant fixe le point écran `anchor` (par défaut le centre du canevas). */
export function zoomTo(zoom: number, anchor: Point = { x: canvasSizeNow().width / 2, y: canvasSizeNow().height / 2 }) {
  const { viewport, setViewport } = useUiStore.getState();
  const modelX = (anchor.x - viewport.x) / viewport.zoom;
  const modelY = (anchor.y - viewport.y) / viewport.zoom;
  setViewport({ zoom, x: anchor.x - modelX * zoom, y: anchor.y - modelY * zoom });
  // Le zoom peut avoir été borné : recaler sur la valeur effective.
  const effective = useUiStore.getState().viewport.zoom;
  if (effective !== zoom) setViewport({ zoom: effective, x: anchor.x - modelX * effective, y: anchor.y - modelY * effective });
}

export const zoomBy = (factor: number, anchor?: Point) => zoomTo(useUiStore.getState().viewport.zoom * factor, anchor);

/** Emprise de la vue : objets, et en MCD les cassures des liens (boucles des réflexives, qui débordent). */
function rectsOf(doc: ModelDocument, view: ViewMode): Rect[] {
  if (view !== "mcd") return tableLayouts(logicalModelOf(doc), doc, view);
  const bends = diagramLinks(doc).flatMap((l) => l.bends.map((b) => ({ x: b.x, y: b.y, width: 0, height: 0 })));
  return [...layoutsOf(doc).values(), ...bends];
}

/** « Ajuster à la fenêtre » : cadre tout le modèle, dans la vue courante. */
export function fitToWindow(doc: ModelDocument, maxZoom?: number) {
  fitToRects(rectsOf(doc, useUiStore.getState().view), maxZoom);
}

/** Cadre les rectangles donnés, sans dépasser le zoom `maxZoom`. */
export function fitToRects(layouts: Rect[], maxZoom = 1.5) {
  const { setViewport } = useUiStore.getState();
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
