import { create } from "zustand";
import { t } from "@/i18n";

/**
 * Boîtes de dialogue de l'application (confirmation, alerte), à la place des dialogues natifs
 * (window.confirm / alert, plugin dialog de Tauri) : même apparence partout, thème respecté.
 * Les demandes sont mises en file et affichées une à une par `ui/common/DialogHost`.
 */

export type DialogTone = "info" | "warning" | "danger" | "error";

export interface DialogRequest {
  id: number;
  kind: "confirm" | "alert";
  title: string;
  message: string;
  /** Texte complémentaire, plus discret (détail, liste). */
  detail?: string;
  okLabel: string;
  cancelLabel?: string;
  /** `danger` : l'action proposée fait perdre des données (focus initial sur Annuler). */
  tone: DialogTone;
  resolve: (ok: boolean) => void;
}

interface DialogState {
  queue: DialogRequest[];
}

export const useDialogStore = create<DialogState>(() => ({ queue: [] }));

let nextId = 1;

function enqueue(request: Omit<DialogRequest, "id" | "resolve">): Promise<boolean> {
  return new Promise((resolve) => {
    const id = nextId++;
    useDialogStore.setState((s) => ({ queue: [...s.queue, { ...request, id, resolve }] }));
  });
}

/** Demande une confirmation ; `true` si l'utilisateur valide, `false` s'il annule (Échap, clic hors de la boîte). */
export function confirmDialog(options: {
  title: string;
  message: string;
  detail?: string;
  okLabel: string;
  cancelLabel: string;
  tone?: DialogTone;
}): Promise<boolean> {
  return enqueue({ kind: "confirm", tone: "warning", ...options });
}

/** Affiche un message ; la promesse se résout à la fermeture. */
export async function alertDialog(options: { title: string; message: string; detail?: string; okLabel: string; tone?: DialogTone }): Promise<void> {
  await enqueue({ kind: "alert", tone: "error", ...options });
}

/** Clôt une boîte (réponse de l'utilisateur) et passe à la suivante. */
export function settleDialog(id: number, ok: boolean) {
  const request = useDialogStore.getState().queue.find((r) => r.id === id);
  if (!request) return;
  useDialogStore.setState((s) => ({ queue: s.queue.filter((r) => r.id !== id) }));
  request.resolve(ok);
}

/** Erreur (ouverture, enregistrement, export…). */
export const showError = (message: string) => alertDialog({ title: t("common.error"), message, okLabel: t("common.ok") });

/** Avertissements groupés en une seule boîte (ex. à l'ouverture d'un fichier). */
export async function showWarnings(messages: string[]) {
  if (!messages.length) return;
  await alertDialog({
    title: t("common.warning"),
    tone: "warning",
    message: messages.length === 1 ? messages[0]! : t("common.warnings", { count: messages.length }),
    ...(messages.length > 1 ? { detail: messages.map((m) => `• ${m}`).join("\n") } : {}),
    okLabel: t("common.ok"),
  });
}
