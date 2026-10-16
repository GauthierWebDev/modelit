import { Copy, LogOut, Send, Square, Users, UserX } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { CHAT_MAX, type ChatMessage, type Role } from "@/app/collab/protocol";
import type { CollabAction } from "@/app/collab/session";
import { useCollabStore } from "@/app/collab/session";
import { useUiStore } from "@/app/uiStore";
import { type MessageKey, t } from "@/i18n";
import { Checkbox } from "@/ui/common/controls";
import { tip } from "@/ui/common/Tooltip";
import { mainCommand } from "@/ui/windows/mainCommands";

/** Actions de session : exécutées par la fenêtre principale, même depuis une section flottante. */
const act = (action: CollabAction) => mainCommand({ name: "collab", action });

const ROLE_LABEL: Record<Role, MessageKey> = {
  host: "collab.role.host",
  editor: "collab.role.editor",
  reader: "collab.role.reader",
};
const VIEW_LABEL = { mcd: "MCD", mld: "MLD", mpd: "MPD" } as const;

/** Libellé de l'onglet : badge des messages non lus (O-05 §6). */
export function SessionTitle() {
  const unread = useCollabStore((s) => s.unread);
  return (
    <span className="flex items-center gap-1">
      {t("dock.section.session")}
      {unread > 0 && (
        <span
          className="min-w-4 rounded-full bg-blue-600 px-1 text-center text-[10px] leading-4 font-semibold text-white"
          aria-label={t("collab.unread", { n: unread })}
        >
          {unread > 99 ? "99+" : unread}
        </span>
      )}
    </span>
  );
}

const time = (at: number) => new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

function ChatLine({ message }: { message: ChatMessage }) {
  if (message.kind !== "text") {
    const key = { joined: "collab.chat.joined", left: "collab.chat.left", kicked: "collab.chat.kicked" }[
      message.kind
    ] as MessageKey;
    return (
      <li className="px-1 text-xs text-neutral-500 italic dark:text-neutral-400">{t(key, { name: message.name })}</li>
    );
  }
  return (
    <li className="px-1 text-sm">
      <span className="font-semibold" style={{ color: message.color }}>
        {message.name}
      </span>
      <span className="ml-1.5 text-[10px] text-neutral-400 tabular-nums">{time(message.at)}</span>
      <p className="break-words whitespace-pre-wrap">{message.text}</p>
    </li>
  );
}

function Chat() {
  const chat = useCollabStore((s) => s.chat);
  const unread = useCollabStore((s) => s.unread);
  const [text, setText] = useState("");
  const list = useRef<HTMLUListElement>(null);

  // Section affichée : les messages sont lus ; la liste suit le dernier message.
  useEffect(() => {
    if (unread) act({ kind: "read" });
    list.current?.scrollTo({ top: list.current.scrollHeight });
  }, [chat.length, unread]);

  const send = () => {
    if (!text.trim()) return;
    act({ kind: "chat", text });
    setText("");
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col border-t border-neutral-200 dark:border-neutral-700">
      <ul
        ref={list}
        aria-label={t("collab.chat")}
        className="flex min-h-16 flex-1 flex-col gap-1.5 overflow-y-auto py-2"
      >
        {chat.length === 0 && <li className="px-1 text-xs text-neutral-400">{t("collab.chat.empty")}</li>}
        {chat.map((m) => (
          <ChatLine key={m.id} message={m} />
        ))}
      </ul>
      <form
        className="flex items-end gap-1 border-t border-neutral-200 pt-2 dark:border-neutral-700"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <textarea
          rows={1}
          value={text}
          maxLength={CHAT_MAX}
          aria-label={t("collab.chat.placeholder")}
          placeholder={t("collab.chat.placeholder")}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            // Entrée envoie, Maj+Entrée passe à la ligne.
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              send();
            }
          }}
          className="max-h-24 min-h-7 flex-1 resize-none rounded border border-neutral-300 bg-white px-2 py-1 text-sm outline-none focus:border-blue-500 dark:border-neutral-600 dark:bg-neutral-800"
        />
        <button
          type="submit"
          disabled={!text.trim()}
          aria-label={t("collab.chat.send")}
          {...tip(t("collab.chat.send"))}
          className="flex h-7 w-7 items-center justify-center rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40"
        >
          <Send size={14} />
        </button>
      </form>
    </div>
  );
}

/**
 * Section « Session » (O-05 §7) : état et liens (hôte), participants avec leur rôle et leur vue,
 * chat, commandes (arrêter le partage, quitter, exclure, assistants IA des invités).
 */
export function SessionSection() {
  const { mode, links, participants, presence, you, aiAllowed } = useCollabStore();
  const [copied, setCopied] = useState<string | null>(null);

  if (mode !== "host" && mode !== "guest") {
    return (
      <div className="flex flex-col items-start gap-2 p-3 text-sm text-neutral-500 dark:text-neutral-400">
        <p>{t("collab.none")}</p>
        <button
          type="button"
          className="flex items-center gap-1 rounded border border-neutral-300 px-2 py-0.5 hover:bg-neutral-100 dark:border-neutral-600 dark:hover:bg-neutral-800"
          onClick={() => useUiStore.getState().setShareOpen(true)}
        >
          <Users size={14} /> {t("collab.shareOrJoin")}
        </button>
      </div>
    );
  }

  const isHost = mode === "host";
  const copy = (what: string, value: string) => {
    void navigator.clipboard.writeText(value);
    setCopied(what);
    setTimeout(() => setCopied(null), 1500);
  };
  const small = "flex items-center gap-1 rounded px-1.5 py-0.5 text-xs hover:bg-neutral-200 dark:hover:bg-neutral-700";

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 p-2">
      <div className="flex flex-wrap items-center gap-1">
        {isHost && links && (
          <>
            <button type="button" className={small} onClick={() => copy("edit", links.edit)}>
              <Copy size={12} /> {copied === "edit" ? t("collab.copied") : t("collab.editLink")}
            </button>
            <button type="button" className={small} onClick={() => copy("read", links.read)}>
              <Copy size={12} /> {copied === "read" ? t("collab.copied") : t("collab.readLink")}
            </button>
          </>
        )}
        <div className="flex-1" />
        <button
          type="button"
          className={`${small} text-red-600 dark:text-red-400`}
          onClick={() => act({ kind: isHost ? "stop" : "leave" })}
        >
          {isHost ? <Square size={12} /> : <LogOut size={12} />}
          {isHost ? t("collab.stop") : t("collab.leave")}
        </button>
      </div>
      {isHost && (
        <Checkbox
          label={t("collab.allowAi")}
          checked={aiAllowed}
          onChange={(allowed) => act({ kind: "guestsAi", allowed })}
        />
      )}

      <ul aria-label={t("collab.participantsList")} className="flex flex-col gap-0.5">
        {participants.map((p) => {
          const view = presence[p.id]?.view;
          return (
            <li
              key={p.id}
              className="group flex items-center gap-2 rounded px-1 py-0.5 text-sm hover:bg-neutral-100 dark:hover:bg-neutral-800"
            >
              <span className="h-2.5 w-2.5 flex-none rounded-full" style={{ background: p.color }} />
              <span className="min-w-0 truncate">
                {p.name}
                {p.id === you && <span className="text-neutral-400"> ({t("collab.you")})</span>}
              </span>
              <span className="text-xs text-neutral-400">{t(ROLE_LABEL[p.role])}</span>
              <div className="flex-1" />
              {view && p.id !== you && (
                <span className="text-[10px] font-semibold text-neutral-400">{VIEW_LABEL[view]}</span>
              )}
              {isHost && p.role !== "host" && (
                <button
                  type="button"
                  aria-label={t("collab.kick", { name: p.name })}
                  {...tip(t("collab.kick", { name: p.name }))}
                  className="invisible rounded p-0.5 text-neutral-500 group-hover:visible hover:bg-red-100 hover:text-red-600 focus:visible dark:hover:bg-red-950"
                  onClick={() => act({ kind: "kick", peer: p.id })}
                >
                  <UserX size={13} />
                </button>
              )}
            </li>
          );
        })}
      </ul>
      <Chat />
    </div>
  );
}
