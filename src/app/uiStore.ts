import { create } from "zustand";

/**
 * État d'interface propre à la FENÊTRE, non enregistré dans le fichier modèle et hors
 * historique. La disposition des sections est dans les options du poste (`dock`). L'état propre à chaque document (vue, sélection, cadrage) est dans
 * `document/documentView.ts`.
 */

export type Tool = "select" | "entity" | "association" | "inheritance" | "link";

/** Onglets de la boîte À propos. */
export type AboutTab = "about" | "changes";

export interface StatusMessage {
  kind: "info" | "error";
  text: string;
}

interface UiState {
  /** Boîte « Exporter l'image » ouverte. */
  exportOpen: boolean;
  /** Boîte « Options générales » ouverte. */
  optionsOpen: boolean;
  /** Boîte À propos : onglet affiché, ou `null` si fermée. */
  about: AboutTab | null;
  /** Boîte « Rétroconception » ouverte. */
  reverseOpen: boolean;
  /** Boîte « Session collaborative » ouverte (O-05). */
  shareOpen: boolean;
  tool: Tool;
  status: StatusMessage | null;

  setExportOpen: (open: boolean) => void;
  setOptionsOpen: (open: boolean) => void;
  setAbout: (tab: AboutTab | null) => void;
  setReverseOpen: (open: boolean) => void;
  setShareOpen: (open: boolean) => void;
  setTool: (tool: Tool) => void;
  notify: (status: StatusMessage | null) => void;
}

export const useUiStore = create<UiState>()((set) => ({
  exportOpen: false,
  optionsOpen: false,
  about: null,
  reverseOpen: false,
  shareOpen: false,
  tool: "select",
  status: null,

  // Outil valable seulement dans le MCD : passer par `chooseTool` / `showView` (viewCommands.ts).
  setTool: (tool) => set({ tool }),
  setExportOpen: (exportOpen) => set({ exportOpen }),
  setOptionsOpen: (optionsOpen) => set({ optionsOpen }),
  setAbout: (about) => set({ about }),
  setReverseOpen: (reverseOpen) => set({ reverseOpen }),
  setShareOpen: (shareOpen) => set({ shareOpen }),
  notify: (status) => set({ status }),
}));
