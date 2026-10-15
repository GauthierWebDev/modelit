import { emptyDocument, type ModelDocument } from "@core/index";
import { create } from "zustand";
import type { GuestLink, Participant, RejectReason, Role } from "./protocol";
import { createSessionStore, type SessionStore } from "./sessionStore";

/**
 * Invité d'une session (O-05 ; J-01, phase 5a, D11) : document miroir de l'onglet partagé. Ses
 * modifications s'appliquent aussitôt chez lui et partent vers l'hôte ; toutes celles que l'hôte
 * rediffuse (les siennes comprises) s'appliquent dans l'ordre : l'invité converge sur l'hôte.
 * Lecteur, ou connexion perdue : aucune modification (O-05 §4.3, §4.4).
 */

export type GuestStatus = "connecting" | "connected" | "disconnected" | "ended";

export interface GuestState {
  status: GuestStatus;
  role: Exclude<Role, "host"> | null;
  you: string | null;
  participants: Participant[];
  aiAllowed: boolean;
  /** Fin de session : arrêtée par l'hôte, exclusion, lien refusé. */
  ended: "stopped" | "kicked" | RejectReason | null;
  /** Dernier refus d'une modification (lecteur, IA interdite). */
  rejected: RejectReason | null;
}

export interface GuestSession {
  store: SessionStore;
  state: ReturnType<typeof createGuestState>;
  setIdentity: (name: string, color: string) => void;
  leave: () => void;
  /** Document courant, gardé en copie à la fin de la session (D16). */
  snapshot: () => ModelDocument;
}

const createGuestState = () =>
  create<GuestState>(() => ({ status: "connecting", role: null, you: null, participants: [], aiAllowed: false, ended: null, rejected: null }));

export function startGuest({ link, secret, name, color }: { link: GuestLink; secret: string; name: string; color: string }): GuestSession {
  const state = createGuestState();
  const canEdit = () => state.getState().status === "connected" && state.getState().role === "editor";
  const store = createSessionStore(emptyDocument(), {
    canEdit,
    publish: (ops, label) => link.send({ type: "ops", ops, ...(label === "history.ai" ? { ai: true } : {}) }),
  });

  const offMessage = link.onMessage((message) => {
    switch (message.type) {
      case "welcome":
        store.getState().reset(message.doc);
        state.setState({ status: "connected", role: message.role, you: message.you, participants: message.participants, aiAllowed: message.aiAllowed });
        return;
      case "ops":
        store.getState().applyRemote(message.ops);
        return;
      case "participants":
        state.setState({ participants: message.participants });
        return;
      case "settings":
        state.setState({ aiAllowed: message.aiAllowed });
        return;
      case "rejected":
        if (message.reason === "unknown-link") state.setState({ status: "ended", ended: message.reason });
        else {
          // Modification refusée, déjà appliquée ici : retour à l'état de l'hôte.
          if (message.doc) store.getState().reset(message.doc);
          state.setState({ rejected: message.reason });
        }
        return;
      case "ended":
        state.setState({ status: "ended", ended: message.reason });
        return;
    }
  });
  const offClose = link.onClose(() => {
    if (state.getState().status !== "ended") state.setState({ status: "disconnected" });
  });

  link.send({ type: "hello", secret, name, color });

  return {
    store,
    state,
    setIdentity: (n, c) => link.send({ type: "identity", name: n, color: c }),
    leave: () => {
      link.send({ type: "leave" });
      state.setState({ status: "ended", ended: null });
      offMessage();
      offClose();
      link.close();
    },
    snapshot: () => store.getState().doc,
  };
}
