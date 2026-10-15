import type { ModelDocument } from "@core/index";
import { create } from "zustand";
import type { HostLink, Participant, ToGuest } from "./protocol";
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
}

export interface HostSession {
  store: SessionStore;
  /** Participants (hôte compris) et réglages, pour l'interface. */
  state: ReturnType<typeof createHostState>;
  setAiAllowed: (allowed: boolean) => void;
  setIdentity: (name: string, color: string) => void;
  kick: (peer: string) => void;
  /** Arrête la session pour tous. */
  stop: () => void;
}

const createHostState = (participants: Participant[], aiAllowed: boolean) =>
  create<{ participants: Participant[]; aiAllowed: boolean }>(() => ({ participants, aiAllowed }));

export function startHost({ link, doc, secrets, me, aiAllowed = false }: HostOptions): HostSession {
  const guests = new Map<string, Participant>();
  const host: Participant = { ...me, role: "host" };
  const state = createHostState([host], aiAllowed);

  const everyone = () => [host, ...guests.values()];
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

  const offMessage = link.onMessage((peer, message) => {
    const guest = guests.get(peer);
    switch (message.type) {
      case "hello": {
        const role = message.secret === secrets.editor ? "editor" : message.secret === secrets.reader ? "reader" : null;
        if (!role) {
          link.send(peer, { type: "rejected", reason: "unknown-link" });
          return link.close(peer);
        }
        guests.set(peer, { id: peer, name: message.name, color: message.color, role });
        link.send(peer, { type: "welcome", you: peer, role, doc: store.getState().doc, participants: everyone(), aiAllowed: state.getState().aiAllowed });
        return publishParticipants();
      }
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
      case "leave":
        link.close(peer);
        return;
    }
  });
  const offClose = link.onClose((peer) => {
    if (guests.delete(peer)) publishParticipants();
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
    kick: (peer) => {
      if (!guests.has(peer)) return;
      link.send(peer, { type: "ended", reason: "kicked" });
      guests.delete(peer);
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
