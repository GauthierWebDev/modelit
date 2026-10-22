import { deserializeModel, serializeModel } from "@core/index";
import { t } from "@/i18n";
import { type AutosaveEntry, entryKey, INDEX_KEY, readCopies, removeLegacyLocalStorageCopy } from "./autosaveCopies";
import { confirmDialog } from "./dialogStore";
import { selectIsDirty } from "./document/documentStore";
import type { DocumentHandle } from "./document/handle";
import { documentName } from "./documentNames";
import { localStore } from "./localStore";
import { usePreferencesStore } from "./preferencesStore";
import { useUiStore } from "./uiStore";
import { openInTab, useWorkspaceStore } from "./workspace";

/**
 * Sauvegarde automatique et récupération après un arrêt brutal (overrides O-22, O-44).
 *
 * Tant qu'un document ouvert a des modifications non enregistrées, une copie en est écrite dans
 * IndexedDB, une par onglet :
 *  - délai 0 : après chaque opération (fin d'un glisser-déposer, pas à chaque image) ;
 *  - délai N minutes : au plus une écriture toutes les N minutes par document, la dernière
 *    modification étant toujours écrite à l'échéance.
 * Les copies sont aussi écrites quand la fenêtre passe en arrière-plan ou se ferme.
 * La copie d'un document est effacée dès qu'il est enregistré, sans modification, ou fermé.
 * Au lancement, les copies présentes sont proposées ensemble à la récupération.
 */

interface Tracked {
  unsubscribe: () => void;
  timer: ReturnType<typeof setTimeout> | undefined;
  pending: boolean;
  lastWrite: number;
}

let started = false;
const tracked = new Map<string, Tracked>();
/** Documents dont une copie est actuellement stockée. */
const stored = new Set<string>();

const enabled = () => usePreferencesStore.getState().autosave === "indexeddb";
const documents = () => useWorkspaceStore.getState().documents;
const reportError = (e: unknown) =>
  useUiStore.getState().notify({ kind: "error", text: t("file.autosaveFailed", { error: String(e) }) });

async function writeIndex() {
  const ids = documents()
    .map((d) => d.id)
    .filter((id) => stored.has(id));
  if (ids.length > 0) {
    await localStore().set(INDEX_KEY, JSON.stringify(ids));
  } else {
    await localStore().remove(INDEX_KEY);
  }
}

async function write(doc: DocumentHandle) {
  const entry = tracked.get(doc.id);
  if (entry) {
    globalThis.clearTimeout(entry.timer);
    entry.timer = undefined;
    entry.pending = false;
    entry.lastWrite = Date.now();
  }
  if (!enabled()) {
    return;
  }
  const state = doc.store.getState();
  try {
    if (selectIsDirty(state)) {
      const copy: AutosaveEntry = {
        savedAt: new Date().toISOString(),
        filePath: state.filePath,
        name: documentName(doc),
        content: serializeModel(state.doc),
      };
      await localStore().set(entryKey(doc.id), JSON.stringify(copy));
      stored.add(doc.id);
    } else {
      await localStore().remove(entryKey(doc.id));
      stored.delete(doc.id);
    }
    await writeIndex();
  } catch (e) {
    reportError(e);
  }
}

/** Programme une écriture en respectant le délai minimal entre deux sauvegardes du document. */
function schedule(doc: DocumentHandle) {
  const entry = tracked.get(doc.id);
  if (!entry) {
    return;
  }
  entry.pending = true;
  if (entry.timer !== undefined) {
    return;
  }
  const delay = usePreferencesStore.getState().autosaveDelay * 60_000;
  const wait = Math.max(0, entry.lastWrite + delay - Date.now());
  entry.timer = globalThis.setTimeout(() => void write(doc), wait);
}

function track(doc: DocumentHandle) {
  const unsubscribe = doc.store.subscribe((state, previous) => {
    const changed = state.doc !== previous.doc || state.savedDoc !== previous.savedDoc;
    const transactionEnded = previous.transactionStart !== null && state.transactionStart === null;
    if (!(changed || transactionEnded)) {
      return;
    }
    // Pendant un glisser-déposer, une seule écriture, à la fin de l'opération.
    if (state.transactionStart) {
      return;
    }
    // Enregistrement ou retour à l'état enregistré : la copie est effacée sans attendre.
    if (!selectIsDirty(state)) {
      return void write(doc);
    }
    schedule(doc);
  });
  tracked.set(doc.id, { unsubscribe, timer: undefined, pending: false, lastWrite: 0 });
}

/** Onglet fermé : plus de suivi, copie effacée. */
async function untrack(id: string) {
  const entry = tracked.get(id);
  if (entry) {
    entry.unsubscribe();
    globalThis.clearTimeout(entry.timer);
    tracked.delete(id);
  }
  if (!stored.delete(id)) {
    return;
  }
  try {
    await localStore().remove(entryKey(id));
    await writeIndex();
  } catch (e) {
    reportError(e);
  }
}

/** Suit les onglets ouverts et fermés. */
function syncTracked() {
  const open = new Set(documents().map((d) => d.id));
  for (const doc of documents()) {
    if (!tracked.has(doc.id)) {
      track(doc);
    }
  }
  for (const id of [...tracked.keys()]) {
    if (!open.has(id)) {
      void untrack(id);
    }
  }
  // L'ordre des onglets a pu changer.
  if (stored.size > 0) {
    void writeIndex().catch(reportError);
  }
}

/** Propose de récupérer, en une fois, les documents laissés par une session interrompue. */
async function offerRecovery() {
  if (!enabled()) {
    return;
  }
  let keys: string[] = [];
  try {
    const found = await readCopies(localStore());
    ({ keys } = found);
    if (found.copies.length === 0) {
      return;
    }
    const detail = found.copies
      .map((c) => {
        const name = c.name ?? c.filePath?.split(/[\\/]/).pop() ?? t("app.untitled");
        return t("file.recoverDetail", { name, date: new Date(c.savedAt).toLocaleString() });
      })
      .join("\n");
    const ok = await confirmDialog({
      title: t("file.recoverTitle"),
      message: t("file.recoverPrompt"),
      detail,
      okLabel: t("file.recover"),
      cancelLabel: t("file.recoverIgnore"),
      tone: "info",
    });
    if (ok) {
      for (const copy of found.copies) {
        const restored = openInTab((doc) =>
          doc.store.getState().restore(deserializeModel(copy.content).doc, copy.filePath),
        );
        track(restored);
        // Nouvelle copie sous l'identifiant du document rouvert, avant d'effacer l'ancienne.
        // biome-ignore lint/performance/noAwaitInLoops: rouverture dans l'ordre des onglets, chaque copie réécrite avant la suivante
        await write(restored);
      }
    }
  } catch {
    // Copie illisible : elle est abandonnée.
  }
  for (const key of keys) {
    // biome-ignore lint/performance/noAwaitInLoops: effacement une clé à la fois, un échec n'arrête pas les suivantes
    await localStore()
      .remove(key)
      .catch(() => undefined);
  }
}

/**
 * Écrit sans attendre les copies en attente : fenêtre passée en arrière-plan ou fermée (branché par
 * `src/bootstrap.ts`, qui connaît le cycle de vie de la page).
 */
export function flushAutosave() {
  for (const doc of documents()) {
    if (tracked.get(doc.id)?.pending) {
      void write(doc);
    }
  }
}

/** Démarre la sauvegarde automatique (une fois par session). */
export function startAutosave() {
  if (started) {
    return;
  }
  started = true;
  removeLegacyLocalStorageCopy();

  void offerRecovery().then(() => {
    syncTracked();
    useWorkspaceStore.subscribe((state, previous) => {
      if (state.documents !== previous.documents) {
        syncTracked();
      }
    });
  });

  usePreferencesStore.subscribe((state, previous) => {
    if (state.autosave !== previous.autosave) {
      autosaveSwitched(state.autosave === "off");
    }
    // Nouveau délai : les prochaines écritures le respectent (écritures en attente replanifiées).
    if (state.autosaveDelay !== previous.autosaveDelay) {
      reschedule();
    }
  });
}

/** Désactivée : copies effacées ; réactivée : une copie de chaque onglet. */
function autosaveSwitched(off: boolean) {
  if (off) {
    for (const id of [...stored]) {
      void localStore()
        .remove(entryKey(id))
        .catch(() => undefined);
    }
    stored.clear();
    void localStore()
      .remove(INDEX_KEY)
      .catch(() => undefined);
  } else {
    for (const doc of documents()) {
      void write(doc);
    }
  }
}

/** Écritures en attente replanifiées avec le nouveau délai. */
function reschedule() {
  for (const doc of documents()) {
    const entry = tracked.get(doc.id);
    if (entry?.timer === undefined) {
      continue;
    }
    globalThis.clearTimeout(entry.timer);
    entry.timer = undefined;
    schedule(doc);
  }
}
