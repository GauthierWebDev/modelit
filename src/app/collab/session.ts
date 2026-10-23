import { updateDock } from "../dock/actions";
import { groupOf, hideSection, setActive, showSection } from "../dock/layout";
import type { ViewMode } from "../document/documentView";
import { documentName } from "../documentNames";
import { usePreferencesStore } from "../preferencesStore";
import { useWorkspaceStore } from "../workspace";
import type { HostSession } from "./host";
import { leaveSession } from "./sessionGuest";
import { confirmKick, setGuestsAi, stopSharing } from "./sessionHost";
import { type CollabMode, type CollabState, live, markChatRead, me, useCollabStore } from "./sessionState";

export { answerPassword, joinFromLink, leaveSession } from "./sessionGuest";
export { kick, setGuestsAi, shareActiveTab, stopSharing } from "./sessionHost";
export { reportPresence } from "./sessionPresence";

import { follow } from "./follow";

export {
  type CollabMode,
  type CollabTransport,
  CURSOR_IDLE,
  markChatRead,
  RECONNECT_FOR,
  type RemotePresence,
  selectReadOnlyTab,
  setCollabTransport,
  useCollabStore,
  VOICE_OFF,
  type VoiceState,
} from "./sessionState";

/**
 * Session collaborative de la fenêtre (O-05 ; J-01, phase 5a) : une à la fois, comme hôte ou comme
 * invité. Relie le protocole (`host.ts`, `guest.ts`), le transport et les onglets.
 */

export function sendChat(text: string) {
  live.host?.session.sendChat(text);
  live.guest?.session.sendChat(text);
}

/**
 * Fermeture de l'application : l'hôte arrête la session (les invités voient « arrêtée par
 * l'hôte », pas une perte de connexion) ; un invité la quitte (O-05 §4.4).
 */
export async function endSessionOnExit() {
  if (live.host) {
    await stopSharing();
  } else if (live.guest) {
    const { session, off, retry } = live.guest;
    live.guest = null;
    off();
    clearTimeout(retry);
    session.leave();
  }
}

/**
 * Raison pour laquelle l'assistant IA de ce poste ne peut pas modifier le document `docId`, ou
 * `null`. Seul l'onglet d'une session rejointe est concerné : l'hôte suit ses propres options
 * (O-47). Messages en anglais, comme le reste du serveur MCP.
 */
export function aiWriteRefusal(docId: string): string | null {
  const { mode, tabId, guest: state, aiAllowed } = useCollabStore.getState();
  if (mode !== "guest" || tabId !== docId || !state) {
    return null;
  }
  if (state.role === "reader") {
    return "This is a read-only session: the document can be read, not changed.";
  }
  if (!aiAllowed) {
    return "AI assistants are disabled by the session host. Reading is still allowed.";
  }
  if (state.status !== "connected") {
    return "The session is reconnecting to its host: try again in a moment.";
  }
  return null;
}

// ——— Présence ———

/** Nom de l'onglet partagé, pour l'interface. */
export function sharedTabName(): string | null {
  const id = useCollabStore.getState().tabId;
  const tab = useWorkspaceStore.getState().documents.find((d) => d.id === id);
  return tab ? documentName(tab) : null;
}

// ——— Vocal (O-48) ———

/** Canal du vocal de la session en cours (hôte ou invité) ; `null` hors session. */
export interface VoiceLink {
  setVoice: (joined: boolean, muted: boolean) => void;
  sendAudio: HostSession["sendAudio"];
  onAudio: HostSession["onAudio"];
}

export function voiceLink(): VoiceLink | null {
  const session = live.host?.session ?? live.guest?.session;
  return session ? { setVoice: session.setVoice, sendAudio: session.sendAudio, onAudio: session.onAudio } : null;
}

export type VoiceAction =
  | { kind: "join" }
  | { kind: "leave" }
  | { kind: "mute"; muted: boolean }
  | { kind: "volume"; peer: string; gain: number };

let voiceActions: ((action: VoiceAction) => void) | null = null;

/** Branché par `voice/voiceSession.ts` (qui dépend de ce module, et non l'inverse). */
export const registerVoiceActions = (run: (action: VoiceAction) => void) => {
  voiceActions = run;
};

// ——— Fenêtres flottantes (J-01, D6) ———

/** Actions de session, exécutées par la fenêtre principale (relayées depuis une flottante). */
export type CollabAction =
  | { kind: "chat"; text: string }
  | { kind: "read" }
  | { kind: "kick"; peer: string }
  | { kind: "guestsAi"; allowed: boolean }
  | { kind: "stop" }
  | { kind: "leave" }
  | { kind: "voice"; action: VoiceAction }
  /** Suivre un participant (O-05 §5), ou arrêter (`null`). */
  | { kind: "follow"; peer: string | null };

export function runCollabAction(action: CollabAction) {
  switch (action.kind) {
    case "chat":
      return sendChat(action.text);
    case "read":
      return void markChatRead();
    case "kick":
      return void confirmKick(action.peer);
    case "guestsAi":
      return void setGuestsAi(action.allowed);
    case "stop":
      return void stopSharing();
    case "leave":
      return void leaveSession();
    case "follow":
      return follow(action.peer);
    case "voice":
      return voiceActions?.(action.action);
  }
}

/**
 * Ce qu'une fenêtre flottante reçoit de la session : tout sauf les curseurs (dessinés dans le
 * canevas de la principale), réduits à la vue de chacun.
 */
export type CollabMirror = Omit<CollabState, "presence"> & { views: Record<string, ViewMode> };

export function collabMirror(): CollabMirror {
  const { presence, ...rest } = useCollabStore.getState();
  return { ...rest, views: Object.fromEntries(Object.entries(presence).map(([id, p]) => [id, p.view])) };
}

export const sameCollabMirror = (a: CollabMirror, b: CollabMirror) =>
  (Object.keys(a) as (keyof CollabMirror)[]).every((k) =>
    k === "views" ? JSON.stringify(a.views) === JSON.stringify(b.views) : a[k] === b[k],
  );

export function applyCollabMirror(mirror: CollabMirror) {
  // Rien de changé : pas de nouvel état (il repartirait vers la principale par les abonnements).
  if (JSON.stringify(mirror) === JSON.stringify(collabMirror())) {
    return;
  }
  const { views, ...rest } = mirror;
  useCollabStore.setState({
    ...rest,
    presence: Object.fromEntries(
      Object.entries(views).map(([id, view]) => [id, { view, cursor: null, selection: [], movedAt: 0 }]),
    ),
  });
}

/**
 * Suivi de la session par la fenêtre principale (une flottante reçoit sa disposition de la principale),
 * démarré par `src/bootstrap.ts` ; renvoie la désinscription (audit A-01, A-3).
 * - Section « Session » (O-05 §7) : affichée au début d'une session, masquée à la fin.
 * - Identité changée dans les options : visible tout de suite par les autres (O-05 §3).
 */
export function startSessionSync(): () => void {
  const offSection = useCollabStore.subscribe((s, p) => {
    const active = (mode: CollabMode) => mode === "host" || mode === "guest";
    if (active(s.mode) === active(p.mode)) {
      return;
    }
    updateDock((layout) => {
      if (!active(s.mode)) {
        return hideSection(layout, "session");
      }
      const shown = showSection(layout, "session");
      const found = groupOf(shown, "session");
      return found ? setActive(shown, found.group.id, "session") : shown;
    });
  });
  const offIdentity = usePreferencesStore.subscribe((s, p) => {
    if (s.identity === p.identity) {
      return;
    }
    const { name, color } = me();
    live.host?.session.setIdentity(name, color);
    live.guest?.session.setIdentity(name, color);
  });
  return () => {
    offSection();
    offIdentity();
  };
}
