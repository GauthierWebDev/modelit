import { create } from "zustand";
import { t } from "@/i18n";
import { alertDialog, confirmDialog } from "../dialogStore";
import { updateDock } from "../dock/actions";
import { groupOf, hideSection, setActive, showSection } from "../dock/layout";
import { createDocumentStore } from "../document/documentStore";
import { createDocumentViewStore, type ViewMode } from "../document/documentView";
import { createDocumentHandle, type DocumentHandle } from "../document/handle";
import { documentName } from "../fileCommands";
import { usePreferencesStore } from "../preferencesStore";
import { activeDocument, addTab, replaceDocument, setTitle, useWorkspaceStore } from "../workspace";
import { type GuestSession, startGuest } from "./guest";
import { type HostSession, startHost } from "./host";
import { displayName } from "./identity";
import { buildLink, newSecret, parseLink } from "./link";
import { MIN_PASSWORD_LENGTH, verifier } from "./password";
import {
  type ChatMessage,
  type GuestLink,
  type HostLink,
  MAX_DOCUMENT_BYTES,
  type Participant,
  type Presence,
} from "./protocol";

/**
 * Session collaborative de la fenêtre (O-05 ; J-01, phase 5a) : une à la fois, comme hôte ou comme
 * invité. Relie le protocole (`host.ts`, `guest.ts`), le transport et les onglets.
 */

export interface CollabTransport {
  /** Démarre l'écoute ; `addr` : adresse de l'hôte, à placer dans les liens. */
  startHost: () => Promise<{ addr: string; link: HostLink; stop: () => Promise<void> }>;
  connect: (addr: string) => Promise<GuestLink>;
}

let transport: CollabTransport | null = null;
/** Transport utilisé (iroh dans l'application, mémoire dans les tests). */
export const setCollabTransport = (value: CollabTransport) => (transport = value);

/** Reconnexion d'un invité (O-05 §4.4) : essais pendant 30 s, toutes les 3 s. */
export const RECONNECT_FOR = 30_000;
const RECONNECT_EVERY = 3_000;
/** Présence : au plus 20 envois par seconde (O-05 §5). */
const PRESENCE_EVERY = 50;
/** Curseur masqué après 30 s sans mouvement (O-05 §5). */
export const CURSOR_IDLE = 30_000;

/** Présence d'un autre participant ; `movedAt` : dernier mouvement de son curseur (horloge locale). */
export type RemotePresence = Presence & { movedAt: number };

export type CollabMode = "idle" | "starting" | "host" | "joining" | "guest";

interface CollabState {
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
function trackChat(next: ChatMessage[], you: string | null): Pick<CollabState, "chat" | "unread"> {
  const { chat, unread } = useCollabStore.getState();
  if (next === chat) return { chat, unread };
  const last = chat.at(-1)?.id ?? 0;
  return { chat: next, unread: unread + next.filter((m) => m.id > last && m.author !== you).length };
}

export const markChatRead = () => useCollabStore.getState().unread && useCollabStore.setState({ unread: 0 });

export function sendChat(text: string) {
  host?.session.sendChat(text);
  guest?.session.sendChat(text);
}

/** Présence reçue : horodate chaque mouvement de curseur. */
function trackPresence(next: Record<string, Presence>): Record<string, RemotePresence> {
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

let host: { session: HostSession; stop: () => Promise<void>; off: () => void } | null = null;
let guest: { session: GuestSession; addr: string; off: () => void; retry?: ReturnType<typeof setTimeout> } | null =
  null;

const me = () => {
  const identity = usePreferencesStore.getState().identity;
  return { name: displayName(identity), color: identity.color };
};

/** Échec signalé dans la boîte de session ; renvoie `false` pour `return fail(…)`. */
const fail = (error: string): false => {
  useCollabStore.setState({ error });
  return false;
};

// ——— Hôte ———

/** Partage l'onglet actif (O-05 §4.1). */
export async function shareActiveTab({
  password,
  aiAllowed = false,
}: {
  password?: string;
  aiAllowed?: boolean;
} = {}): Promise<boolean> {
  if (!transport || useCollabStore.getState().mode !== "idle") return false;
  if (password && password.length < MIN_PASSWORD_LENGTH)
    return fail(t("collab.passwordTooShort", { n: MIN_PASSWORD_LENGTH }));
  const tab = activeDocument();
  if (new TextEncoder().encode(JSON.stringify(tab.store.getState().doc)).length > MAX_DOCUMENT_BYTES)
    return fail(t("collab.tooLarge"));
  useCollabStore.setState({ mode: "starting", error: null });
  presenceSent = null;
  try {
    const started = await transport.startHost();
    const secrets = { editor: newSecret(), reader: newSecret() };
    const original = tab.store.getState();
    const session = startHost({
      link: started.link,
      doc: original.doc,
      secrets,
      me: { id: "host", ...me() },
      aiAllowed,
      title: documentName(tab),
      ...(password ? { password: await verifier(password) } : {}),
    });
    // L'onglet garde son fichier et son état « modifié » ; son historique devient personnel.
    session.store.setState({
      filePath: original.filePath,
      savedDoc: original.savedDoc === original.doc ? original.doc : original.savedDoc,
    });
    replaceDocument(tab.id, { id: tab.id, store: session.store, view: tab.view });
    const sync = () => {
      const s = session.state.getState();
      useCollabStore.setState({
        participants: s.participants,
        aiAllowed: s.aiAllowed,
        presence: trackPresence(s.presence),
        ...trackChat(s.chat, "host"),
      });
    };
    const offState = session.state.subscribe(sync);
    // Onglet fermé : fin du partage.
    const offTabs = useWorkspaceStore.subscribe((s) => {
      if (!s.documents.some((d) => d.id === tab.id)) void stopSharing();
    });
    host = {
      session,
      stop: started.stop,
      off: () => {
        offState();
        offTabs();
      },
    };
    useCollabStore.setState({
      mode: "host",
      you: "host",
      tabId: tab.id,
      links: { edit: buildLink(started.addr, secrets.editor), read: buildLink(started.addr, secrets.reader) },
    });
    sync();
    return true;
  } catch (e) {
    useCollabStore.setState({ mode: "idle", error: t("collab.startFailed", { error: String(e) }) });
    return false;
  }
}

/** Arrête le partage pour tous (O-05 §4.4) ; l'onglet redevient un document ordinaire. */
export async function stopSharing() {
  if (!host) return;
  const { session, stop, off } = host;
  host = null;
  off();
  session.stop();
  await stop();
  const tabId = useCollabStore.getState().tabId;
  const state = session.store.getState();
  const tab = useWorkspaceStore.getState().documents.find((d) => d.id === tabId);
  if (tab) {
    const store = createDocumentStore(state.doc);
    store.setState({ filePath: state.filePath, savedDoc: state.savedDoc });
    replaceDocument(tab.id, { id: tab.id, store, view: tab.view });
  }
  useCollabStore.setState({
    mode: "idle",
    tabId: null,
    links: null,
    participants: [],
    presence: {},
    chat: [],
    unread: 0,
    you: null,
  });
}

export const setGuestsAi = (allowed: boolean) => host?.session.setAiAllowed(allowed);
export const kick = (peer: string) => host?.session.kick(peer);

/** Exclusion demandée depuis la liste des participants : confirmée d'abord (O-05 §4.3). */
async function confirmKick(peer: string) {
  const name = useCollabStore.getState().participants.find((p) => p.id === peer)?.name;
  if (!name) return;
  const ok = await confirmDialog({
    title: t("collab.kickTitle"),
    message: t("collab.kickConfirm", { name }),
    okLabel: t("collab.kickOk"),
    cancelLabel: t("common.cancel"),
  });
  if (ok) kick(peer);
}

// ——— Invité ———

/** Rejoint une session par un lien d'invitation (O-05 §4.2) ; la session s'ouvre dans un nouvel onglet. */
export async function joinFromLink(url: string): Promise<boolean> {
  const parsed = parseLink(url);
  if (!parsed) return fail(t("collab.invalidLink"));
  if (!transport) return false;
  if (useCollabStore.getState().mode !== "idle") return fail(t("collab.alreadyInSession"));
  useCollabStore.setState({ mode: "joining", error: null });
  presenceSent = null;
  let link: GuestLink;
  try {
    link = await transport.connect(parsed.addr);
  } catch (e) {
    useCollabStore.setState({ mode: "idle", error: t("collab.unreachable", { error: String(e) }) });
    return false;
  }
  const session = startGuest({ link, secret: parsed.secret, ...me() });
  const tab: DocumentHandle = { id: crypto.randomUUID(), store: session.store, view: createDocumentViewStore() };
  let opened = false;

  const sync = () => {
    const s = session.state.getState();
    useCollabStore.setState({
      participants: s.participants,
      aiAllowed: s.aiAllowed,
      presence: trackPresence(s.presence),
      ...trackChat(s.chat, s.you),
      you: s.you,
      guest: { role: s.role, status: s.status, password: s.password },
    });
    const hostName = s.participants.find((p) => p.role === "host")?.name ?? "?";
    // « <nom> — session de <hôte> » (O-05 §4.2).
    const title = t("collab.tabTitle", { name: s.title ?? t("app.untitled"), host: hostName });
    if (s.status === "connected" && !opened) {
      opened = true;
      addTab(tab, title);
      useCollabStore.setState({ mode: "guest", tabId: tab.id });
    } else if (opened) setTitle(tab.id, title);
    if (s.status === "disconnected") reconnect();
    if (s.status === "ended") void endGuestSession(s.ended);
  };
  const offState = session.state.subscribe(sync);
  guest = { session, addr: parsed.addr, off: offState };
  sync();
  return true;
}

/** Connexion perdue : nouvelles tentatives pendant 30 s, puis fin de session (O-05 §4.4). */
function reconnect() {
  if (!guest || guest.retry !== undefined || !transport) return;
  const current = guest;
  const deadline = Date.now() + RECONNECT_FOR;
  const attempt = async () => {
    if (guest !== current) return;
    try {
      current.session.reconnect(await transport!.connect(current.addr));
      current.retry = undefined;
    } catch {
      if (Date.now() + RECONNECT_EVERY > deadline) {
        current.retry = undefined;
        return void endGuestSession("lost");
      }
      current.retry = setTimeout(() => void attempt(), RECONNECT_EVERY);
    }
  };
  current.retry = setTimeout(() => void attempt(), RECONNECT_EVERY);
}

/**
 * Fermeture de l'application : l'hôte arrête la session (les invités voient « arrêtée par
 * l'hôte », pas une perte de connexion) ; un invité la quitte (O-05 §4.4).
 */
export async function endSessionOnExit() {
  if (host) await stopSharing();
  else if (guest) {
    const { session, off, retry } = guest;
    guest = null;
    off();
    clearTimeout(retry);
    session.leave();
  }
}

/** Réponse au mot de passe demandé par l'hôte. */
export const answerPassword = (password: string) => guest?.session.answer(password);

/** Quitter la session (invité). */
export async function leaveSession() {
  guest?.session.leave();
  await endGuestSession(null);
}

/**
 * Fin de session côté invité : il garde une copie du document dans un onglet « Sans titre »
 * (D16), puis un message en donne la raison.
 */
async function endGuestSession(reason: string | null) {
  if (!guest) return;
  const { session, off, retry } = guest;
  guest = null;
  off();
  clearTimeout(retry);
  const tabId = useCollabStore.getState().tabId;
  useCollabStore.setState({
    mode: "idle",
    tabId: null,
    participants: [],
    presence: {},
    chat: [],
    unread: 0,
    you: null,
    guest: null,
  });
  if (tabId) {
    const copy = createDocumentHandle(session.snapshot());
    // Copie modifiée (non enregistrée) : rien ne se perd à la fermeture.
    copy.store.setState({ savedDoc: { ...copy.store.getState().doc } });
    replaceDocument(tabId, copy);
    setTitle(copy.id, null);
    useWorkspaceStore.setState((s) => ({
      untitled: { ...s.untitled, [copy.id]: Math.max(0, ...Object.values(s.untitled)) + 1 },
    }));
  }
  const messages: Record<string, string> = {
    stopped: t("collab.endedStopped"),
    kicked: t("collab.endedKicked"),
    lost: t("collab.endedLost"),
    "unknown-link": t("collab.endedUnknownLink"),
    "bad-password": t("collab.endedBadPassword"),
    full: t("collab.endedFull"),
  };
  if (reason && messages[reason]) {
    await alertDialog({
      title: t("collab.endedTitle"),
      message: messages[reason]!,
      ...(tabId ? { detail: t("collab.copyKept") } : {}),
      okLabel: t("common.ok"),
    });
  }
}

// ——— Assistants IA (O-05 §8) ———

/**
 * Raison pour laquelle l'assistant IA de ce poste ne peut pas modifier le document `docId`, ou
 * `null`. Seul l'onglet d'une session rejointe est concerné : l'hôte suit ses propres options
 * (O-47). Messages en anglais, comme le reste du serveur MCP.
 */
export function aiWriteRefusal(docId: string): string | null {
  const { mode, tabId, guest: state, aiAllowed } = useCollabStore.getState();
  if (mode !== "guest" || tabId !== docId || !state) return null;
  if (state.role === "reader") return "This is a read-only session: the document can be read, not changed.";
  if (!aiAllowed) return "AI assistants are disabled by the session host. Reading is still allowed.";
  if (state.status !== "connected") return "The session is reconnecting to its host: try again in a moment.";
  return null;
}

// ——— Présence ———

let presenceSent: Presence | null = null;
let presenceNext: Presence | null = null;
let presenceAt = 0;
let presenceTimer: ReturnType<typeof setTimeout> | undefined;

const samePresence = (a: Presence, b: Presence) =>
  a.view === b.view &&
  a.cursor?.x === b.cursor?.x &&
  a.cursor?.y === b.cursor?.y &&
  a.selection.join() === b.selection.join();

function flushPresence() {
  presenceTimer = undefined;
  if (!presenceNext) return;
  const value = presenceNext;
  presenceNext = null;
  presenceAt = Date.now();
  presenceSent = value;
  host?.session.setPresence(value);
  guest?.session.setPresence(value);
}

/**
 * Ma présence (vue, curseur en coordonnées du modèle, sélection) : envoyée aux autres participants,
 * au plus 20 fois par seconde ; le dernier état part toujours.
 */
export function reportPresence(value: Presence) {
  if (!host && !guest) return;
  if (presenceSent && samePresence(presenceSent, value)) {
    presenceNext = null;
    return;
  }
  presenceNext = value;
  if (presenceTimer !== undefined) return;
  const wait = PRESENCE_EVERY - (Date.now() - presenceAt);
  if (wait <= 0) flushPresence();
  else presenceTimer = setTimeout(flushPresence, wait);
}

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
  const session = host?.session ?? guest?.session;
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
  | { kind: "voice"; action: VoiceAction };

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
  if (JSON.stringify(mirror) === JSON.stringify(collabMirror())) return;
  const { views, ...rest } = mirror;
  useCollabStore.setState({
    ...rest,
    presence: Object.fromEntries(
      Object.entries(views).map(([id, view]) => [id, { view, cursor: null, selection: [], movedAt: 0 }]),
    ),
  });
}

/** Section « Session » (O-05 §7) : affichée au début d'une session, masquée à la fin. */
useCollabStore.subscribe((s, p) => {
  // Fenêtre principale seulement (une flottante reçoit sa disposition de la principale).
  if (!transport) return;
  const active = (mode: CollabMode) => mode === "host" || mode === "guest";
  if (active(s.mode) === active(p.mode)) return;
  updateDock((layout) => {
    if (!active(s.mode)) return hideSection(layout, "session");
    const shown = showSection(layout, "session");
    const found = groupOf(shown, "session");
    return found ? setActive(shown, found.group.id, "session") : shown;
  });
});

/** Identité changée dans les options : visible tout de suite par les autres (O-05 §3). */
usePreferencesStore.subscribe((s, p) => {
  if (s.identity === p.identity) return;
  const { name, color } = me();
  host?.session.setIdentity(name, color);
  guest?.session.setIdentity(name, color);
});
