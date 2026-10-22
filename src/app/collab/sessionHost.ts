import { t } from "@/i18n";
import { confirmDialog } from "../dialogStore";
import { createDocumentStore } from "../document/documentStore";
import type { DocumentHandle } from "../document/handle";
import { documentName } from "../fileCommands";
import { activeDocument, replaceDocument, useWorkspaceStore } from "../workspace";
import { type HostSession, startHost } from "./host";
import { buildLink, newSecret } from "./link";
import { MIN_PASSWORD_LENGTH, verifier } from "./password";
import { MAX_DOCUMENT_BYTES } from "./protocol";
import { forgetSentPresence } from "./sessionPresence";
import { type CollabTransport, fail, live, me, trackChat, trackPresence, useCollabStore } from "./sessionState";

/** Partage l'onglet actif (O-05 §4.1). */
export async function shareActiveTab({
  password,
  aiAllowed = false,
}: {
  password?: string;
  aiAllowed?: boolean;
} = {}): Promise<boolean> {
  if (!live.transport || useCollabStore.getState().mode !== "idle") {
    return false;
  }
  if (password && password.length < MIN_PASSWORD_LENGTH) {
    return fail(t("collab.passwordTooShort", { n: MIN_PASSWORD_LENGTH }));
  }
  const tab = activeDocument();
  if (new TextEncoder().encode(JSON.stringify(tab.store.getState().doc)).length > MAX_DOCUMENT_BYTES) {
    return fail(t("collab.tooLarge"));
  }
  useCollabStore.setState({ mode: "starting", error: null });
  forgetSentPresence();
  try {
    await startSharing(live.transport, tab, password, aiAllowed);
    return true;
  } catch (e) {
    useCollabStore.setState({ mode: "idle", error: t("collab.startFailed", { error: String(e) }) });
    return false;
  }
}

/** Démarre l'écoute et l'hôte ; l'onglet passe sur le document de la session. */
async function startSharing(
  transport: CollabTransport,
  tab: DocumentHandle,
  password: string | undefined,
  aiAllowed: boolean,
) {
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
  const sync = followHostSession(session, tab, started.stop);
  useCollabStore.setState({
    mode: "host",
    you: "host",
    tabId: tab.id,
    links: { edit: buildLink(started.addr, secrets.editor), read: buildLink(started.addr, secrets.reader) },
  });
  sync();
}

/** État de l'hôte reflété dans l'interface ; fin du partage si l'onglet est fermé. Renvoie la synchronisation. */
function followHostSession(session: HostSession, tab: DocumentHandle, stop: () => Promise<void>) {
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
    if (!s.documents.some((d) => d.id === tab.id)) {
      void stopSharing();
    }
  });
  live.host = {
    session,
    stop,
    off: () => {
      offState();
      offTabs();
    },
  };
  return sync;
}

/** Arrête le partage pour tous (O-05 §4.4) ; l'onglet redevient un document ordinaire. */
export async function stopSharing() {
  if (!live.host) {
    return;
  }
  const { session, stop, off } = live.host;
  live.host = null;
  off();
  session.stop();
  await stop();
  const { tabId } = useCollabStore.getState();
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

export const setGuestsAi = (allowed: boolean) => live.host?.session.setAiAllowed(allowed);

export const kick = (peer: string) => live.host?.session.kick(peer);

/** Exclusion demandée depuis la liste des participants : confirmée d'abord (O-05 §4.3). */
export async function confirmKick(peer: string) {
  const name = useCollabStore.getState().participants.find((p) => p.id === peer)?.name;
  if (!name) {
    return;
  }
  const ok = await confirmDialog({
    title: t("collab.kickTitle"),
    message: t("collab.kickConfirm", { name }),
    okLabel: t("collab.kickOk"),
    cancelLabel: t("common.cancel"),
  });
  if (ok) {
    kick(peer);
  }
}

// ——— Invité ———
