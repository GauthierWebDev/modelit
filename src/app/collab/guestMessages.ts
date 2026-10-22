import type { createGuestState } from "./guest";
import { prove } from "./password";
import type { GuestLink, ToGuest } from "./protocol";
import type { SessionStore } from "./sessionStore";
import { type AudioPacket, decodePacket } from "./voice/packet";

/** État de l'invité d'une session, partagé par ses traitements (startGuest). */
export interface Guest {
  readonly secret: string;
  readonly state: ReturnType<typeof createGuestState>;
  readonly store: SessionStore;
  readonly audioHandlers: Set<(packet: AudioPacket) => void>;
  /** Canal courant vers l'hôte (remplacé à la reconnexion). */
  current: GuestLink;
  challenge: { nonce: string; salt: string } | null;
  identity: { name: string; color: string };
  voice: { joined: boolean; muted: boolean };
  /** Mot de passe accepté, gardé en mémoire le temps de la session : reconnexion sans le redemander. */
  accepted: string | null;
  pending: string | null;
  /** Débranche le canal courant. */
  detach: () => void;
}

export async function answer(g: Guest, password: string) {
  if (!g.challenge) {
    return;
  }
  g.pending = password;
  const proof = await prove(password, g.challenge.salt, g.challenge.nonce);
  g.state.setState({ status: "connecting" });
  g.current.send({ type: "hello", secret: g.secret, ...g.identity, proof });
}

/** Branche un canal : messages de l'hôte, fin de connexion, puis entrée dans la session. */
export function attach(g: Guest, target: GuestLink) {
  const { state } = g;
  const offMessage = target.onMessage((message) => {
    if (!connectionMessage(g, message)) {
      sessionMessage(g, message);
    }
  });
  const offClose = target.onClose(() => {
    if (state.getState().status !== "ended") {
      state.setState({ status: "disconnected" });
    }
  });
  const offDatagram = target.onDatagram((data) => {
    const packet = decodePacket(data);
    if (packet) {
      for (const h of g.audioHandlers) {
        h(packet);
      }
    }
  });
  target.send({ type: "hello", secret: g.secret, ...g.identity });
  return () => {
    offMessage();
    offClose();
    offDatagram();
  };
}

/** Défi, accueil, refus, fin : vrai si le message en était un. */
function connectionMessage(g: Guest, message: ToGuest): boolean {
  switch (message.type) {
    case "challenge":
      challenged(g, message);
      return true;
    case "welcome":
      welcome(g, message);
      return true;
    case "rejected":
      rejected(g, message);
      return true;
    case "ended":
      g.state.setState({ status: "ended", ended: message.reason });
      return true;
    default:
      return false;
  }
}

function challenged(g: Guest, message: Extract<ToGuest, { type: "challenge" }>) {
  const wrong = g.challenge !== null && g.pending !== null;
  g.challenge = { nonce: message.nonce, salt: message.salt };
  if (g.accepted && !wrong) {
    void answer(g, g.accepted);
    return;
  }
  g.state.setState({ status: "password", password: { attemptsLeft: message.attemptsLeft, wrong } });
}

function welcome(g: Guest, message: Extract<ToGuest, { type: "welcome" }>) {
  g.accepted = g.pending ?? g.accepted;
  g.challenge = null;
  g.pending = null;
  g.store.getState().reset(message.doc);
  g.state.setState({
    status: "connected",
    role: message.role,
    you: message.you,
    participants: message.participants,
    aiAllowed: message.aiAllowed,
    password: null,
    chat: message.chat,
    title: message.title ?? null,
  });
  // Reconnexion : l'hôte ne se souvient pas de l'état du vocal.
  if (g.voice.joined) {
    g.current.send({ type: "voice", ...g.voice });
  }
}

export function rejected(g: Guest, message: Extract<ToGuest, { type: "rejected" }>) {
  if (message.reason === "unknown-link" || message.reason === "bad-password" || message.reason === "full") {
    g.state.setState({ status: "ended", ended: message.reason, password: null });
    return;
  }
  // Modification refusée, déjà appliquée ici : retour à l'état de l'hôte.
  if (message.doc) {
    g.store.getState().reset(message.doc);
  }
  g.state.setState({ rejected: message.reason });
}

/** Modifications, participants, présence, chat et réglages de la session. */
function sessionMessage(g: Guest, message: ToGuest) {
  const { state } = g;
  switch (message.type) {
    case "ops":
      g.store.getState().applyRemote(message.ops);
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
    default:
      return;
  }
}
