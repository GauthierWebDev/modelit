import type { Id, Rect } from "@core/index";
import { useMemo } from "react";
import { useDocument, useDocumentView } from "@/app/document/DocumentContext";
import type { Viewport } from "@/app/document/documentView";
import { findMatches } from "@/app/searchCommands";

/** Écart entre la boîte et le liseré, en pixels d'écran. */
const GAP = 5;

/**
 * Résultats de la recherche (override O-64) : liseré autour de chaque objet trouvé, plus marqué pour le courant ;
 * en coordonnées d'écran (épaisseur constante quel que soit le zoom), hors de l'export d'image.
 */
export function SearchHighlights({ viewport, boxes }: { viewport: Viewport; boxes: Map<Id, Rect> }) {
  const doc = useDocument((s) => s.doc);
  const view = useDocumentView((s) => s.view);
  const search = useDocumentView((s) => s.search);
  const matches = useMemo(
    () => (search.open ? findMatches(doc, view, search.query) : []),
    [doc, view, search.open, search.query],
  );
  const current = matches[Math.min(search.index, matches.length - 1)];
  return (
    <g pointerEvents="none" data-search-highlights="">
      {matches.map((id) => {
        const box = boxes.get(id);
        if (!box) {
          return null;
        }
        const active = id === current;
        return (
          <rect
            key={id}
            x={box.x * viewport.zoom + viewport.x - GAP}
            y={box.y * viewport.zoom + viewport.y - GAP}
            width={box.width * viewport.zoom + 2 * GAP}
            height={box.height * viewport.zoom + 2 * GAP}
            rx={5}
            fill={active ? "var(--mcd-search-fill)" : "none"}
            stroke="var(--mcd-search)"
            strokeWidth={active ? 3 : 2}
            strokeDasharray={active ? undefined : "6 3"}
          />
        );
      })}
    </g>
  );
}
