import { deserializeModel, FILE_EXTENSION, ModelFileError, serializeModel } from "@core/index";
import { t } from "@/i18n";
import { openModelFile, saveModelFile } from "@/platform/files";
import { confirmDialog, showError, showWarnings } from "./dialogStore";
import { selectIsDirty } from "./document/documentStore";
import type { DocumentHandle } from "./document/handle";
import { useUiStore } from "./uiStore";
import { activate, closeTab, findByPath, openInTab, syncUntitled, useWorkspaceStore } from "./workspace";

/**
 * Commandes Fichier : Nouveau, Ouvrir, Enregistrer, Enregistrer sous, Fermer.
 * Nouveau et Ouvrir ouvrent un onglet (override O-44) ; les autres agissent sur le document reçu.
 */

export const fileName = (path: string | null) => (path ? (path.split(/[\\/]/).pop() ?? path) : t("app.untitled"));

/** Nom affiché d'un document : nom du fichier, ou « Sans titre N » (override O-44). */
export function documentName(
  doc: DocumentHandle,
  untitled = useWorkspaceStore.getState().untitled,
  titles = useWorkspaceStore.getState().titles,
): string {
  if (titles[doc.id]) {
    return titles[doc.id]!;
  }
  const path = doc.store.getState().filePath;
  if (path) {
    return fileName(path);
  }
  const n = untitled[doc.id] ?? 1;
  return n === 1 ? t("app.untitled") : t("app.untitledN", { n });
}

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
    if (!(await confirmLoseChanges(doc))) {
      return false;
    }
  }
  return true;
}

export function newDocument() {
  openInTab();
}

/** Nouvel onglet vierge (⌘/Ctrl + T, override O-44) : toujours un onglet de plus. */
export function newTab() {
  openInTab(undefined, { reuseBlank: false });
}

export async function openDocument() {
  try {
    const file = await openModelFile(t("file.modelFilter"));
    if (!file) {
      return;
    }
    const already = findByPath(file.path);
    if (already) {
      return activate(already.id);
    }
    const { doc: model, warnings } = deserializeModel(file.content);
    openInTab((doc) => doc.store.getState().load(model, file.path));
    await showWarnings(warnings);
  } catch (e) {
    await showError(e instanceof ModelFileError ? e.message : t("file.openFailed", { error: String(e) }));
  }
}

export async function saveDocument(doc: DocumentHandle, saveAs = false) {
  const { doc: model, filePath, markSaved } = doc.store.getState();
  try {
    const path = await saveModelFile(
      serializeModel(model),
      saveAs ? null : filePath,
      `${t("file.defaultName")}.${FILE_EXTENSION}`,
      t("file.modelFilter"),
    );
    if (!path) {
      return;
    }
    markSaved(path);
    syncUntitled(doc);
    useUiStore.getState().notify({ kind: "info", text: t("file.saved", { file: fileName(path) }) });
  } catch (e) {
    await showError(t("file.saveFailed", { error: String(e) }));
  }
}

/** Ferme l'onglet du document, après confirmation s'il est modifié (override O-44). */
export async function closeDocument(doc: DocumentHandle) {
  if (!(await confirmLoseChanges(doc))) {
    return;
  }
  closeTab(doc.id);
}
