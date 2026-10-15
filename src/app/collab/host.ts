import type { ModelDocument } from "@core/index";
import { create } from "zustand";
import { failureDelay, MAX_ATTEMPTS, randomHex } from "./password";
import { CHAT_MAX, MAX_PARTICIPANTS, type ChatMessage, type HostLink, type Participant, type Presence, type ToGuest, type ToHost } from "./protocol";
import { createSessionStore, type SessionStore } from "./sessionStore";

/**
 * Hôte d'une session (O-05 ; J-01, phase 5a, D11) : il fait foi. Il applique les modifications
 * reçues dans l'ordre d'arrivée, refuse celles des lecteurs (et de l'IA quand il l'interdit), et
 * rediffuse tout à tous les invités — auteur compris, qui converge ainsi sur l'état de l'hôte.
 */

export interface HostOptions {
  link: HostLink;
  /** Document de l'onglet partagé au démarrage. */
  doc: ModelDocument;
  /** Secrets des deux liens (O-05 §4.1, D15). */
  secrets: { editor: string; reader: string };
  me: Omit<Participant, "role">;
  aiAllowed?: boolean;
  /** Nom du document partagé, montré aux invités. */
  title?: string;
  /** Mot de passe de la session (`password.ts` : `verifier`), s'il y en a un. */
  password?: { salt: string; verify: (nonce: string, proof: string) => Promise<boolean> };
  /** Attente (ms) ; remplaçable dans les tests. */
  wait?: (ms: number) => Promise<void>;
}

export interface HostSession {
  store: SessionStore;
  /** Participants (hôte compris) et réglages, pour l'interface. */
  state: ReturnType<typeof createHostState>;
  setAiAllowed: (allowed: boolean) => void;
  setIdentity: (name: string, color: string) => void;
  /** Présence de l'hôte, diffusée à tous. */
  setPresence: (presence: Presence) => void;
  sendChat: (text: string) => void;
  kick: (peer: string) => void;
  /** Arrête la session pour tous. */
  stop: () => void;
}

const createHostState = (participants: Participant[], aiAllowed: boolean) =>
  create<{ participants: Participant[]; aiAllowed: boolean; presence: Record<string, Presence>; chat: ChatMessage[] }>(() => ({
    participants,
    aiAllowed,
    presence: {},
    chat: [],
  }));

/** Messages gardés en mémoire pour les nouveaux venus, le temps de la session seulement. */
const CHAT_KEPT = 500;

export function startHost({
  link,
  doc,
  secrets,
  me,
  aiAllowed = false,
  password,
  title,
  wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}: HostOptions): HostSession {
  /** Preuves fausses reçues pendant toute la session. */
  let failures = 0;
  const guests = new Map<string, Participant>();
  const host: Participant = { ...me, role: "host" };
  const state = createHostState([host], aiAllowed);

  const everyone = () => [host, ...guests.values()];
  let chatId = 0;
  const post = (kind: ChatMessage["kind"], who: Participant, text = "") => {
    const message: ChatMessage = { id: ++chatId, kind, author: who.id, name: who.name, color: who.color, text: text.slice(0, CHAT_MAX), at: Date.now() };
    state.setState((s) => ({ chat: [...s.chat, message].slice(-CHAT_KEPT) }));
    broadcast({ type: "chat", message });
  };

  /** Dernière présence de chacun : envoyée aux nouveaux venus. */
  const presence = new Map<string, Presence>();
  const relayPresence = (id: string, value: Presence) => {
    presence.set(id, value);
    if (id !== host.id) state.setState((s) => ({ presence: { ...s.presence, [id]: value } }));
    for (const peer of guests.keys()) if (peer !== id) link.send(peer, { type: "presence", id, presence: value });
  };
  const forget = (id: string) => {
    presence.delete(id);
    state.setState((s) => {
      const { [id]: _gone, ...rest } = s.presence;
      return { presence: rest };
    });
  };
  const broadcast = (message: ToGuest) => {
    for (const peer of guests.keys()) link.send(peer, message);
  };
  const publishParticipants = () => {
    const participants = everyone();
    state.setState({ participants });
    broadcast({ type: "participants", participants });
  };

  // Modifications de l'hôte : appliquées chez lui, diffusées à tous.
  const store = createSessionStore(doc, { publish: (ops) => broadcast({ type: "ops", ops, author: host.id }) });

  /** Défis en cours (session protégée) : nombre aléatoire et essais restants, par connexion. */
  const challenges = new Map<string, { nonce: string; attemptsLeft: number }>();
  const challenge = (peer: string, attemptsLeft: number) => {
    const nonce = randomHex();
    challenges.set(peer, { nonce, attemptsLeft });
    link.send(peer, { type: "challenge", nonce, salt: password!.salt, attemptsLeft });
  };

  /** Entrée dans la session : lien, puis mot de passe s'il y en a un. */
  const hello = async (peer: string, message: Extract<ToHost, { type: "hello" }>) => {
    const role = message.secret === secrets.editor ? "editor" : message.secret === secrets.reader ? "reader" : null;
    if (!role) {
      link.send(peer, { type: "rejected", reason: "unknown-link" });
      return link.close(peer);
    }
    // Session complète (hôte compris) : refus avant même le mot de passe.
    if (guests.size + 1 >= MAX_PARTICIPANTS) {
      link.send(peer, { type: "rejected", reason: "full" });
      return link.close(peer);
    }
    if (password) {
      const pending = challenges.get(peer);
      if (!pending || !message.proof) return challenge(peer, pending?.attemptsLeft ?? MAX_ATTEMPTS);
      if (!(await password.verify(pending.nonce, message.proof))) {
        await wait(failureDelay(++failures));
        if (pending.attemptsLeft <= 1) {
          challenges.delete(peer);
          link.send(peer, { type: "rejected", reason: "bad-password" });
          return link.close(peer);
        }
        return challenge(peer, pending.attemptsLeft - 1);
      }
      challenges.delete(peer);
    }
    const guest: Participant = { id: peer, name: message.name, color: message.color, role };
    post("joined", guest);
    guests.set(peer, guest);
    const { aiAllowed: ai, chat } = state.getState();
    link.send(peer, { type: "welcome", you: peer, role, doc: store.getState().doc, participants: everyone(), aiAllowed: ai, chat, ...(title ? { title } : {}) });
    for (const [id, value] of presence) link.send(peer, { type: "presence", id, presence: value });
    publishParticipants();
  };

  const offMessage = link.onMessage((peer, message) => {
    const guest = guests.get(peer);
    switch (message.type) {
      case "hello":
        void hello(peer, message);
        return;
      case "ops": {
        if (!guest) return;
        const doc = store.getState().doc;
        if (guest.role !== "editor") return link.send(peer, { type: "rejected", reason: "read-only", doc });
        if (message.ai && !state.getState().aiAllowed) return link.send(peer, { type: "rejected", reason: "ai-disabled", doc });
        store.getState().applyRemote(message.ops);
        return broadcast({ type: "ops", ops: message.ops, author: peer });
      }
      case "identity": {
        if (!guest) return;
        guests.set(peer, { ...guest, name: message.name, color: message.color });
        return publishParticipants();
      }
      case "presence":
        if (guest) relayPresence(peer, message.presence);
        return;
      case "chat":
        // Lecteurs compris : tout le monde est dans le chat (O-05 §6).
        if (guest && message.text.trim()) post("text", guest, message.text);
        return;
      case "leave":
        link.close(peer);
        return;
    }
  });
  const offClose = link.onClose((peer) => {
    challenges.delete(peer);
    forget(peer);
    const gone = guests.get(peer);
    if (gone && guests.delete(peer)) {
      publishParticipants();
      post("left", gone);
    }
  });

  return {
    store,
    state,
    setAiAllowed: (allowed) => {
      state.setState({ aiAllowed: allowed });
      broadcast({ type: "settings", aiAllowed: allowed });
    },
    setIdentity: (name, color) => {
      Object.assign(host, { name, color });
      publishParticipants();
    },
    setPresence: (value) => relayPresence(host.id, value),
    sendChat: (text) => {
      if (text.trim()) post("text", host, text);
    },
    kick: (peer) => {
      const guest = guests.get(peer);
      if (!guest) return;
      link.send(peer, { type: "ended", reason: "kicked" });
      guests.delete(peer);
      post("kicked", guest);
      forget(peer);
      link.close(peer);
      publishParticipants();
    },
    stop: () => {
      broadcast({ type: "ended", reason: "stopped" });
      for (const peer of [...guests.keys()]) link.close(peer);
      guests.clear();
      offMessage();
      offClose();
    },
  };
}
