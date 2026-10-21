import { emptyDocument, type ModelDocument } from "@core/index";
import { create } from "zustand";
import { answer, attach, type Guest } from "./guestMessages";
import type { ChatMessage, GuestLink, Participant, Presence, RejectReason, Role } from "./protocol";
import { createSessionStore, type SessionStore } from "./sessionStore";
import { type AudioPacket, encodePacket } from "./voice/packet";

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
  /** Vocal (O-48) : rejoint ou quitté, micro coupé ou ouvert ; renvoyé après une reconnexion. */
  setVoice: (joined: boolean, muted: boolean) => void;
  /** 20 ms de ma voix, vers l'hôte qui la relaie. */
  sendAudio: (packet: Omit<AudioPacket, "speaker">) => void;
  /** Voix des autres participants (identifiant posé par l'hôte). */
  onAudio: (handler: (packet: AudioPacket) => void) => () => void;
  /** Connexion retrouvée (O-05 §4.4) : nouveau canal vers le même hôte. */
  reconnect: (link: GuestLink) => void;
  leave: () => void;
  /** Document courant, gardé en copie à la fin de la session (D16). */
  snapshot: () => ModelDocument;
}

export const createGuestState = () =>
  create<GuestState>(() => ({
    status: "connecting",
    role: null,
    you: null,
    participants: [],
    aiAllowed: false,
    ended: null,
    rejected: null,
    password: null,
    presence: {},
    chat: [],
    title: null,
  }));

export function startGuest({
  link,
  secret,
  name,
  color,
}: {
  link: GuestLink;
  secret: string;
  name: string;
  color: string;
}): GuestSession {
  const state = createGuestState();
  const canEdit = () => state.getState().status === "connected" && state.getState().role === "editor";
  const g: Guest = {
    secret,
    state,
    store: createSessionStore(emptyDocument(), {
      canEdit,
      publish: (ops, label) => g.current.send({ type: "ops", ops, ...(label === "history.ai" ? { ai: true } : {}) }),
    }),
    audioHandlers: new Set(),
    current: link,
    challenge: null,
    identity: { name, color },
    voice: { joined: false, muted: false },
    accepted: null,
    pending: null,
    detach: () => undefined,
  };
  g.detach = attach(g, link);
  return guestApi(g);
}

/** Commandes de l'invité, pour l'interface. */
function guestApi(g: Guest): GuestSession {
  const { state } = g;
  const connected = () => state.getState().status === "connected";
  return {
    store: g.store,
    state,
    setIdentity: (n, c) => {
      g.identity = { name: n, color: c };
      g.current.send({ type: "identity", name: n, color: c });
    },
    answer: (password) => answer(g, password),
    setPresence: (presence) => {
      if (connected()) {
        g.current.send({ type: "presence", presence });
      }
    },
    setVoice: (joined, muted) => {
      g.voice = { joined, muted };
      if (connected()) {
        g.current.send({ type: "voice", joined, muted });
      }
    },
    sendAudio: (packet) => {
      if (connected() && g.voice.joined && !g.voice.muted) {
        g.current.sendDatagram(encodePacket({ ...packet, speaker: "" }));
      }
    },
    onAudio: (handler) => {
      g.audioHandlers.add(handler);
      return () => g.audioHandlers.delete(handler);
    },
    sendChat: (text) => {
      if (connected() && text.trim()) {
        g.current.send({ type: "chat", text });
      }
    },
    reconnect: (target) => {
      g.detach();
      g.current = target;
      g.challenge = null;
      state.setState({ status: "connecting" });
      g.detach = attach(g, target);
    },
    leave: () => {
      g.current.send({ type: "leave" });
      state.setState({ status: "ended", ended: null });
      g.detach();
      g.current.close();
    },
    snapshot: () => g.store.getState().doc,
  };
}
