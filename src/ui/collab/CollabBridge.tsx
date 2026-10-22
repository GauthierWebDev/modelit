import { KeyRound } from "lucide-react";
import { useId, useState } from "react";
import { answerPassword, leaveSession, useCollabStore } from "@/app/collab/session";
import { t } from "@/i18n";
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
 * Boîtes des sessions collaboratives propres à la fenêtre principale : mot de passe demandé par l'hôte
 * (O-05 §4.2). Le transport, le vocal et les liens `modelit://` sont branchés par `src/bootstrap.ts`.
 */
export function CollabBridge() {
  return <PasswordPrompt />;
}
