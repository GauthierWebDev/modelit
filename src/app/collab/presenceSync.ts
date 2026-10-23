import type { Point } from "@core/index";
import { canvasMetrics } from "../canvasMetrics";
import type { Viewport } from "../document/documentView";
import type { DocumentHandle } from "../document/handle";
import type { Presence } from "./protocol";
import { reportPresence } from "./sessionPresence";
import { useCollabStore } from "./sessionState";

/**
 * Ma présence pendant une session (O-05 §5) : vue, sélection, cadrage, curseur et participant suivi, envoyés
 * aux autres à chaque changement (au plus 20 fois par seconde, `reportPresence`). Démarré par l'interface pour
 * l'onglet de la session ; le curseur lui est transmis par `reportCursor` (audit A-01, A-8 / U-7).
 */

/** Dernière position connue de mon curseur, par document. */
const cursors = new Map<string, Point | null>();

const tenth = (value: number) => Math.round(value * 10) / 10;

/** Cadrage → centre du canevas en coordonnées du modèle, et zoom. */
export function viewportCenter(viewport: Viewport): NonNullable<Presence["viewport"]> {
  const { width, height } = canvasMetrics().canvasSize();
  return {
    center: { x: tenth((width / 2 - viewport.x) / viewport.zoom), y: tenth((height / 2 - viewport.y) / viewport.zoom) },
    zoom: viewport.zoom,
  };
}

function presenceOf(doc: DocumentHandle): Presence {
  const { view, selection, viewport } = doc.view.getState();
  return {
    view,
    selection,
    cursor: cursors.get(doc.id) ?? null,
    viewport: viewportCenter(viewport),
    following: useCollabStore.getState().following,
  };
}

/** Envoie ma présence pour `doc`, puis à chaque changement ; renvoie l'arrêt. */
export function startPresenceSync(doc: DocumentHandle): () => void {
  const send = () => reportPresence(presenceOf(doc));
  send();
  const offView = doc.view.subscribe((s, p) => {
    if (s.view !== p.view || s.selection !== p.selection || s.viewport !== p.viewport) {
      send();
    }
  });
  const offFollowing = useCollabStore.subscribe((s, p) => {
    if (s.following !== p.following) {
      send();
    }
  });
  return () => {
    offView();
    offFollowing();
  };
}

/** Mon curseur sur le canevas de `doc`, en coordonnées du modèle (`null` : hors du canevas). */
export function reportCursor(doc: DocumentHandle, point: Point | null) {
  cursors.set(doc.id, point);
  reportPresence(presenceOf(doc));
}
