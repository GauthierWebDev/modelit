import { Copy, HeadphoneOff, Headphones, LogOut, Mic, MicOff, Send, Square, Users, UserX } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { CHAT_MAX, type ChatMessage, type Role } from "@/app/collab/protocol";
import type { CollabAction } from "@/app/collab/session";
import { useCollabStore } from "@/app/collab/session";
import { useSpeakingStore } from "@/app/collab/voice/speaking";
import { useUiStore } from "@/app/uiStore";
import { type MessageKey, t } from "@/i18n";
import { Checkbox } from "@/ui/common/controls";
import { tip } from "@/ui/common/Tooltip";
import { MOD } from "@/ui/shortcuts";
import { mainCommand } from "@/ui/windows/mainCommands";

/** Actions de session : exécutées par la fenêtre principale, même depuis une section flottante. */
const act = (action: CollabAction) => mainCommand({ name: "collab", action });

const ROLE_LABEL: Record<Role, MessageKey> = {
  host: "collab.role.host",
  editor: "collab.role.editor",
  reader: "collab.role.reader",
};
const VIEW_LABEL = { mcd: "MCD", mld: "MLD", mpd: "MPD" } as const;

const voiceAct = (action: Extract<CollabAction, { kind: "voice" }>["action"]) => act({ kind: "voice", action });

/** Vocal (O-48) : rejoindre / quitter l'audio, micro, raisons d'une écoute seule ou d'une indisponibilité. */
function VoiceBar() {
  const voice = useCollabStore((s) => s.voice);
  const button = "flex items-center gap-1 rounded px-2 py-1 text-xs font-medium";
  if (voice.status !== "on") {
    return (
      <div className="flex flex-col gap-1">
        <button
          type="button"
          disabled={voice.status === "starting"}
          className={`${button} self-start bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-60`}
          onClick={() => voiceAct({ kind: "join" })}
        >
          <Headphones size={14} />
          {voice.status === "starting" ? t("voice.joining") : t("voice.join")}
        </button>
        {voice.unavailable === "no-codec" && (
          <p className="text-xs text-amber-700 dark:text-amber-400">{t("voice.unavailable")}</p>
        )}
        {voice.micError && voice.status === "off" && (
          <p className="text-xs text-red-600 dark:text-red-400">{t("voice.failed", { error: voice.micError })}</p>
        )}
      </div>
    );
  }
  const muteLabel = `${voice.muted ? t("voice.unmute") : t("voice.mute")} (⇧${MOD}M)`;
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1">
        <button
          type="button"
          disabled={!voice.mic}
          aria-pressed={voice.muted}
          aria-label={muteLabel}
          {...tip(voice.mic ? muteLabel : t("voice.listenOnly"))}
          className={`${button} ${voice.muted ? "bg-red-600 text-white hover:bg-red-700" : "bg-neutral-200 hover:bg-neutral-300 dark:bg-neutral-700 dark:hover:bg-neutral-600"} disabled:opacity-60`}
          onClick={() => voiceAct({ kind: "mute", muted: !voice.muted })}
        >
          {voice.muted ? <MicOff size={14} /> : <Mic size={14} />}
          {voice.muted ? t("voice.muted") : t("voice.micOn")}
        </button>
        <button
          type="button"
          className={`${button} hover:bg-neutral-200 dark:hover:bg-neutral-700`}
          onClick={() => voiceAct({ kind: "leave" })}
        >
          <HeadphoneOff size={14} /> {t("voice.leave")}
        </button>
      </div>
      {!voice.mic && (
        <p className="text-xs text-amber-700 dark:text-amber-400">
          {voice.unavailable === "no-media" ? t("voice.noMicSupport") : t("voice.micDenied")}
        </p>
      )}
    </div>
  );
}

/** Libellé de l'onglet : badge des messages non lus (O-05 §6). */
export function SessionTitle() {
  const unread = useCollabStore((s) => s.unread);
  return (
    <span className="flex items-center gap-1">
      {t("dock.section.session")}
      {unread > 0 && (
        <span
          role="img"
          className="min-w-4 rounded-full bg-blue-600 px-1 text-center text-[10px] leading-4 font-semibold text-white"
          aria-label={t("collab.unread", { n: unread })}
        >
          {/* biome-ignore lint/suspicious/noLeakedRender: compteur affiché volontairement, toujours > 0 ici */}
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
  // biome-ignore lint/correctness/useExhaustiveDependencies: défiler à chaque nouveau message
  useEffect(() => {
    if (unread) {
      act({ kind: "read" });
    }
    list.current?.scrollTo({ top: list.current.scrollHeight });
  }, [chat.length, unread]);

  const send = () => {
    if (!text.trim()) {
      return;
    }
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
  const { mode, links, participants, presence, you, aiAllowed, voice } = useCollabStore();
  const speaking = useSpeakingStore((s) => s.ids);
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
        {isHost && links ? (
          <>
            <button type="button" className={small} onClick={() => copy("edit", links.edit)}>
              <Copy size={12} /> {copied === "edit" ? t("collab.copied") : t("collab.editLink")}
            </button>
            <button type="button" className={small} onClick={() => copy("read", links.read)}>
              <Copy size={12} /> {copied === "read" ? t("collab.copied") : t("collab.readLink")}
            </button>
          </>
        ) : null}
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
      <VoiceBar />

      <ul aria-label={t("collab.participantsList")} className="flex flex-col gap-0.5">
        {participants.map((p) => {
          const view = presence[p.id]?.view;
          const talking = speaking.includes(p.id);
          const volume = Math.round((voice.volumes[p.id] ?? 1) * 100);
          return (
            <li
              key={p.id}
              className="group flex items-center gap-2 rounded px-1 py-0.5 text-sm hover:bg-neutral-100 dark:hover:bg-neutral-800"
            >
              <span
                className="h-2.5 w-2.5 flex-none rounded-full transition-shadow"
                style={{ background: p.color, boxShadow: talking ? `0 0 0 3px ${p.color}55` : undefined }}
              />
              <span
                className={`min-w-0 truncate ${talking ? "font-semibold" : ""}`}
                {...(talking ? { "data-speaking": "" } : {})}
              >
                {p.name}
                {p.id === you && <span className="text-neutral-400"> ({t("collab.you")})</span>}
              </span>
              <span className="text-xs text-neutral-400">{t(ROLE_LABEL[p.role])}</span>
              {p.audio ? (
                <span
                  className="flex flex-none items-center text-neutral-500"
                  {...tip(p.audio.muted ? t("voice.theyMuted") : t("voice.theyIn"))}
                >
                  {p.audio.muted ? (
                    <MicOff size={12} className="text-red-500" aria-label={t("voice.theyMuted")} />
                  ) : (
                    <Headphones size={12} aria-label={t("voice.theyIn")} />
                  )}
                </span>
              ) : null}
              <div className="flex-1" />
              {voice.status === "on" && p.audio && p.id !== you && volume !== 100 && (
                <span className="text-[10px] text-neutral-400 tabular-nums group-focus-within:hidden group-hover:hidden">
                  {volume} %
                </span>
              )}
              {voice.status === "on" && p.audio && p.id !== you && (
                <input
                  type="range"
                  min={0}
                  max={200}
                  step={5}
                  value={volume}
                  aria-label={t("voice.volume", { name: p.name, n: volume })}
                  {...tip(t("voice.volume", { name: p.name, n: volume }))}
                  className="hidden w-16 accent-emerald-600 group-focus-within:block group-hover:block"
                  onChange={(e) => voiceAct({ kind: "volume", peer: p.id, gain: Number(e.target.value) / 100 })}
                />
              )}
              {view && p.id !== you && (
                <span
                  className={`text-[10px] font-semibold text-neutral-400 ${voice.status === "on" && p.audio ? "group-focus-within:hidden group-hover:hidden" : ""}`}
                >
                  {VIEW_LABEL[view]}
                </span>
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
