import { t } from "@/i18n";
import { alertDialog } from "../dialogStore";
import { createDocumentViewStore } from "../document/documentView";
import { createDocumentHandle, type DocumentHandle } from "../document/handle";
import { addTab, replaceDocument, setTitle, useWorkspaceStore } from "../workspace";
import { startGuest } from "./guest";
import { parseLink } from "./link";
import type { GuestLink } from "./protocol";
import { forgetSentPresence } from "./sessionPresence";
import {
  fail,
  live,
  me,
  RECONNECT_EVERY,
  RECONNECT_FOR,
  trackChat,
  trackPresence,
  useCollabStore,
} from "./sessionState";

/** Rejoint une session par un lien d'invitation (O-05 §4.2) ; la session s'ouvre dans un nouvel onglet. */
export async function joinFromLink(url: string): Promise<boolean> {
  const parsed = parseLink(url);
  if (!parsed) {
    return fail(t("collab.invalidLink"));
  }
  if (!live.transport) {
    return false;
  }
  if (useCollabStore.getState().mode !== "idle") {
    return fail(t("collab.alreadyInSession"));
  }
  useCollabStore.setState({ mode: "joining", error: null });
  forgetSentPresence();
  let link: GuestLink;
  try {
    link = await live.transport.connect(parsed.addr);
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
    } else if (opened) {
      setTitle(tab.id, title);
    }
    if (s.status === "disconnected") {
      reconnect();
    }
    if (s.status === "ended") {
      void endGuestSession(s.ended);
    }
  };
  const offState = session.state.subscribe(sync);
  live.guest = { session, addr: parsed.addr, off: offState };
  sync();
  return true;
}

/** Connexion perdue : nouvelles tentatives pendant 30 s, puis fin de session (O-05 §4.4). */
function reconnect() {
  if (!live.guest || live.guest.retry !== undefined || !live.transport) {
    return;
  }
  const current = live.guest;
  const deadline = Date.now() + RECONNECT_FOR;
  const attempt = async () => {
    if (live.guest !== current) {
      return;
    }
    try {
      current.session.reconnect(await live.transport!.connect(current.addr));
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
export const answerPassword = (password: string) => live.guest?.session.answer(password);

/** Quitter la session (invité). */
export async function leaveSession() {
  live.guest?.session.leave();
  await endGuestSession(null);
}

/**
 * Fin de session côté invité : il garde une copie du document dans un onglet « Sans titre »
 * (D16), puis un message en donne la raison.
 */
async function endGuestSession(reason: string | null) {
  if (!live.guest) {
    return;
  }
  const { session, off, retry } = live.guest;
  live.guest = null;
  off();
  clearTimeout(retry);
  const { tabId } = useCollabStore.getState();
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
