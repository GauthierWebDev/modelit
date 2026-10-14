import { deserializeModel, FILE_EXTENSION, ModelFileError, serializeModel } from "@core/index";
import { t } from "@/i18n";
import { openModelFile, saveModelFile } from "@/platform/files";
import { confirmDialog, showError, showWarnings } from "./dialogStore";
import { selectIsDirty, useDocumentStore } from "./documentStore";
import { newModelDocument } from "./modelDefaults";
import { useUiStore } from "./uiStore";

/** Commandes Fichier : Nouveau, Ouvrir, Enregistrer, Enregistrer sous. */

export const fileName = (path: string | null) => (path ? (path.split(/[\\/]/).pop() ?? path) : t("app.untitled"));

export async function confirmLoseChanges(): Promise<boolean> {
  const state = useDocumentStore.getState();
  if (!selectIsDirty(state)) return true;
  return confirmDialog({
    title: t("file.unsavedTitle"),
    message: t("file.unsaved", { name: fileName(state.filePath) }),
    okLabel: t("file.discard"),
    cancelLabel: t("common.cancel"),
    tone: "danger",
  });
}

export async function newDocument() {
  if (!(await confirmLoseChanges())) return;
  useDocumentStore.getState().load(newModelDocument(), null);
  useUiStore.getState().select([]);
}

export async function openDocument() {
  if (!(await confirmLoseChanges())) return;
  try {
    const file = await openModelFile(t("file.modelFilter"));
    if (!file) return;
    const { doc, warnings } = deserializeModel(file.content);
    useDocumentStore.getState().load(doc, file.path);
    useUiStore.getState().select([]);
    await showWarnings(warnings);
  } catch (e) {
    await showError(e instanceof ModelFileError ? e.message : t("file.openFailed", { error: String(e) }));
  }
}

export async function saveDocument(saveAs = false) {
  const { doc, filePath, markSaved } = useDocumentStore.getState();
  try {
    const path = await saveModelFile(
      serializeModel(doc),
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
