import { KeyRound } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { answerPassword, joinFromLink, leaveSession, setCollabTransport, useCollabStore } from "@/app/collab/session";
import { setVoiceBackend } from "@/app/collab/voice/voiceSession";
import { useUiStore } from "@/app/uiStore";
import { t } from "@/i18n";
import { collabAvailable, connectGuestTransport, onOpenLink, startHostTransport } from "@/platform/collab";
import { startVoice, voiceSupport } from "@/platform/voice";
import { inputClass } from "@/ui/common/controls";
import { Modal } from "@/ui/common/Modal";

/** Mot de passe demandé par l'hôte d'une session rejointe (O-05 §4.2). */
function PasswordPrompt() {
  // Identifiant unique : le bouton du pied de la boîte soumet ce formulaire.
  const formId = useId();
  const password = useCollabStore((s) => (s.guest?.status === "password" ? s.guest.password : null));
  const [value, setValue] = useState("");
  const [sending, setSending] = useState(false);
  if (!password) {
    return null;
  }
  const submit = async () => {
    setSending(true);
    await answerPassword(value);
    setValue("");
    setSending(false);
  };
  return (
    <Modal
      title={t("collab.passwordTitle")}
      icon={<KeyRound size={16} />}
      width="w-[26rem]"
      onClose={() => void leaveSession()}
      footer={
        <>
          <div className="flex-1" />
          <button
            type="button"
            className="rounded px-3 py-1 text-sm hover:bg-neutral-100 dark:hover:bg-neutral-800"
            onClick={() => void leaveSession()}
          >
            {t("common.cancel")}
          </button>
          <button
            type="submit"
            form={formId}
            disabled={!value || sending}
            className="rounded bg-blue-600 px-3 py-1 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {t("collab.joinButton")}
          </button>
        </>
      }
    >
      <form
        id={formId}
        className="flex flex-col gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <p className="text-sm text-neutral-600 dark:text-neutral-300">
          {password.wrong ? t("collab.passwordWrong", { n: password.attemptsLeft }) : t("collab.passwordPrompt")}
        </p>
        <input
          type="password"
          data-autofocus={true}
          aria-label={t("collab.passwordTitle")}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className={inputClass}
        />
      </form>
    </Modal>
  );
}

/**
 * Raccorde les sessions collaboratives au transport natif et aux liens `modelit://` ouverts depuis
 * le système (O-05 §4.2) : un lien reçu ouvre la boîte de session, qui en montre l'avancement.
 */
export function CollabBridge() {
  useEffect(() => {
    if (!collabAvailable()) {
      return;
    }
    setCollabTransport({ startHost: startHostTransport, connect: connectGuestTransport });
    setVoiceBackend({ support: voiceSupport, start: startVoice });
    let off: (() => void) | undefined;
    let disposed = false;
    void onOpenLink((url) => {
      useUiStore.getState().setShareOpen(true);
      void joinFromLink(url);
    }).then((f) => {
      if (disposed) {
        f();
      } else {
        off = f;
      }
    });
    return () => {
      disposed = true;
      off?.();
    };
  }, []);
  return <PasswordPrompt />;
}
