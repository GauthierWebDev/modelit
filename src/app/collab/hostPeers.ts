import type { StoreApi } from "zustand";
import { failureDelay, MAX_ATTEMPTS, randomHex } from "./password";
import {
  CHAT_MAX,
  type ChatMessage,
  type HostLink,
  MAX_PARTICIPANTS,
  type Participant,
  type Presence,
  type ToGuest,
  type ToHost,
} from "./protocol";
import type { SessionStore } from "./sessionStore";
import { type AudioPacket, decodePacket, encodePacket } from "./voice/packet";

/** Messages gardés en mémoire pour les nouveaux venus, le temps de la session seulement. */
const CHAT_KEPT = 500;

/** État de l'hôte d'une session, partagé par ses traitements (startHost). */
export interface Host {
  readonly link: HostLink;
  /** L'hôte lui-même (identité et vocal modifiables). */
  readonly me: Participant;
  readonly guests: Map<string, Participant>;
  readonly state: HostState;
  readonly store: SessionStore;
  /** Dernière présence de chacun : envoyée aux nouveaux venus. */
  readonly presence: Map<string, Presence>;
  /** Défis en cours (session protégée) : nombre aléatoire et essais restants, par connexion. */
  readonly challenges: Map<string, { nonce: string; attemptsLeft: number }>;
  readonly audioHandlers: Set<(packet: AudioPacket) => void>;
  readonly secrets: { editor: string; reader: string };
  readonly password: { salt: string; verify: (nonce: string, proof: string) => Promise<boolean> } | undefined;
  readonly title: string | undefined;
  readonly wait: (ms: number) => Promise<void>;
  /** Preuves fausses reçues pendant toute la session. */
  failures: number;
  chatId: number;
}

/** Participants, réglages, présence et chat, pour l'interface. */
export interface HostData {
  participants: Participant[];
  aiAllowed: boolean;
  presence: Record<string, Presence>;
  chat: ChatMessage[];
}

export type HostState = StoreApi<HostData>;

export const everyone = (h: Host) => [h.me, ...h.guests.values()];

export function broadcast(h: Host, message: ToGuest) {
  for (const peer of h.guests.keys()) {
    h.link.send(peer, message);
  }
}

export function post(h: Host, kind: ChatMessage["kind"], who: Participant, text = "") {
  h.chatId += 1;
  const message: ChatMessage = {
    id: h.chatId,
    kind,
    author: who.id,
    name: who.name,
    color: who.color,
    text: text.slice(0, CHAT_MAX),
    at: Date.now(),
  };
  h.state.setState((s) => ({ chat: [...s.chat, message].slice(-CHAT_KEPT) }));
  broadcast(h, { type: "chat", message });
}

export function relayPresence(h: Host, id: string, value: Presence) {
  h.presence.set(id, value);
  if (id !== h.me.id) {
    h.state.setState((s) => ({ presence: { ...s.presence, [id]: value } }));
  }
  for (const peer of h.guests.keys()) {
    if (peer !== id) {
      h.link.send(peer, { type: "presence", id, presence: value });
    }
  }
}

export function forget(h: Host, id: string) {
  h.presence.delete(id);
  h.state.setState((s) => {
    const { [id]: _gone, ...rest } = s.presence;
    return { presence: rest };
  });
}

export function publishParticipants(h: Host) {
  const participants = everyone(h);
  h.state.setState({ participants });
  broadcast(h, { type: "participants", participants });
}

function challenge(h: Host, peer: string, attemptsLeft: number) {
  const nonce = randomHex();
  h.challenges.set(peer, { nonce, attemptsLeft });
  h.link.send(peer, { type: "challenge", nonce, salt: h.password!.salt, attemptsLeft });
}

/** Entrée dans la session : lien, puis mot de passe s'il y en a un. */
async function hello(h: Host, peer: string, message: Extract<ToHost, { type: "hello" }>) {
  const { link, secrets } = h;
  const role = message.secret === secrets.editor ? "editor" : message.secret === secrets.reader ? "reader" : null;
  if (!role) {
    link.send(peer, { type: "rejected", reason: "unknown-link" });
    return link.close(peer);
  }
  // Session complète (hôte compris) : refus avant même le mot de passe.
  if (h.guests.size + 1 >= MAX_PARTICIPANTS) {
    link.send(peer, { type: "rejected", reason: "full" });
    return link.close(peer);
  }
  if (h.password && !(await passwordAccepted(h, peer, message.proof))) {
    return;
  }
  return admit(h, peer, message, role);
}

/**
 * Mot de passe (session protégée) : défi, preuve, délai croissant après une preuve fausse, refus après
 * le dernier essai. Vrai si la preuve est bonne (le défi est alors oublié).
 */
async function passwordAccepted(h: Host, peer: string, proof: string | undefined): Promise<boolean> {
  const { link } = h;
  const pending = h.challenges.get(peer);
  if (!(pending && proof)) {
    challenge(h, peer, pending?.attemptsLeft ?? MAX_ATTEMPTS);
    return false;
  }
  if (!(await h.password!.verify(pending.nonce, proof))) {
    h.failures += 1;
    await h.wait(failureDelay(h.failures));
    if (pending.attemptsLeft <= 1) {
      h.challenges.delete(peer);
      link.send(peer, { type: "rejected", reason: "bad-password" });
      link.close(peer);
      return false;
    }
    challenge(h, peer, pending.attemptsLeft - 1);
    return false;
  }
  h.challenges.delete(peer);
  return true;
}

/** Nouvel invité : annoncé, accueilli avec l'état de la session et la présence de chacun. */
function admit(h: Host, peer: string, message: Extract<ToHost, { type: "hello" }>, role: "editor" | "reader") {
  const { link } = h;
  const guest: Participant = { id: peer, name: message.name, color: message.color, role };
  post(h, "joined", guest);
  h.guests.set(peer, guest);
  const { aiAllowed: ai, chat } = h.state.getState();
  link.send(peer, {
    type: "welcome",
    you: peer,
    role,
    doc: h.store.getState().doc,
    participants: everyone(h),
    aiAllowed: ai,
    chat,
    ...(h.title ? { title: h.title } : {}),
  });
  for (const [id, value] of h.presence) {
    link.send(peer, { type: "presence", id, presence: value });
  }
  publishParticipants(h);
}

/** Message d'une connexion. */
export function receive(h: Host, peer: string, message: ToHost) {
  const guest = h.guests.get(peer);
  if (message.type === "hello") {
    void hello(h, peer, message);
    return;
  }
  if (message.type === "leave") {
    h.link.close(peer);
    return;
  }
  if (guest) {
    guestMessage(h, peer, guest, message);
  }
}

/** Message d'un invité admis. */
function guestMessage(
  h: Host,
  peer: string,
  guest: Participant,
  message: Exclude<ToHost, { type: "hello" | "leave" }>,
) {
  switch (message.type) {
    case "ops":
      return guestOps(h, peer, guest, message);
    case "identity":
      h.guests.set(peer, { ...guest, name: message.name, color: message.color });
      return publishParticipants(h);
    case "voice": {
      const { audio: _previous, ...rest } = guest;
      h.guests.set(peer, message.joined ? { ...rest, audio: { muted: message.muted } } : rest);
      return publishParticipants(h);
    }
    case "presence":
      relayPresence(h, peer, message.presence);
      return;
    case "chat":
      // Lecteurs compris : tout le monde est dans le chat (O-05 §6).
      if (message.text.trim()) {
        post(h, "text", guest, message.text);
      }
      return;
  }
}

/** Modifications d'un invité : refusées aux lecteurs (et à l'IA quand l'hôte l'interdit), sinon appliquées et rediffusées. */
function guestOps(h: Host, peer: string, guest: Participant, message: Extract<ToHost, { type: "ops" }>) {
  const snapshot = h.store.getState().doc;
  if (guest.role !== "editor") {
    return h.link.send(peer, { type: "rejected", reason: "read-only", doc: snapshot });
  }
  if (message.ai && !h.state.getState().aiAllowed) {
    return h.link.send(peer, { type: "rejected", reason: "ai-disabled", doc: snapshot });
  }
  h.store.getState().applyRemote(message.ops);
  return broadcast(h, { type: "ops", ops: message.ops, author: peer });
}

/** Invités dans le vocal, hors `except`. */
export const listeners = (h: Host, except: string) =>
  [...h.guests.values()].filter((g) => g.audio && g.id !== except).map((g) => g.id);

/**
 * Vocal (O-48, D18) : l'hôte relaie la voix d'un invité aux autres participants du vocal, sous
 * l'identifiant de l'invité (jamais celui annoncé par l'invité).
 */
export function relayAudio(h: Host, peer: string, data: Uint8Array) {
  const guest = h.guests.get(peer);
  if (!guest?.audio || guest.audio.muted) {
    return;
  }
  const packet = decodePacket(data);
  if (!packet) {
    return;
  }
  const relayed = { ...packet, speaker: peer };
  const targets = listeners(h, peer);
  if (targets.length > 0) {
    h.link.sendDatagram(targets, encodePacket(relayed));
  }
  if (h.me.audio) {
    for (const handler of h.audioHandlers) {
      handler(relayed);
    }
  }
}

/** Connexion fermée : défi, présence et participant oubliés. */
export function closed(h: Host, peer: string) {
  h.challenges.delete(peer);
  forget(h, peer);
  const gone = h.guests.get(peer);
  if (gone && h.guests.delete(peer)) {
    publishParticipants(h);
    post(h, "left", gone);
  }
}
