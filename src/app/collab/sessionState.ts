import { create } from "zustand";
import { usePreferencesStore } from "../preferencesStore";
import type { GuestSession } from "./guest";
import type { HostSession } from "./host";
import { displayName } from "./identity";
import type { ChatMessage, GuestLink, HostLink, Participant, Presence } from "./protocol";

export interface CollabTransport {
  /** Démarre l'écoute ; `addr` : adresse de l'hôte, à placer dans les liens. */
  startHost: () => Promise<{ addr: string; link: HostLink; stop: () => Promise<void> }>;
  connect: (addr: string) => Promise<GuestLink>;
}

/** Session de la fenêtre (une à la fois, hôte ou invité) et transport, partagés par les commandes de la session. */
export const live: {
  transport: CollabTransport | null;
  host: { session: HostSession; stop: () => Promise<void>; off: () => void } | null;
  guest: { session: GuestSession; addr: string; off: () => void; retry?: ReturnType<typeof setTimeout> } | null;
} = { transport: null, host: null, guest: null };

/** Transport utilisé (iroh dans l'application, mémoire dans les tests). */
export const setCollabTransport = (value: CollabTransport) => {
  live.transport = value;
};

/** Reconnexion d'un invité (O-05 §4.4) : essais pendant 30 s, toutes les 3 s. */
export const RECONNECT_FOR = 30_000;

export const RECONNECT_EVERY = 3000;

/** Présence : au plus 20 envois par seconde (O-05 §5). */
export const PRESENCE_EVERY = 50;

/** Curseur masqué après 30 s sans mouvement (O-05 §5). */
export const CURSOR_IDLE = 30_000;

/** Présence d'un autre participant ; `movedAt` : dernier mouvement de son curseur (horloge locale). */
export type RemotePresence = Presence & { movedAt: number };

export type CollabMode = "idle" | "starting" | "host" | "joining" | "guest";

export interface CollabState {
  mode: CollabMode;
  /** Onglet partagé (hôte) ou de la session rejointe (invité). */
  tabId: string | null;
  links: { edit: string; read: string } | null;
  participants: Participant[];
  aiAllowed: boolean;
  presence: Record<string, RemotePresence>;
  /** Vocal de ce poste (O-48) ; « qui parle » est à part (`voice/speaking.ts`), non reflété. */
  voice: VoiceState;
  chat: ChatMessage[];
  /** Messages des autres arrivés depuis la dernière lecture (badge de la section Session). */
  unread: number;
  /** Mon identifiant dans la session. */
  you: string | null;
  /** Invité : rôle, état de la connexion, mot de passe demandé. */
  guest: {
    role: "editor" | "reader" | null;
    status: GuestSession["state"] extends { getState: () => infer S }
      ? S extends { status: infer T }
        ? T
        : never
      : never;
    password: { attemptsLeft: number; wrong: boolean } | null;
  } | null;
  error: string | null;
}

export interface VoiceState {
  /** `off` : pas dans le vocal ; `starting` : micro et moteur en cours d'ouverture. */
  status: "off" | "starting" | "on";
  muted: boolean;
  /** Faux : écoute seule (micro refusé ou absent). */
  mic: boolean;
  /** Raison d'un micro refusé (nom de l'erreur du système). */
  micError: string | null;
  /** Vocal impossible sur ce système : codec Opus absent, ou micro non exposé par le webview. */
  unavailable: "no-codec" | "no-media" | null;
  /** Volume de chaque participant (0 à 2), retenu jusqu'à la fin de la session. */
  volumes: Record<string, number>;
}

export const VOICE_OFF: VoiceState = {
  status: "off",
  muted: false,
  mic: false,
  micError: null,
  unavailable: null,
  volumes: {},
};

export const useCollabStore = create<CollabState>(() => ({
  mode: "idle",
  voice: VOICE_OFF,
  tabId: null,
  links: null,
  participants: [],
  aiAllowed: false,
  presence: {},
  chat: [],
  unread: 0,
  you: null,
  guest: null,
  error: null,
}));

/**
 * Onglet de session en lecture seule pour ce poste : lecteur, ou invité en cours de reconnexion
 * (O-05 §4.3, §4.4). Fonctionne aussi dans une fenêtre flottante (état reflété).
 */
export const selectReadOnlyTab = (s: CollabState): string | null =>
  s.mode === "guest" && s.guest && (s.guest.role === "reader" || s.guest.status !== "connected") ? s.tabId : null;

/** Messages reçus : compte ceux des autres arrivés depuis la dernière synchronisation. */
export function trackChat(next: ChatMessage[], you: string | null): Pick<CollabState, "chat" | "unread"> {
  const { chat, unread } = useCollabStore.getState();
  if (next === chat) {
    return { chat, unread };
  }
  const last = chat.at(-1)?.id ?? 0;
  return { chat: next, unread: unread + next.filter((m) => m.id > last && m.author !== you).length };
}

export const markChatRead = () => useCollabStore.getState().unread && useCollabStore.setState({ unread: 0 });

/** Présence reçue : horodate chaque mouvement de curseur. */
export function trackPresence(next: Record<string, Presence>): Record<string, RemotePresence> {
  const previous = useCollabStore.getState().presence;
  const now = Date.now();
  return Object.fromEntries(
    Object.entries(next).map(([id, p]) => {
      const before = previous[id];
      const moved = !before || before.cursor?.x !== p.cursor?.x || before.cursor?.y !== p.cursor?.y;
      return [id, { ...p, movedAt: moved ? now : before.movedAt }];
    }),
  );
}

export const me = () => {
  const { identity } = usePreferencesStore.getState();
  return { name: displayName(identity), color: identity.color };
};

/** Échec signalé dans la boîte de session ; renvoie `false` pour `return fail(…)`. */
export const fail = (error: string): false => {
  useCollabStore.setState({ error });
  return false;
};

// ——— Hôte ———
