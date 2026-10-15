import type { ModelDocument } from "@core/index";
import { createDocumentStore, type DocumentStore } from "./documentStore";
import { createDocumentViewStore, type DocumentViewStore } from "./documentView";

/**
 * Un document ouvert : son contenu et son historique (`store`), son état d'affichage (`view`).
 * Toute commande reçoit le document sur lequel elle agit (docs/jalons/J-01, phase 1).
 */
export interface DocumentHandle {
  /** Identifiant de session du document ouvert ; jamais enregistré dans le fichier. */
  readonly id: string;
  readonly store: DocumentStore;
  readonly view: DocumentViewStore;
}

export const createDocumentHandle = (initial: ModelDocument): DocumentHandle => ({
  id: crypto.randomUUID(),
  store: createDocumentStore(initial),
  view: createDocumentViewStore(),
});
