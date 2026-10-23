import type { Id, Rect } from "@core/index";
import { useCollabStore } from "@/app/collab/session";
import { useDocumentView } from "@/app/document/DocumentContext";
import type { Viewport } from "@/app/document/documentView";
import { REMOTE_SELECTION_GAP, remoteSelectionRects } from "./remoteSelectionRects";

/**
 * Sélection des autres participants (O-05 §5) : liseré à leur couleur autour des boîtes, en coordonnées d'écran
 * (épaisseur et écart constants quel que soit le zoom), hors de l'export d'image.
 */
export function RemoteSelections({ viewport, boxes }: { viewport: Viewport; boxes: Map<Id, Rect> }) {
  const presence = useCollabStore((s) => s.presence);
  const participants = useCollabStore((s) => s.participants);
  const you = useCollabStore((s) => s.you);
  const view = useDocumentView((s) => s.view);
  const gap = REMOTE_SELECTION_GAP;
  return (
    <g pointerEvents="none">
      {remoteSelectionRects({ presence, participants, you }, view, boxes).map(({ key, color, rect }) => (
        <rect
          key={key}
          data-remote-selection={key}
          x={rect.x * viewport.zoom + viewport.x - gap}
          y={rect.y * viewport.zoom + viewport.y - gap}
          width={rect.width * viewport.zoom + 2 * gap}
          height={rect.height * viewport.zoom + 2 * gap}
          rx={4}
          fill="none"
          stroke={color}
          strokeWidth={2}
        />
      ))}
    </g>
  );
}
