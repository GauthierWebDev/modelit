import { create } from "zustand";
import { alertDialog } from "../dialogStore";
import { createDocumentStore } from "../document/documentStore";
import { createDocumentViewStore } from "../document/documentView";
import { createDocumentHandle, type DocumentHandle } from "../document/handle";
import { documentName } from "../fileCommands";
import { usePreferencesStore } from "../preferencesStore";
import { activeDocument, addTab, replaceDocument, setTitle, useWorkspaceStore } from "../workspace";
import { t } from "@/i18n";
import { startGuest, type GuestSession } from "./guest";
import { startHost, type HostSession } from "./host";
import { displayName } from "./identity";
import { buildLink, newSecret, parseLink } from "./link";
import { MIN_PASSWORD_LENGTH, verifier } from "./password";
import type { GuestLink, HostLink, Participant } from "./protocol";

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

export type CollabMode = "idle" | "starting" | "host" | "joining" | "guest";

interface CollabState {
  mode: CollabMode;
  /** Onglet partagé (hôte) ou de la session rejointe (invité). */
  tabId: string | null;
  links: { edit: string; read: string } | null;
  participants: Participant[];
  aiAllowed: boolean;
  /** Invité : rôle, état de la connexion, mot de passe demandé. */
  guest: { role: "editor" | "reader" | null; status: GuestSession["state"] extends { getState: () => infer S } ? S extends { status: infer T } ? T : never : never; password: { attemptsLeft: number; wrong: boolean } | null } | null;
  error: string | null;
}

export const useCollabStore = create<CollabState>(() => ({ mode: "idle", tabId: null, links: null, participants: [], aiAllowed: false, guest: null, error: null }));

let host: { session: HostSession; stop: () => Promise<void>; off: () => void } | null = null;
let guest: { session: GuestSession; addr: string; off: () => void; retry?: ReturnType<typeof setTimeout> } | null = null;

const me = () => {
  const identity = usePreferencesStore.getState().identity;
  return { name: displayName(identity), color: identity.color };
};

const fail = (error: string) => useCollabStore.setState({ error });

// ——— Hôte ———

/** Partage l'onglet actif (O-05 §4.1). */
export async function shareActiveTab({ password, aiAllowed = false }: { password?: string; aiAllowed?: boolean } = {}): Promise<boolean> {
  if (!transport || useCollabStore.getState().mode !== "idle") return false;
  if (password && password.length < MIN_PASSWORD_LENGTH) return fail(t("collab.passwordTooShort", { n: MIN_PASSWORD_LENGTH })), false;
  useCollabStore.setState({ mode: "starting", error: null });
  const tab = activeDocument();
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
      ...(password ? { password: await verifier(password) } : {}),
    });
    // L'onglet garde son fichier et son état « modifié » ; son historique devient personnel.
    session.store.setState({ filePath: original.filePath, savedDoc: original.savedDoc === original.doc ? original.doc : original.savedDoc });
    replaceDocument(tab.id, { id: tab.id, store: session.store, view: tab.view });
    const sync = () => useCollabStore.setState({ participants: session.state.getState().participants, aiAllowed: session.state.getState().aiAllowed });
    const offState = session.state.subscribe(sync);
    // Onglet fermé : fin du partage.
    const offTabs = useWorkspaceStore.subscribe((s) => {
      if (!s.documents.some((d) => d.id === tab.id)) void stopSharing();
    });
    host = { session, stop: started.stop, off: () => (offState(), offTabs()) };
    useCollabStore.setState({
      mode: "host",
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
  useCollabStore.setState({ mode: "idle", tabId: null, links: null, participants: [] });
}

export const setGuestsAi = (allowed: boolean) => host?.session.setAiAllowed(allowed);
export const kick = (peer: string) => host?.session.kick(peer);

// ——— Invité ———

/** Rejoint une session par un lien d'invitation (O-05 §4.2) ; la session s'ouvre dans un nouvel onglet. */
export async function joinFromLink(url: string): Promise<boolean> {
  const parsed = parseLink(url);
  if (!parsed) return fail(t("collab.invalidLink")), false;
  if (!transport) return false;
  if (useCollabStore.getState().mode !== "idle") return fail(t("collab.alreadyInSession")), false;
  useCollabStore.setState({ mode: "joining", error: null });
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
    useCollabStore.setState({ participants: s.participants, aiAllowed: s.aiAllowed, guest: { role: s.role, status: s.status, password: s.password } });
    const hostName = s.participants.find((p) => p.role === "host")?.name;
    if (s.status === "connected" && !opened) {
      opened = true;
      addTab(tab, t("collab.tabTitle", { host: hostName ?? "?" }));
      useCollabStore.setState({ mode: "guest", tabId: tab.id });
    } else if (opened && hostName) setTitle(tab.id, t("collab.tabTitle", { host: hostName }));
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
  useCollabStore.setState({ mode: "idle", tabId: null, participants: [], guest: null });
  if (tabId) {
    const copy = createDocumentHandle(session.snapshot());
    // Copie modifiée (non enregistrée) : rien ne se perd à la fermeture.
    copy.store.setState({ savedDoc: { ...copy.store.getState().doc } });
    replaceDocument(tabId, copy);
    setTitle(copy.id, null);
    useWorkspaceStore.setState((s) => ({ untitled: { ...s.untitled, [copy.id]: Math.max(0, ...Object.values(s.untitled)) + 1 } }));
  }
  const messages: Record<string, string> = {
    stopped: t("collab.endedStopped"),
    kicked: t("collab.endedKicked"),
    lost: t("collab.endedLost"),
    "unknown-link": t("collab.endedUnknownLink"),
    "bad-password": t("collab.endedBadPassword"),
  };
  if (reason && messages[reason]) {
    await alertDialog({ title: t("collab.endedTitle"), message: messages[reason]!, ...(tabId ? { detail: t("collab.copyKept") } : {}), okLabel: t("common.ok") });
  }
}

/** Nom de l'onglet partagé, pour l'interface. */
export function sharedTabName(): string | null {
  const id = useCollabStore.getState().tabId;
  const tab = useWorkspaceStore.getState().documents.find((d) => d.id === id);
  return tab ? documentName(tab) : null;
}

/** Identité changée dans les options : visible tout de suite par les autres (O-05 §3). */
usePreferencesStore.subscribe((s, p) => {
  if (s.identity === p.identity) return;
  const { name, color } = me();
  host?.session.setIdentity(name, color);
  guest?.session.setIdentity(name, color);
});
