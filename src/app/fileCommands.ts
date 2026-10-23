import { deserializeModel, FILE_EXTENSION, ModelFileError, serializeModel } from "@core/index";
import { t } from "@/i18n";
import { showError, showWarnings } from "./dialogStore";
import type { DocumentHandle } from "./document/handle";
import { fileName } from "./documentNames";
import { fileAccess } from "./fileAccess";
import { useUiStore } from "./uiStore";
import { confirmLoseChanges } from "./unsavedGuard";
import { activate, closeTab, findByPath, openInTab, syncUntitled } from "./workspace";

/**
 * Commandes Fichier : Nouveau, Ouvrir, Enregistrer, Enregistrer sous, Fermer.
 * Nouveau et Ouvrir ouvrent un onglet (override O-44) ; les autres agissent sur le document reçu.
 */

export function newDocument() {
  openInTab();
}

/** Nouvel onglet vierge (⌘/Ctrl + T, override O-44) : toujours un onglet de plus. */
export function newTab() {
  openInTab(undefined, { reuseBlank: false });
}

export async function openDocument() {
  try {
    const file = await fileAccess().openModel(t("file.modelFilter"));
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
    const path = await fileAccess().saveModel(
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
