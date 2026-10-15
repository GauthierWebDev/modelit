import { emptyDocument, type ModelDocument } from "@core/index";
import { create } from "zustand";
import { prove } from "./password";
import type { ChatMessage, GuestLink, Participant, Presence, RejectReason, Role } from "./protocol";
import { createSessionStore, type SessionStore } from "./sessionStore";

/**
 * Invité d'une session (O-05 ; J-01, phase 5a, D11) : document miroir de l'onglet partagé. Ses
 * modifications s'appliquent aussitôt chez lui et partent vers l'hôte ; toutes celles que l'hôte
 * rediffuse (les siennes comprises) s'appliquent dans l'ordre : l'invité converge sur l'hôte.
 * Lecteur, ou connexion perdue : aucune modification (O-05 §4.3, §4.4).
 */

/** `password` : la session est protégée, le mot de passe est attendu (`answer`). */
export type GuestStatus = "connecting" | "password" | "connected" | "disconnected" | "ended";

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
  /** Essais restants pour le mot de passe ; `wrong` : la réponse précédente était fausse. */
  password: { attemptsLeft: number; wrong: boolean } | null;
  /** Nom du document partagé par l'hôte. */
  title: string | null;
  /** Présence des autres participants (O-05 §5). */
  presence: Record<string, Presence>;
  chat: ChatMessage[];
}

export interface GuestSession {
  store: SessionStore;
  state: ReturnType<typeof createGuestState>;
  setIdentity: (name: string, color: string) => void;
  /** Réponse au défi d'une session protégée. */
  answer: (password: string) => Promise<void>;
  setPresence: (presence: Presence) => void;
  sendChat: (text: string) => void;
  /** Connexion retrouvée (O-05 §4.4) : nouveau canal vers le même hôte. */
  reconnect: (link: GuestLink) => void;
  leave: () => void;
  /** Document courant, gardé en copie à la fin de la session (D16). */
  snapshot: () => ModelDocument;
}

const createGuestState = () =>
  create<GuestState>(() => ({ status: "connecting", role: null, you: null, participants: [], aiAllowed: false, ended: null, rejected: null, password: null, presence: {}, chat: [], title: null }));

export function startGuest({ link, secret, name, color }: { link: GuestLink; secret: string; name: string; color: string }): GuestSession {
  const state = createGuestState();
  let current = link;
  const canEdit = () => state.getState().status === "connected" && state.getState().role === "editor";
  const store = createSessionStore(emptyDocument(), {
    canEdit,
    publish: (ops, label) => current.send({ type: "ops", ops, ...(label === "history.ai" ? { ai: true } : {}) }),
  });

  let challenge: { nonce: string; salt: string } | null = null;
  let identity = { name, color };
  /** Mot de passe accepté, gardé en mémoire le temps de la session : reconnexion sans le redemander. */
  let accepted: string | null = null;
  let pending: string | null = null;

  const answer = async (password: string) => {
    if (!challenge) return;
    pending = password;
    const proof = await prove(password, challenge.salt, challenge.nonce);
    state.setState({ status: "connecting" });
    current.send({ type: "hello", secret, ...identity, proof });
  };

  /** Branche un canal : messages de l'hôte, fin de connexion, puis entrée dans la session. */
  const attach = (target: GuestLink) => {
    const offMessage = target.onMessage((message) => {
      switch (message.type) {
        case "challenge": {
          const wrong = challenge !== null && pending !== null;
          challenge = { nonce: message.nonce, salt: message.salt };
          if (accepted && !wrong) return void answer(accepted);
          state.setState({ status: "password", password: { attemptsLeft: message.attemptsLeft, wrong } });
          return;
        }
        case "welcome":
          accepted = pending ?? accepted;
          challenge = null;
          pending = null;
          store.getState().reset(message.doc);
          state.setState({
            status: "connected",
            role: message.role,
            you: message.you,
            participants: message.participants,
            aiAllowed: message.aiAllowed,
            password: null,
            chat: message.chat,
            title: message.title ?? null,
          });
          return;
        case "ops":
          store.getState().applyRemote(message.ops);
          return;
        case "participants": {
          // Présence des participants partis : effacée.
          const ids = new Set(message.participants.map((p) => p.id));
          const presence = Object.fromEntries(Object.entries(state.getState().presence).filter(([id]) => ids.has(id)));
          state.setState({ participants: message.participants, presence });
          return;
        }
        case "presence":
          state.setState((s) => ({ presence: { ...s.presence, [message.id]: message.presence } }));
          return;
        case "chat":
          state.setState((s) => ({ chat: [...s.chat, message.message] }));
          return;
        case "settings":
          state.setState({ aiAllowed: message.aiAllowed });
          return;
        case "rejected":
          if (message.reason === "unknown-link" || message.reason === "bad-password" || message.reason === "full") {
            state.setState({ status: "ended", ended: message.reason, password: null });
          } else {
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
    const offClose = target.onClose(() => {
      if (state.getState().status !== "ended") state.setState({ status: "disconnected" });
    });
    target.send({ type: "hello", secret, ...identity });
    return () => {
      offMessage();
      offClose();
    };
  };
  let detach = attach(link);

  return {
    store,
    state,
    setIdentity: (n, c) => {
      identity = { name: n, color: c };
      current.send({ type: "identity", name: n, color: c });
    },
    answer,
    setPresence: (presence) => {
      if (state.getState().status === "connected") current.send({ type: "presence", presence });
    },
    sendChat: (text) => {
      if (state.getState().status === "connected" && text.trim()) current.send({ type: "chat", text });
    },
    reconnect: (target) => {
      detach();
      current = target;
      challenge = null;
      state.setState({ status: "connecting" });
      detach = attach(target);
    },
    leave: () => {
      current.send({ type: "leave" });
      state.setState({ status: "ended", ended: null });
      detach();
      current.close();
    },
    snapshot: () => store.getState().doc,
  };
}
