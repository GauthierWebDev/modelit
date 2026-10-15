import { deserializeModel, FILE_EXTENSION, ModelFileError, serializeModel } from "@core/index";
import { t } from "@/i18n";
import { openModelFile, saveModelFile } from "@/platform/files";
import { confirmDialog, showError, showWarnings } from "./dialogStore";
import { selectIsDirty } from "./document/documentStore";
import type { DocumentHandle } from "./document/handle";
import { newModelDocument } from "./modelDefaults";
import { useUiStore } from "./uiStore";
import { useWorkspaceStore } from "./workspace";

/**
 * Commandes Fichier : Nouveau, Ouvrir, Enregistrer, Enregistrer sous. Elles agissent sur le
 * document reçu ; Nouveau et Ouvrir le remplacent (en attendant les onglets, J-01 phase 2).
 */

export const fileName = (path: string | null) => (path ? (path.split(/[\\/]/).pop() ?? path) : t("app.untitled"));

export async function confirmLoseChanges(doc: DocumentHandle): Promise<boolean> {
  const state = doc.store.getState();
  if (!selectIsDirty(state)) return true;
  return confirmDialog({
    title: t("file.unsavedTitle"),
    message: t("file.unsaved", { name: fileName(state.filePath) }),
    okLabel: t("file.discard"),
    cancelLabel: t("common.cancel"),
    tone: "danger",
  });
}

/** Confirme la perte des modifications de tous les documents ouverts (redémarrage, fermeture). */
export async function confirmLoseAllChanges(): Promise<boolean> {
  for (const doc of useWorkspaceStore.getState().documents) {
    if (!(await confirmLoseChanges(doc))) return false;
  }
  return true;
}

export async function newDocument(doc: DocumentHandle) {
  if (!(await confirmLoseChanges(doc))) return;
  doc.store.getState().load(newModelDocument(), null);
  doc.view.getState().select([]);
}

export async function openDocument(doc: DocumentHandle) {
  if (!(await confirmLoseChanges(doc))) return;
  try {
    const file = await openModelFile(t("file.modelFilter"));
    if (!file) return;
    const { doc: model, warnings } = deserializeModel(file.content);
    doc.store.getState().load(model, file.path);
    doc.view.getState().select([]);
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
    if (!path) return;
    markSaved(path);
    useUiStore.getState().notify({ kind: "info", text: t("file.saved", { file: fileName(path) }) });
  } catch (e) {
    await showError(t("file.saveFailed", { error: String(e) }));
  }
}
