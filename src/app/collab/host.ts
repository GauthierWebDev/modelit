import type { ModelDocument } from "@core/index";
import { create } from "zustand";
import {
  broadcast,
  closed,
  forget,
  type Host,
  type HostData,
  listeners,
  post,
  publishParticipants,
  receive,
  relayAudio,
  relayPresence,
} from "./hostPeers";
import type { HostLink, Participant, Presence } from "./protocol";
import { createSessionStore, type SessionStore } from "./sessionStore";
import { type AudioPacket, encodePacket } from "./voice/packet";

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
  /** Vocal de l'hôte (O-48) : rejoint ou quitté, micro coupé ou ouvert. */
  setVoice: (joined: boolean, muted: boolean) => void;
  /** 20 ms de voix de l'hôte, vers les invités dans le vocal. */
  sendAudio: (packet: Omit<AudioPacket, "speaker">) => void;
  /** Voix des invités, pour l'hôte quand il est dans le vocal. */
  onAudio: (handler: (packet: AudioPacket) => void) => () => void;
  kick: (peer: string) => void;
  /** Arrête la session pour tous. */
  stop: () => void;
}

const createHostState = (participants: Participant[], aiAllowed: boolean) =>
  create<HostData>(() => ({
    participants,
    aiAllowed,
    presence: {},
    chat: [],
  }));

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
  const guests = new Map<string, Participant>();
  const host: Participant = { ...me, role: "host" };
  const state = createHostState([host], aiAllowed);
  const h: Host = {
    link,
    me: host,
    guests,
    state,
    // Modifications de l'hôte : appliquées chez lui, diffusées à tous.
    store: createSessionStore(doc, { publish: (ops) => broadcast(h, { type: "ops", ops, author: host.id }) }),
    presence: new Map(),
    challenges: new Map(),
    audioHandlers: new Set(),
    secrets,
    password,
    title,
    wait,
    failures: 0,
    chatId: 0,
  };
  const offMessage = link.onMessage((peer, message) => receive(h, peer, message));
  const offDatagram = link.onDatagram((peer, data) => relayAudio(h, peer, data));
  const offClose = link.onClose((peer) => closed(h, peer));
  return hostApi(h, state, () => {
    offMessage();
    offClose();
    offDatagram();
  });
}

/** Commandes de l'hôte, pour l'interface. */
function hostApi(h: Host, state: HostSession["state"], unsubscribe: () => void): HostSession {
  const { link, guests, me: host } = h;
  return {
    store: h.store,
    state,
    setAiAllowed: (allowed) => {
      state.setState({ aiAllowed: allowed });
      broadcast(h, { type: "settings", aiAllowed: allowed });
    },
    setIdentity: (name, color) => {
      Object.assign(host, { name, color });
      publishParticipants(h);
    },
    setPresence: (value) => relayPresence(h, host.id, value),
    sendChat: (text) => {
      if (text.trim()) {
        post(h, "text", host, text);
      }
    },
    kick: (peer) => kick(h, peer),
    setVoice: (joined, muted) => {
      if (joined) {
        host.audio = { muted };
      } else {
        delete host.audio;
      }
      publishParticipants(h);
    },
    sendAudio: (packet) => {
      if (!host.audio || host.audio.muted) {
        return;
      }
      const targets = listeners(h, host.id);
      if (targets.length > 0) {
        link.sendDatagram(targets, encodePacket({ ...packet, speaker: host.id }));
      }
    },
    onAudio: (handler) => {
      h.audioHandlers.add(handler);
      return () => h.audioHandlers.delete(handler);
    },
    stop: () => {
      broadcast(h, { type: "ended", reason: "stopped" });
      for (const peer of [...guests.keys()]) {
        link.close(peer);
      }
      guests.clear();
      unsubscribe();
    },
  };
}

function kick(h: Host, peer: string) {
  const guest = h.guests.get(peer);
  if (!guest) {
    return;
  }
  h.link.send(peer, { type: "ended", reason: "kicked" });
  h.guests.delete(peer);
  post(h, "kicked", guest);
  forget(h, peer);
  h.link.close(peer);
  publishParticipants(h);
}
