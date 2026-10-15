import { create } from "zustand";
import { createDocumentHandle, type DocumentHandle } from "./document/handle";
import { newModelDocument } from "./modelDefaults";

/**
 * Documents ouverts dans la fenêtre et document actif. Phase 1 du jalon J-01 : exactement un
 * document ; les onglets (phase 2) en ouvriront plusieurs.
 */

interface WorkspaceState {
  documents: DocumentHandle[];
  activeId: string;
}

export const useWorkspaceStore = create<WorkspaceState>()(() => {
  const first = createDocumentHandle(newModelDocument());
  return { documents: [first], activeId: first.id };
});

/** Document actif, pour le code hors React (raccourcis, gestionnaires de la fenêtre). */
export function activeDocument(): DocumentHandle {
  const { documents, activeId } = useWorkspaceStore.getState();
  const active = documents.find((d) => d.id === activeId);
  if (!active) throw new Error(`Document actif introuvable : ${activeId}`);
  return active;
}

export const useActiveDocument = (): DocumentHandle =>
  useWorkspaceStore((s) => s.documents.find((d) => d.id === s.activeId) ?? s.documents[0]!);
