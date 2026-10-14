import type { ModelDocument } from "@core/index";
import type { MessageKey } from "@/i18n";
import { newModelDocument } from "./modelDefaults";
import { produce, type Draft } from "immer";
import { create } from "zustand";

/**
 * État du document ouvert et historique annuler / rétablir.
 *
 * Toute modification du modèle passe par `change` (une entrée d'historique) ou par
 * une transaction `begin` → `preview`* → `commit` (ex. déplacement à la souris :
 * nombreuses mises à jour, une seule entrée d'historique).
 * Grâce à Immer, chaque instantané partage la structure inchangée : l'historique
 * coûte peu en mémoire.
 */

export type Recipe = (draft: Draft<ModelDocument>) => void;

interface HistoryEntry {
  doc: ModelDocument;
  /** Libellé traduit à l'affichage, pour suivre la langue de l'interface. */
  label: MessageKey;
}

const HISTORY_LIMIT = 200;

interface DocumentState {
  doc: ModelDocument;
  /** Document tel qu'enregistré ; sert à calculer l'indicateur de modification. */
  savedDoc: ModelDocument;
  filePath: string | null;
  /** Document récupéré d'une sauvegarde automatique, pas encore enregistré (override O-22). */
  recovered: boolean;
  past: HistoryEntry[];
  future: HistoryEntry[];
  /** Document au début de la transaction en cours, s'il y en a une. */
  transactionStart: ModelDocument | null;

  change: (label: MessageKey, recipe: Recipe) => void;
  begin: () => void;
  preview: (recipe: Recipe) => void;
  commit: (label: MessageKey) => void;
  cancel: () => void;
  undo: () => void;
  redo: () => void;
  /** Charge un document ; `unsaved` : document neuf non enregistré (ex. rétroconception), marqué modifié. */
  load: (doc: ModelDocument, filePath: string | null, unsaved?: boolean) => void;
  /** Charge un document récupéré : il reste « modifié » jusqu'à son enregistrement. */
  restore: (doc: ModelDocument, filePath: string | null) => void;
  markSaved: (filePath: string) => void;
}

const pushPast = (past: HistoryEntry[], entry: HistoryEntry) => [...past, entry].slice(-HISTORY_LIMIT);

export const useDocumentStore = create<DocumentState>()((set, get) => {
  const initial = newModelDocument();
  return {
    doc: initial,
    savedDoc: initial,
    filePath: null,
    recovered: false,
    past: [],
    future: [],
    transactionStart: null,

    change(label, recipe) {
      const { doc, past, transactionStart } = get();
      if (transactionStart) throw new Error("change() appelé pendant une transaction");
      const next = produce(doc, recipe);
      if (next === doc) return;
      set({ doc: next, past: pushPast(past, { doc, label }), future: [] });
    },

    begin() {
      const { doc, transactionStart } = get();
      if (!transactionStart) set({ transactionStart: doc });
    },

    preview(recipe) {
      if (!get().transactionStart) return;
      set({ doc: produce(get().doc, recipe) });
    },

    commit(label) {
      const { doc, past, transactionStart } = get();
      if (!transactionStart) return;
      if (doc === transactionStart) return set({ transactionStart: null });
      set({ transactionStart: null, past: pushPast(past, { doc: transactionStart, label }), future: [] });
    },

    cancel() {
      const { transactionStart } = get();
      if (transactionStart) set({ doc: transactionStart, transactionStart: null });
    },

    undo() {
      const { doc, past, future, transactionStart } = get();
      const entry = past.at(-1);
      if (!entry || transactionStart) return;
      set({ doc: entry.doc, past: past.slice(0, -1), future: [{ doc, label: entry.label }, ...future] });
    },

    redo() {
      const { doc, past, future, transactionStart } = get();
      const [entry, ...rest] = future;
      if (!entry || transactionStart) return;
      set({ doc: entry.doc, past: pushPast(past, { doc, label: entry.label }), future: rest });
    },

    load(doc, filePath, unsaved = false) {
      set({ doc, savedDoc: unsaved ? { ...doc } : doc, filePath, recovered: false, past: [], future: [], transactionStart: null });
    },

    restore(doc, filePath) {
      // `savedDoc` distinct de `doc` : le document apparaît modifié.
      set({ doc, savedDoc: { ...doc }, filePath, recovered: true, past: [], future: [], transactionStart: null });
    },

    markSaved(filePath) {
      set({ savedDoc: get().doc, filePath, recovered: false });
    },
  };
});

export const selectIsDirty = (s: DocumentState) => s.doc !== s.savedDoc;
export const selectUndoLabel = (s: DocumentState) => s.past.at(-1)?.label;
export const selectRedoLabel = (s: DocumentState) => s.future[0]?.label;
