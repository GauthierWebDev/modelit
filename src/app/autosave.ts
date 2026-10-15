import { deserializeModel, serializeModel } from "@core/index";
import { t } from "@/i18n";
import { confirmDialog } from "./dialogStore";
import { indexedDbStore, removeLegacyLocalStorageCopy } from "@/platform/localStore";
import { selectIsDirty } from "./document/documentStore";
import { usePreferencesStore } from "./preferencesStore";
import { useUiStore } from "./uiStore";
import { activeDocument } from "./workspace";

/**
 * Sauvegarde automatique et récupération après un arrêt brutal (override O-22).
 *
 * Tant que le modèle ouvert a des modifications non enregistrées, une copie est écrite dans
 * IndexedDB :
 *  - délai 0 : après chaque opération (fin d'un glisser-déposer, pas à chaque image) ;
 *  - délai N minutes : au plus une écriture toutes les N minutes, la dernière modification
 *    étant toujours écrite à l'échéance.
 * La copie est aussi écrite quand la fenêtre passe en arrière-plan ou se ferme.
 * Dès que le modèle est enregistré (ou sans modification), la copie est effacée.
 * Au lancement, une copie présente est proposée à la récupération.
 * Porte sur le document actif ; une copie par document viendra avec les onglets (J-01, phase 2).
 */

const KEY = "modelit/autosave";

interface Entry {
  savedAt: string;
  filePath: string | null;
  content: string;
}

let started = false;
let pending = false;
let timer: number | undefined;
let lastWrite = 0;

const enabled = () => usePreferencesStore.getState().autosave === "indexeddb";

async function write() {
  window.clearTimeout(timer);
  timer = undefined;
  pending = false;
  lastWrite = Date.now();
  if (!enabled()) return;
  const state = activeDocument().store.getState();
  try {
    if (selectIsDirty(state)) {
      const entry: Entry = { savedAt: new Date().toISOString(), filePath: state.filePath, content: serializeModel(state.doc) };
      await indexedDbStore.set(KEY, JSON.stringify(entry));
    } else {
      await indexedDbStore.remove(KEY);
    }
  } catch (e) {
    useUiStore.getState().notify({ kind: "error", text: t("file.autosaveFailed", { error: String(e) }) });
  }
}

/** Programme une écriture en respectant le délai minimal entre deux sauvegardes. */
function schedule() {
  pending = true;
  if (timer !== undefined) return;
  const delay = usePreferencesStore.getState().autosaveDelay * 60_000;
  const wait = Math.max(0, lastWrite + delay - Date.now());
  timer = window.setTimeout(() => void write(), wait);
}

/** Propose de récupérer la copie laissée par une session interrompue. */
async function offerRecovery() {
  if (!enabled()) return;
  try {
    const raw = await indexedDbStore.get(KEY);
    if (!raw) return;
    const entry = JSON.parse(raw) as Entry;
    const name = entry.filePath?.split(/[\\/]/).pop() ?? t("app.untitled");
    const date = new Date(entry.savedAt).toLocaleString();
    const ok = await confirmDialog({
      title: t("file.recoverTitle"),
      message: t("file.recoverPrompt"),
      detail: t("file.recoverDetail", { name, date }),
      okLabel: t("file.recover"),
      cancelLabel: t("file.recoverIgnore"),
      tone: "info",
    });
    if (ok) activeDocument().store.getState().restore(deserializeModel(entry.content).doc, entry.filePath);
    else await indexedDbStore.remove(KEY);
  } catch {
    await indexedDbStore.remove(KEY).catch(() => undefined);
  }
}

/** Démarre la sauvegarde automatique (une fois par session). */
export function startAutosave() {
  if (started) return;
  started = true;
  removeLegacyLocalStorageCopy(KEY);

  void offerRecovery().then(() => {
    activeDocument().store.subscribe((state, previous) => {
      const changed = state.doc !== previous.doc || state.savedDoc !== previous.savedDoc;
      const transactionEnded = previous.transactionStart !== null && state.transactionStart === null;
      if (!changed && !transactionEnded) return;
      // Pendant un glisser-déposer, une seule écriture, à la fin de l'opération.
      if (state.transactionStart) return;
      // Enregistrement ou retour à l'état enregistré : la copie est effacée sans attendre.
      if (!selectIsDirty(state)) return void write();
      schedule();
    });
  });

  const flush = () => pending && void write();
  document.addEventListener("visibilitychange", () => document.visibilityState === "hidden" && flush());
  window.addEventListener("pagehide", flush);

  usePreferencesStore.subscribe((state, previous) => {
    if (state.autosave !== previous.autosave) {
      if (state.autosave === "off") void indexedDbStore.remove(KEY).catch(() => undefined);
      else void write();
    }
    // Nouveau délai : la prochaine écriture le respecte (une écriture en attente est replanifiée).
    if (state.autosaveDelay !== previous.autosaveDelay && timer !== undefined) {
      window.clearTimeout(timer);
      timer = undefined;
      schedule();
    }
  });
}
