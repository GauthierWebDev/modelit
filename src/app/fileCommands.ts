import { deserializeModel, FILE_EXTENSION, ModelFileError, serializeModel } from "@core/index";
import { t } from "@/i18n";
import { useCollabStore } from "./collab/session";
import { confirmDialog, showError, showWarnings } from "./dialogStore";
import { selectIsDirty } from "./document/documentStore";
import type { DocumentHandle } from "./document/handle";
import { documentName, fileName } from "./documentNames";
import { fileAccess, type OpenedFile } from "./fileAccess";
import { forgetRecent, rememberRecent } from "./recentFiles";
import { useUiStore } from "./uiStore";
import { confirmLoseChanges } from "./unsavedGuard";
import { activate, closeTab, findByPath, openInTab, syncUntitled } from "./workspace";

/**
 * Commandes Fichier : Nouveau, Ouvrir (dialogue ou chemin), Rouvrir sans sauvegarder, Enregistrer, Enregistrer
 * sous, Fermer.
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
    if (file) {
      await openFile(file);
    }
  } catch (e) {
    await showOpenError(e);
  }
}

/** Modèle lu : son onglet s'il est déjà ouvert (O-44), sinon un nouvel onglet ; retenu dans les récents (O-65). */
async function openFile(file: OpenedFile) {
  rememberRecent(file.path);
  const already = findByPath(file.path);
  if (already) {
    return activate(already.id);
  }
  const { doc: model, warnings } = deserializeModel(file.content);
  openInTab((doc) => doc.store.getState().load(model, file.path));
  await showWarnings(warnings);
}

const showOpenError = (e: unknown) =>
  showError(e instanceof ModelFileError ? e.message : t("file.openFailed", { error: String(e) }));

/**
 * Ouvre un modèle désigné par son chemin (récents O-65, glisser-déposer O-66, ligne de commande O-68). Déjà ouvert :
 * son onglet est activé, sans relire le disque. Disparu : « Fichier inexistant… », et retiré des récents.
 */
export async function openPath(path: string) {
  const already = findByPath(path);
  if (already) {
    rememberRecent(path);
    return activate(already.id);
  }
  try {
    const file = await fileAccess().readModel(path);
    if (!file) {
      forgetRecent(path);
      return await showError(t("file.missing", { file: path }));
    }
    await openFile(file);
  } catch (e) {
    await showOpenError(e);
  }
}

/**
 * Fichiers déposés sur la fenêtre (O-66) : chaque modèle `.mcd` s'ouvre dans un onglet, l'un après l'autre ; les
 * autres sont ignorés et signalés dans la barre d'état.
 */
export async function openDropped(paths: readonly string[]) {
  const isModel = (p: string) => p.toLowerCase().endsWith(`.${FILE_EXTENSION}`);
  const ignored = paths.filter((p) => !isModel(p));
  if (ignored.length > 0) {
    useUiStore
      .getState()
      .notify({ kind: "error", text: t("file.dropIgnored", { files: ignored.map(fileName).join(", ") }) });
  }
  for (const path of paths.filter(isModel)) {
    // biome-ignore lint/performance/noAwaitInLoops: un onglet après l'autre, avertissements et erreurs dans l'ordre
    await openPath(path);
  }
}

/** « Rouvrir sans sauvegarder » possible : document enregistré dans un fichier, hors onglet de session (O-67). */
export function canReload(doc: DocumentHandle): boolean {
  const session = useCollabStore.getState();
  const shared = session.tabId === doc.id && (session.mode === "host" || session.mode === "guest");
  return fileAccess().readsPaths && doc.store.getState().filePath !== null && !shared;
}

/**
 * Rouvrir sans sauvegarder (O-67) : relit le fichier dans le même onglet, après confirmation si le document est
 * modifié ; l'historique repart de zéro.
 */
export async function reloadDocument(doc: DocumentHandle) {
  const { filePath } = doc.store.getState();
  if (!(filePath && canReload(doc) && (await confirmReload(doc)))) {
    return;
  }
  try {
    const file = await fileAccess().readModel(filePath);
    if (!file) {
      return await showError(t("file.missing", { file: filePath }));
    }
    const { doc: model, warnings } = deserializeModel(file.content);
    doc.store.getState().load(model, filePath);
    await showWarnings(warnings);
  } catch (e) {
    await showOpenError(e);
  }
}

// biome-ignore lint/suspicious/useAwait: renvoie toujours une promesse, même quand la réponse est immédiate
async function confirmReload(doc: DocumentHandle): Promise<boolean> {
  if (!selectIsDirty(doc.store.getState())) {
    return true;
  }
  return confirmDialog({
    title: t("file.reloadTitle"),
    message: t("file.reloadConfirm", { name: documentName(doc) }),
    okLabel: t("file.reloadOk"),
    cancelLabel: t("common.cancel"),
    tone: "danger",
  });
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
    rememberRecent(path);
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
