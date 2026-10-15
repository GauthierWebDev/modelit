import type { Point } from "@core/index";
import { useEffect, useState } from "react";
import { CURSOR_IDLE, reportPresence, useCollabStore } from "@/app/collab/session";
import { useSpeakingStore } from "@/app/collab/voice/speaking";
import { useDocumentView } from "@/app/document/DocumentContext";
import type { Viewport } from "@/app/document/documentView";
import type { DocumentHandle } from "@/app/document/handle";

/** Vrai si `doc` est l'onglet de la session en cours (partagé ou rejoint). */
export const useIsSessionTab = (doc: DocumentHandle) =>
  useCollabStore((s) => s.tabId === doc.id && (s.mode === "host" || s.mode === "guest"));

/**
 * Envoie ma présence pendant une session (O-05 §5) : vue et sélection à chaque changement ; le
 * curseur est transmis par `reportCursor`, appelé par la surface du canevas.
 */
export function usePresenceReporting(doc: DocumentHandle, active: boolean) {
  useEffect(() => {
    if (!active) return;
    const send = () => {
      const { view, selection } = doc.view.getState();
      reportPresence({ view, selection, cursor: cursor.get(doc.id) ?? null });
    };
    send();
    return doc.view.subscribe((s, p) => {
      if (s.view !== p.view || s.selection !== p.selection) send();
    });
  }, [doc, active]);
}

/** Dernière position connue de mon curseur, par document. */
const cursor = new Map<string, Point | null>();

export function reportCursor(doc: DocumentHandle, point: Point | null) {
  cursor.set(doc.id, point);
  const { view, selection } = doc.view.getState();
  reportPresence({ view, selection, cursor: point });
}

/**
 * Curseurs des autres participants sur la même vue (O-05 §5) : flèche à leur couleur, étiquette avec
 * leur nom. Positions reçues en coordonnées du modèle, dessinées en coordonnées d'écran (taille
 * constante quel que soit le zoom) ; mouvement adouci par une courte transition.
 */
export function RemoteCursors({ viewport }: { viewport: Viewport }) {
  const { presence, participants, you } = useCollabStore();
  const view = useDocumentView((s) => s.view);
  const speaking = useSpeakingStore((s) => s.ids);
  // Rafraîchissement régulier : un curseur immobile depuis 30 s disparaît.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 5_000);
    return () => clearInterval(timer);
  }, []);

  return (
    <g pointerEvents="none" data-remote-cursors="">
      {participants.map((p) => {
        const state = presence[p.id];
        if (
          p.id === you ||
          !state?.cursor ||
          state.view !== view ||
          Math.max(now, Date.now()) - state.movedAt > CURSOR_IDLE
        )
          return null;
        const x = state.cursor.x * viewport.zoom + viewport.x;
        const y = state.cursor.y * viewport.zoom + viewport.y;
        return (
          <g
            key={p.id}
            data-cursor={p.id}
            style={{ transform: `translate(${x}px, ${y}px)`, transition: "transform 80ms linear" }}
          >
            <path
              d="M0,0 L0,16 L4.5,12 L7.5,19 L10,18 L7,11 L12.5,11 Z"
              fill={p.color}
              stroke="white"
              strokeWidth={1.2}
              strokeLinejoin="round"
            />
            <g transform="translate(12 18)">
              {/* Qui parle (O-48) : halo autour de l'étiquette. */}
              {speaking.includes(p.id) && (
                <rect
                  x={-3}
                  y={-3}
                  rx={6}
                  height={24}
                  width={p.name.length * 6.6 + 18}
                  fill="none"
                  stroke={p.color}
                  strokeOpacity={0.5}
                  strokeWidth={3}
                />
              )}
              <rect rx={4} height={18} width={p.name.length * 6.6 + 12} fill={p.color} />
              <text
                x={6}
                y={13}
                fontSize={11}
                fontWeight={600}
                fill="white"
                style={{ fontFamily: "system-ui, sans-serif" }}
              >
                {p.name}
              </text>
            </g>
          </g>
        );
      })}
    </g>
  );
}
