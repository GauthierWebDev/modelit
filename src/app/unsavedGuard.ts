import { t } from "@/i18n";
import { confirmDialog } from "./dialogStore";
import { selectIsDirty } from "./document/documentStore";
import type { DocumentHandle } from "./document/handle";
import { documentName } from "./documentNames";
import { activate, useWorkspaceStore } from "./workspace";

/** Confirmation avant de perdre des modifications non enregistrées (fermer un onglet, quitter, redémarrer). */

// biome-ignore lint/suspicious/useAwait: renvoie toujours une promesse, même quand la réponse est immédiate
export async function confirmLoseChanges(doc: DocumentHandle): Promise<boolean> {
  if (!selectIsDirty(doc.store.getState())) {
    return true;
  }
  return confirmDialog({
    title: t("file.unsavedTitle"),
    message: t("file.unsaved", { name: documentName(doc) }),
    okLabel: t("file.discard"),
    cancelLabel: t("common.cancel"),
    tone: "danger",
  });
}

/**
 * Confirme la perte des modifications de tous les documents ouverts (fermeture de la fenêtre,
 * redémarrage) : une confirmation par onglet modifié, dans l'ordre, l'onglet concerné affiché.
 */
export async function confirmLoseAllChanges(): Promise<boolean> {
  for (const doc of useWorkspaceStore.getState().documents) {
    if (!selectIsDirty(doc.store.getState())) {
      continue;
    }
    activate(doc.id);
    // biome-ignore lint/performance/noAwaitInLoops: une confirmation à la fois, l'utilisateur répond dans l'ordre
    if (!(await confirmLoseChanges(doc))) {
      return false;
    }
  }
  return true;
}
