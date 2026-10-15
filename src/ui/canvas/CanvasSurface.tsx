import type { Point } from "@core/index";
import { useEffect, useRef, type MouseEvent, type PointerEvent, type ReactNode } from "react";
import { useDocumentHandle, useDocumentView } from "@/app/document/DocumentContext";
import type { Viewport } from "@/app/document/documentView";
import { RemoteCursors, reportCursor, useIsSessionTab, usePresenceReporting } from "@/ui/collab/RemoteCursors";
import { setCanvasElement, setCanvasSize, zoomBy } from "./viewport";

/**
 * Surface SVG commune aux vues MCD, MLD et MPD : grille, zoom et défilement.
 *  - molette / pavé tactile : défilement ; Ctrl/⌘ + molette ou pincement : zoom ;
 *  - bouton du milieu, ou clic gauche dans le vide si `panOnEmpty` : glisser la vue.
 *
 * Les gestionnaires reçoivent le point en coordonnées du modèle. `onPointerDown`
 * renvoie `true` s'il a pris en charge l'événement (sinon, déplacement de la vue).
 */
export interface SurfaceHandlers {
  onPointerDown?: (e: PointerEvent<SVGSVGElement>, point: Point) => boolean;
  onPointerMove?: (e: PointerEvent<SVGSVGElement>, point: Point) => void;
  onPointerUp?: (e: PointerEvent<SVGSVGElement>, point: Point) => void;
  onPointerCancel?: () => void;
  onContextMenu?: (e: MouseEvent<SVGSVGElement>) => void;
}

export function CanvasSurface({
  grid,
  panOnEmpty,
  className = "",
  children,
  ...handlers
}: SurfaceHandlers & { grid: number | null; panOnEmpty?: boolean; className?: string; children: ReactNode }) {
  const doc = useDocumentHandle();
  const viewport = useDocumentView((s) => s.viewport);
  const setViewport = useDocumentView((s) => s.setViewport);
  const svgRef = useRef<SVGSVGElement>(null);
  const pan = useRef<{ start: Point; origin: Viewport } | null>(null);
  // Session collaborative : ma présence part aux autres, leurs curseurs sont dessinés (O-05 §5).
  const shared = useIsSessionTab(doc);
  usePresenceReporting(doc, shared);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    setCanvasElement(svg);
    const observer = new ResizeObserver(([entry]) => entry && setCanvasSize(entry.contentRect));
    observer.observe(svg);
    // Écouteur natif non passif : empêche le zoom de la page entière au pincement.
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = svg.getBoundingClientRect();
      if (e.ctrlKey || e.metaKey) {
        zoomBy(doc, Math.exp(-e.deltaY * 0.01), { x: e.clientX - r.left, y: e.clientY - r.top });
      } else {
        const { viewport: v, setViewport: set } = doc.view.getState();
        set({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY });
      }
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      observer.disconnect();
      svg.removeEventListener("wheel", onWheel);
    };
  }, [doc]);

  const screenPoint = (e: { clientX: number; clientY: number }): Point => {
    const r = svgRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const modelPoint = (e: { clientX: number; clientY: number }): Point => {
    const p = screenPoint(e);
    return { x: (p.x - viewport.x) / viewport.zoom, y: (p.y - viewport.y) / viewport.zoom };
  };

  const gridSize = (grid ?? 10) * viewport.zoom;

  return (
    <svg
      ref={svgRef}
      data-canvas=""
      tabIndex={-1}
      className={`h-full w-full touch-none select-none bg-(--mcd-canvas) outline-none ${className}`}
      onPointerDown={(e) => {
        // Le canevas prend le focus : un champ de l'inspecteur resté actif est validé et quitté,
        // sinon il capterait Suppr / Retour arrière (WebKit ne retire pas le focus au clic sur
        // un élément `user-select: none`).
        svgRef.current!.focus({ preventScroll: true });
        svgRef.current!.setPointerCapture(e.pointerId);
        const handled = e.button === 0 && (handlers.onPointerDown?.(e, modelPoint(e)) ?? false);
        if (!handled && (e.button === 1 || (e.button === 0 && panOnEmpty))) {
          pan.current = { start: screenPoint(e), origin: viewport };
        }
      }}
      onPointerMove={(e) => {
        if (shared) reportCursor(doc, modelPoint(e));
        if (pan.current) {
          const p = screenPoint(e);
          const { start, origin } = pan.current;
          setViewport({ ...origin, x: origin.x + p.x - start.x, y: origin.y + p.y - start.y });
          return;
        }
        handlers.onPointerMove?.(e, modelPoint(e));
      }}
      onPointerUp={(e) => {
        if (pan.current) {
          pan.current = null;
          return;
        }
        handlers.onPointerUp?.(e, modelPoint(e));
      }}
      onPointerCancel={() => {
        pan.current = null;
        handlers.onPointerCancel?.();
      }}
      onPointerLeave={() => shared && reportCursor(doc, null)}
      onContextMenu={handlers.onContextMenu}
    >
      <defs>
        <marker id="arrow" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="9" markerHeight="9" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" fill="var(--mcd-link)" />
        </marker>
        <marker id="arrow-selected" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="9" markerHeight="9" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" fill="var(--mcd-selection)" />
        </marker>
        {/* Flèche vers l'entité générique d'un héritage (O-27) */}
        <marker id="arrow-inherit" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" fill="var(--mcd-inherit-stroke)" />
        </marker>
        <marker id="arrow-inherit-selected" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" fill="var(--mcd-selection)" />
        </marker>
      </defs>
      {grid && gridSize >= 6 && (
        <>
          <defs>
            <pattern
              id="grid"
              width={gridSize}
              height={gridSize}
              patternUnits="userSpaceOnUse"
              x={viewport.x % gridSize}
              y={viewport.y % gridSize}
            >
              <circle cx={0.75} cy={0.75} r={0.75} fill="var(--mcd-grid)" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#grid)" />
        </>
      )}
      {/* Racine du dessin, reprise telle quelle par l'export d'image (src/ui/export). */}
      <g data-export-root="" transform={`translate(${viewport.x} ${viewport.y}) scale(${viewport.zoom})`}>
        {children}
      </g>
      {shared && <RemoteCursors viewport={viewport} />}
    </svg>
  );
}

/** Identifiant (`data-id`) de l'objet sous l'événement, s'il y en a un. */
export const hitId = (e: { target: EventTarget | null }) =>
  (e.target as Element | null)?.closest<SVGElement>("[data-id]")?.dataset.id ?? null;

/** Identifiant de l'objet sous un point écran (utile quand le pointeur est capturé). */
export const hitIdAt = (e: { clientX: number; clientY: number }) =>
  document.elementFromPoint(e.clientX, e.clientY)?.closest<SVGElement>("[data-id]")?.dataset.id ?? null;
