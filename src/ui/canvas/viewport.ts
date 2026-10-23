import { diagramNodes, type ModelDocument, type Point, positionOf } from "@core/index";
import type { CanvasMetrics } from "@/app/canvasMetrics";
import { logicalModelOf } from "@/app/derived";
import type { ViewMode } from "@/app/document/documentView";
import type { DocumentHandle } from "@/app/document/handle";
import { associationNamesByLink, type NodeLayout, nodeLayout, type Rect } from "./geometry";
import { tableLayouts } from "./logicalGeometry";

/**
 * Opérations de zoom et de cadrage, partagées par la barre d'outils, les raccourcis et le canevas.
 * Elles agissent sur le cadrage du document reçu.
 */

let observedSize = { width: 800, height: 600 };
let canvasElement: Element | null = null;
export const setCanvasSize = (size: { width: number; height: number }) => {
  observedSize = size;
};
/** Élément du canevas affiché, mesuré directement au moment de zoomer ou de cadrer. */
export const setCanvasElement = (element: Element | null) => {
  canvasElement = element;
};

/**
 * Taille réelle du canevas. La valeur relevée par ResizeObserver peut manquer (moteur qui ne la
 * signale pas pour un <svg>, ou pas encore) : on mesure l'élément, la valeur observée en dernier recours.
 */
function canvasSizeNow() {
  const rect = canvasElement?.isConnected ? canvasElement.getBoundingClientRect() : null;
  return rect && rect.width > 0 && rect.height > 0 ? { width: rect.width, height: rect.height } : observedSize;
}

export function layoutsOf(doc: ModelDocument): Map<string, NodeLayout> {
  const { display } = doc.settings;
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
  if (effective !== zoom) {
    setViewport({ zoom: effective, x: anchor.x - modelX * effective, y: anchor.y - modelY * effective });
  }
}

export const zoomBy = (doc: DocumentHandle, factor: number, anchor?: Point) =>
  zoomTo(doc, doc.view.getState().viewport.zoom * factor, anchor);

/** Emprise de la vue : objets, et en MCD les cassures des liens (boucles des réflexives, qui débordent). */
function rectsOf(doc: ModelDocument, view: ViewMode): Rect[] {
  if (view !== "mcd") {
    return tableLayouts(logicalModelOf(doc), doc, view);
  }
  const bends = Object.values(doc.layout.bends).flatMap((points) =>
    points.map((b) => ({ x: b.x, y: b.y, width: 0, height: 0 })),
  );
  return [...layoutsOf(doc).values(), ...bends];
}

/** « Ajuster à la fenêtre » : cadre tout le modèle, dans la vue courante. */
export function fitToWindow(doc: DocumentHandle, maxZoom?: number) {
  fitToRects(doc, rectsOf(doc.store.getState().doc, doc.view.getState().view), maxZoom);
}

/** Cadre les rectangles donnés, sans dépasser le zoom `maxZoom`. */
export function fitToRects(doc: DocumentHandle, layouts: Rect[], maxZoom = 1.5) {
  const { setViewport } = doc.view.getState();
  if (layouts.length === 0) {
    return setViewport({ x: 40, y: 40, zoom: 1 });
  }
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

/** Rectangles (coordonnées du modèle) des objets `ids` dans la vue courante : objets du MCD ou tables. */
export function objectRects(doc: DocumentHandle, ids: string[]): Rect[] {
  const model = doc.store.getState().doc;
  const { view } = doc.view.getState();
  const wanted = new Set(ids);
  return view === "mcd"
    ? [...layoutsOf(model).entries()].filter(([id]) => wanted.has(id)).map(([, r]) => r)
    : tableLayouts(logicalModelOf(model), model, view).filter((t) => wanted.has(t.sourceId));
}

/** Point du modèle sous un point de l'écran (`clientX`, `clientY`). */
export function clientToModel(doc: DocumentHandle, client: Point): Point {
  const rect = canvasElement?.getBoundingClientRect() ?? { left: 0, top: 0 };
  const { viewport } = doc.view.getState();
  return {
    x: (client.x - rect.left - viewport.x) / viewport.zoom,
    y: (client.y - rect.top - viewport.y) / viewport.zoom,
  };
}

/**
 * Fait défiler la vue (sans changer le zoom) pour montrer les objets `ids` s'ils sont hors
 * champ : leur emprise est centrée. Ex. objets collés (O-52).
 */
export function revealObjects(doc: DocumentHandle, ids: string[]) {
  const { viewport, setViewport } = doc.view.getState();
  const rects = objectRects(doc, ids);
  if (rects.length === 0) {
    return;
  }
  const size = canvasSizeNow();
  const minX = Math.min(...rects.map((r) => r.x));
  const minY = Math.min(...rects.map((r) => r.y));
  const maxX = Math.max(...rects.map((r) => r.x + r.width));
  const maxY = Math.max(...rects.map((r) => r.y + r.height));
  const z = viewport.zoom;
  const visible =
    minX * z + viewport.x >= 0 &&
    minY * z + viewport.y >= 0 &&
    maxX * z + viewport.x <= size.width &&
    maxY * z + viewport.y <= size.height;
  if (visible) {
    return;
  }
  setViewport({ zoom: z, x: size.width / 2 - ((minX + maxX) / 2) * z, y: size.height / 2 - ((minY + maxY) / 2) * z });
}

/** Adaptateur du port `CanvasMetrics` (`app/canvasMetrics.ts`) : taille réelle du canevas affiché. */
export const canvasMetricsAdapter: CanvasMetrics = { canvasSize: canvasSizeNow };
