import { t } from "@/i18n";
import { canvasMetrics } from "../canvasMetrics";
import type { DocumentHandle } from "../document/handle";
import { useUiStore } from "../uiStore";
import { showView } from "../viewCommands";
import { useWorkspaceStore } from "../workspace";
import type { Presence } from "./protocol";
import { type CollabState, useCollabStore } from "./sessionState";

/**
 * « Suivre » un participant (O-05 §5) : ma vue et mon cadrage (même centre, même zoom) suivent les siens.
 * Le suivi s'arrête quand je déplace ou zoome la vue, change de vue, modifie le modèle, appuie sur Échap, ou
 * quand le participant part ou que la session se termine. Fenêtre principale ; démarré par `src/bootstrap.ts`.
 */

/** Vrai pendant que le suivi applique la vue et le cadrage : ces changements ne l'arrêtent pas. */
let applying = false;

const sessionDoc = (): DocumentHandle | undefined => {
  const { tabId } = useCollabStore.getState();
  return useWorkspaceStore.getState().documents.find((d) => d.id === tabId);
};

const finite = (...values: number[]) => values.every((v) => Number.isFinite(v));

/** Suit `peer`, ou arrête de suivre (`null`). */
export function follow(peer: string | null) {
  useCollabStore.setState({ following: peer });
  applyFollowed();
}

export const unfollow = () => follow(null);

/** Applique la vue et le cadrage du participant suivi (valeurs reçues vérifiées). */
function applyFollowed() {
  const { following, presence } = useCollabStore.getState();
  const leader = following ? presence[following] : undefined;
  const doc = sessionDoc();
  if (!(leader && doc)) {
    return;
  }
  applying = true;
  try {
    if (doc.view.getState().view !== leader.view) {
      showView(doc, leader.view);
    }
    const target = leader.viewport;
    if (target && finite(target.center.x, target.center.y, target.zoom) && target.zoom > 0) {
      const { width, height } = canvasMetrics().canvasSize();
      doc.view.getState().setViewport({
        x: width / 2 - target.center.x * target.zoom,
        y: height / 2 - target.center.y * target.zoom,
        zoom: target.zoom,
      });
    }
  } finally {
    applying = false;
  }
}

/** Le participant suivi a-t-il changé de vue ou de cadrage ? (Son curseur seul ne compte pas.) */
const leaderMoved = (a: Presence | undefined, b: Presence | undefined) =>
  a?.view !== b?.view || JSON.stringify(a?.viewport) !== JSON.stringify(b?.viewport);

/** Arrêts venant de moi : navigation, changement de vue, modification du modèle (annuler et glisser compris). */
function watchMe(doc: DocumentHandle): () => void {
  const offView = doc.view.subscribe((s, p) => {
    if (!applying && (s.view !== p.view || s.viewport !== p.viewport)) {
      unfollow();
    }
  });
  const offStore = doc.store.subscribe((s, p) => {
    const edited = s.past.length > 0 && s.past.at(-1) !== p.past.at(-1);
    const undone = s.future.length > p.future.length;
    const dragged = s.transactionStart !== null && p.transactionStart === null;
    if (edited || undone || dragged) {
      unfollow();
    }
  });
  return () => {
    offView();
    offStore();
  };
}

/** Session terminée, ou participant suivi parti (annoncé) : le suivi s'arrête. Vrai s'il s'est arrêté. */
function stopIfLeaderGone(s: CollabState, p: CollabState): boolean {
  const active = s.mode === "host" || s.mode === "guest";
  if (!s.following || (active && s.participants.some((x) => x.id === s.following))) {
    return false;
  }
  if (active) {
    const name = p.participants.find((x) => x.id === s.following)?.name ?? "";
    useUiStore.getState().notify({ kind: "info", text: t("collab.followEnded", { name }) });
  }
  useCollabStore.setState({ following: null });
  return true;
}

/** Suit le participant choisi tant qu'il le faut ; renvoie l'arrêt. */
export function startFollowSync(): () => void {
  let offMe: (() => void) | null = null;
  const offCollab = useCollabStore.subscribe((s, p) => {
    if (stopIfLeaderGone(s, p)) {
      return;
    }
    if (s.following !== p.following) {
      offMe?.();
      const doc = s.following ? sessionDoc() : undefined;
      offMe = doc ? watchMe(doc) : null;
    }
    if (s.following && (s.following !== p.following || leaderMoved(s.presence[s.following], p.presence[s.following]))) {
      applyFollowed();
    }
  });
  return () => {
    offCollab();
    offMe?.();
  };
}
