import { createContext, type ReactNode, useContext } from "react";
import { useStore } from "zustand";
import type { DocumentState } from "./documentStore";
import type { DocumentViewState } from "./documentView";
import type { DocumentHandle } from "./handle";

/** Document affiché par un sous-arbre de l'interface (un onglet, un volet). */
const DocumentContext = createContext<DocumentHandle | null>(null);

export function DocumentProvider({ handle, children }: { handle: DocumentHandle; children: ReactNode }) {
  return <DocumentContext.Provider value={handle}>{children}</DocumentContext.Provider>;
}

export function useDocumentHandle(): DocumentHandle {
  const handle = useContext(DocumentContext);
  if (!handle) throw new Error("useDocumentHandle() hors d'un <DocumentProvider>");
  return handle;
}

/** Lit l'état du document courant (contenu, historique, chemin du fichier). */
export const useDocument = <T,>(selector: (s: DocumentState) => T): T => useStore(useDocumentHandle().store, selector);

/** Lit l'état d'affichage du document courant (vue, sélection, cadrage). */
export const useDocumentView = <T,>(selector: (s: DocumentViewState) => T): T =>
  useStore(useDocumentHandle().view, selector);
