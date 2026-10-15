import { Check, Copy, LogOut, Square, Users } from "lucide-react";
import { useState } from "react";
import { joinFromLink, leaveSession, setGuestsAi, shareActiveTab, stopSharing, useCollabStore } from "@/app/collab/session";
import { MIN_PASSWORD_LENGTH } from "@/app/collab/password";
import { useUiStore } from "@/app/uiStore";
import { t } from "@/i18n";
import { collabAvailable } from "@/platform/collab";
import { Checkbox, ErrorBanner, inputClass } from "@/ui/common/controls";
import { Modal } from "@/ui/common/Modal";

const primary = "rounded bg-blue-600 px-3 py-1 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50";
const secondary = "flex items-center gap-1 rounded px-3 py-1 text-sm hover:bg-neutral-100 dark:hover:bg-neutral-800";

/** Lien d'invitation, en lecture seule, avec son bouton Copier. */
function LinkRow({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium text-neutral-500 dark:text-neutral-400">{label}</span>
      <div className="flex gap-2">
        <input readOnly aria-label={label} value={value} className={`${inputClass} flex-1 font-mono text-xs`} onFocus={(e) => e.target.select()} />
        <button
          type="button"
          className={secondary}
          onClick={() => {
            void navigator.clipboard.writeText(value).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            });
          }}
        >
          {copied ? <Check size={14} /> : <Copy size={14} />}
          {copied ? t("collab.copied") : t("collab.copy")}
        </button>
      </div>
    </div>
  );
}

/**
 * Session collaborative (O-05 §4) : partager l'onglet actif (deux liens, mot de passe facultatif,
 * assistants IA des invités), rejoindre par un lien collé, arrêter ou quitter.
 */
export function ShareDialog() {
  const open = useUiStore((s) => s.shareOpen);
  const setOpen = useUiStore((s) => s.setShareOpen);
  const { mode, links, aiAllowed, error, participants } = useCollabStore();
  const [password, setPassword] = useState("");
  const [allowAi, setAllowAi] = useState(false);
  const [link, setLink] = useState("");
  if (!open) return null;

  const close = () => setOpen(false);
  const busy = mode === "starting" || mode === "joining";
  const hostName = participants.find((p) => p.role === "host")?.name ?? "?";
  const tooShort = password.length > 0 && password.length < MIN_PASSWORD_LENGTH;

  const closeButton = (
    <button type="button" className="rounded px-3 py-1 text-sm hover:bg-neutral-100 dark:hover:bg-neutral-800" onClick={close}>
      {t("common.close")}
    </button>
  );

  let body;
  let footer;
  if (!collabAvailable()) {
    body = <p className="text-sm text-neutral-600 dark:text-neutral-300">{t("collab.unavailable")}</p>;
    footer = (
      <>
        <div className="flex-1" />
        {closeButton}
      </>
    );
  } else if (mode === "host" && links) {
    body = (
      <div className="flex flex-col gap-3">
        <LinkRow label={t("collab.editLink")} value={links.edit} />
        <LinkRow label={t("collab.readLink")} value={links.read} />
        <Checkbox label={t("collab.allowAi")} checked={aiAllowed} onChange={setGuestsAi} />
      </div>
    );
    footer = (
      <>
        <button type="button" className={`${secondary} text-red-600`} onClick={() => void stopSharing()}>
          <Square size={14} /> {t("collab.stop")}
        </button>
        <div className="flex-1" />
        {closeButton}
      </>
    );
  } else if (mode === "guest") {
    body = <p className="text-sm text-neutral-600 dark:text-neutral-300">{t("collab.inSession", { host: hostName })}</p>;
    footer = (
      <>
        <button type="button" className={`${secondary} text-red-600`} onClick={() => void leaveSession()}>
          <LogOut size={14} /> {t("collab.leave")}
        </button>
        <div className="flex-1" />
        {closeButton}
      </>
    );
  } else {
    body = (
      <div className="flex flex-col gap-4">
        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold">{t("collab.shareTitle")}</h3>
          <p className="text-sm text-neutral-600 dark:text-neutral-300">{t("collab.shareHelp")}</p>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-neutral-500 dark:text-neutral-400">{t("collab.password", { n: MIN_PASSWORD_LENGTH })}</span>
            <input type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} className={inputClass} />
          </label>
          <Checkbox label={t("collab.allowAi")} checked={allowAi} onChange={setAllowAi} />
          <div>
            <button
              type="button"
              data-autofocus
              disabled={busy || tooShort}
              className={primary}
              onClick={() => void shareActiveTab({ ...(password ? { password } : {}), aiAllowed: allowAi }).then(() => setPassword(""))}
            >
              {mode === "starting" ? t("collab.starting") : t("collab.start")}
            </button>
          </div>
        </section>
        <section className="flex flex-col gap-2 border-t border-neutral-200 pt-4 dark:border-neutral-700">
          <h3 className="text-sm font-semibold">{t("collab.join")}</h3>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void joinFromLink(link).then((ok) => ok && setLink(""));
            }}
          >
            <input
              aria-label={t("collab.join")}
              value={link}
              placeholder={t("collab.joinPlaceholder")}
              onChange={(e) => setLink(e.target.value)}
              className={`${inputClass} flex-1 font-mono text-xs`}
            />
            <button type="submit" disabled={busy || !link.trim()} className={primary}>
              {mode === "joining" ? t("collab.joining") : t("collab.joinButton")}
            </button>
          </form>
        </section>
      </div>
    );
    footer = (
      <>
        <div className="flex-1" />
        {closeButton}
      </>
    );
  }

  return (
    <Modal title={t("collab.title")} icon={<Users size={16} />} onClose={close} footer={footer}>
      <ErrorBanner message={error} onClose={() => useCollabStore.setState({ error: null })} />
      <div className="mt-2">{body}</div>
    </Modal>
  );
}
