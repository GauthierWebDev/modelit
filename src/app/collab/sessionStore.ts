import type { ModelDocument } from "@core/index";
import { produce } from "immer";
import { createStore, type StoreApi } from "zustand/vanilla";
import type { MessageKey } from "@/i18n";
import type { DocumentState } from "../document/documentStore";
import { apply, diff, type Op } from "./ops";

/**
 * Document partagé en session (O-05 ; J-01, phase 5a, D11), chez l'hôte comme chez un invité.
 * Même interface que le store d'un document ordinaire, mais :
 *  - chaque modification locale est appliquée aussitôt puis publiée sous forme d'opérations ;
 *  - l'historique ne contient que **ses propres** actions, sous forme d'opérations inverses :
 *    annuler n'efface pas le travail des autres ;
 *  - les opérations des autres s'appliquent par `applyRemote`, hors historique.
 */

interface SessionEntry {
  doc: ModelDocument;
  label: MessageKey;
  /** Opérations qui annulent l'action, et celles qui la refont. */
  undo: Op[];
  redo: Op[];
}

export interface SessionDocumentState extends DocumentState {
  /** Opérations venues des autres participants (ou rediffusées par l'hôte). */
  applyRemote: (ops: readonly Op[]) => void;
  /** Remplace le document (arrivée dans la session), sans historique. */
  reset: (doc: ModelDocument) => void;
}

export type SessionStore = StoreApi<SessionDocumentState>;

const HISTORY_LIMIT = 200;

export function createSessionStore(
  initial: ModelDocument,
  {
    publish,
    canEdit = () => true,
  }: {
    /** Diffusion des opérations d'une action locale (vers l'hôte, ou vers les invités). */
    publish: (ops: Op[], label: MessageKey) => void;
    /** Lecteur, ou déconnecté : aucune modification locale (O-05 §4.3, §4.4). */
    canEdit?: () => boolean;
  },
): SessionStore {
  return createStore<SessionDocumentState>()((set, get) => {
    const record = (label: MessageKey, before: ModelDocument, after: ModelDocument) => {
      const redo = diff(before, after);
      if (!redo.length) {
        return;
      }
      const undo = diff(after, before);
      const past = [...(get().past as SessionEntry[]), { doc: after, label, undo, redo }].slice(-HISTORY_LIMIT);
      set({ past, future: [] });
      publish(redo, label);
    };
    const replay = (label: MessageKey, ops: Op[]) => {
      set({ doc: apply(get().doc, ops) });
      publish(ops, label);
    };

    return {
      doc: initial,
      savedDoc: initial,
      filePath: null,
      recovered: false,
      past: [],
      future: [],
      transactionStart: null,

      change(label, recipe) {
        if (!canEdit()) {
          return;
        }
        const { doc, transactionStart } = get();
        if (transactionStart) {
          throw new Error("change() appelé pendant une transaction");
        }
        const next = produce(doc, recipe);
        if (next === doc) {
          return;
        }
        set({ doc: next });
        record(label, doc, next);
      },

      begin() {
        if (!canEdit() || get().transactionStart) {
          return;
        }
        set({ transactionStart: get().doc });
      },

      preview(recipe) {
        if (!get().transactionStart) {
          return;
        }
        set({ doc: produce(get().doc, recipe) });
      },

      commit(label) {
        const { doc, transactionStart } = get();
        if (!transactionStart) {
          return;
        }
        set({ transactionStart: null });
        record(label, transactionStart, doc);
      },

      cancel() {
        const { transactionStart } = get();
        if (transactionStart) {
          set({ doc: transactionStart, transactionStart: null });
        }
      },

      undo() {
        const past = get().past as SessionEntry[];
        const entry = past.at(-1);
        if (!entry || get().transactionStart || !canEdit()) {
          return;
        }
        set({ past: past.slice(0, -1), future: [entry, ...(get().future as SessionEntry[])] });
        replay(entry.label, entry.undo);
      },

      redo() {
        const [entry, ...rest] = get().future as SessionEntry[];
        if (!entry || get().transactionStart || !canEdit()) {
          return;
        }
        set({ future: rest, past: [...(get().past as SessionEntry[]), entry].slice(-HISTORY_LIMIT) });
        replay(entry.label, entry.redo);
      },

      applyRemote(ops) {
        const { doc, transactionStart } = get();
        // Pendant un glisser-déposer local, l'état de départ suit aussi : la transaction s'appuie
        // sur la dernière version commune.
        set({ doc: apply(doc, ops), ...(transactionStart ? { transactionStart: apply(transactionStart, ops) } : {}) });
      },

      reset(doc) {
        set({ doc, savedDoc: doc, past: [], future: [], transactionStart: null });
      },

      // Fichiers : seul l'hôte enregistre (O-05 §4.3) ; l'indicateur suit son enregistrement.
      load() {
        // Seul l'hôte ouvre ou enregistre le fichier (O-05 §4.3).
      },
      restore() {
        // Seul l'hôte récupère une sauvegarde automatique (O-05 §4.3).
      },
      markSaved(filePath) {
        set({ savedDoc: get().doc, filePath });
      },
    };
  });
}
