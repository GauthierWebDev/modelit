import { AlertTriangle, CircleX, Info } from "lucide-react";
import { useId } from "react";
import { type DialogTone, settleDialog, useDialogStore } from "@/app/dialogStore";
import { Modal } from "./Modal";

const ICONS: Record<DialogTone, { icon: typeof Info; className: string }> = {
  info: { icon: Info, className: "text-blue-600 dark:text-blue-400" },
  warning: { icon: AlertTriangle, className: "text-amber-500" },
  danger: { icon: AlertTriangle, className: "text-red-600 dark:text-red-400" },
  error: { icon: CircleX, className: "text-red-600 dark:text-red-400" },
};

const secondary =
  "rounded px-3 py-1 text-sm hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-blue-500 dark:hover:bg-neutral-800";
const primary = {
  default:
    "rounded bg-blue-600 px-3 py-1 text-sm font-medium text-white hover:bg-blue-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500",
  danger:
    "rounded bg-red-600 px-3 py-1 text-sm font-medium text-white hover:bg-red-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-500",
};

/**
 * Affiche les confirmations et alertes de l'application (file de `dialogStore`), une à la fois,
 * au-dessus de toute autre boîte. Échap ou clic hors de la boîte : Annuler (confirmation) / Fermer.
 */
export function DialogHost() {
  const request = useDialogStore((s) => s.queue[0]);
  const descriptionId = useId();
  if (!request) return null;
  const { icon: Icon, className } = ICONS[request.tone];
  const cancel = () => settleDialog(request.id, false);
  const ok = () => settleDialog(request.id, true);
  // Action destructrice : le focus initial va sur Annuler, pour qu'Entrée ne fasse rien perdre.
  const safeFirst = request.kind === "confirm" && request.tone === "danger";
  return (
    <Modal
      key={request.id}
      title={request.title}
      onClose={cancel}
      role="alertdialog"
      describedBy={descriptionId}
      width="w-[28rem]"
      layer="z-[60]"
      icon={<Icon size={18} className={`flex-none ${className}`} aria-hidden />}
      footer={
        <>
          <div className="flex-1" />
          {request.kind === "confirm" && (
            <button
              type="button"
              className={secondary}
              onClick={cancel}
              {...(safeFirst ? { "data-autofocus": "" } : {})}
            >
              {request.cancelLabel}
            </button>
          )}
          <button
            type="button"
            className={request.tone === "danger" ? primary.danger : primary.default}
            onClick={ok}
            {...(safeFirst ? {} : { "data-autofocus": "" })}
          >
            {request.okLabel}
          </button>
        </>
      }
    >
      <div id={descriptionId}>
        <p className="whitespace-pre-line text-sm">{request.message}</p>
        {request.detail && (
          <p className="mt-2 whitespace-pre-line text-sm text-neutral-600 dark:text-neutral-300">{request.detail}</p>
        )}
      </div>
    </Modal>
  );
}
