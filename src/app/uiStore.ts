import { create } from "zustand";

/**
 * État d'interface propre à la FENÊTRE, non enregistré dans le fichier modèle et hors
 * historique. L'état propre à chaque document (vue, sélection, cadrage) est dans
 * `document/documentView.ts`.
 */

export type Tool = "select" | "entity" | "association" | "inheritance" | "link";
export type BottomTab = "mld" | "sql" | "issues";

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
  tool: Tool;
  bottomTab: BottomTab;
  status: StatusMessage | null;
  /** Vue avancée de l'inspecteur : annotations physiques (override O-29). */
  advanced: boolean;

  setExportOpen: (open: boolean) => void;
  setOptionsOpen: (open: boolean) => void;
  setAbout: (tab: AboutTab | null) => void;
  setReverseOpen: (open: boolean) => void;
  setTool: (tool: Tool) => void;
  setBottomTab: (tab: BottomTab) => void;
  setAdvanced: (advanced: boolean) => void;
  notify: (status: StatusMessage | null) => void;
}

export const useUiStore = create<UiState>()((set) => ({
  exportOpen: false,
  optionsOpen: false,
  about: null,
  reverseOpen: false,
  tool: "select",
  bottomTab: "mld",
  status: null,
  advanced: false,

  // Outil valable seulement dans le MCD : passer par `chooseTool` / `showView` (viewCommands.ts).
  setTool: (tool) => set({ tool }),
  setExportOpen: (exportOpen) => set({ exportOpen }),
  setOptionsOpen: (optionsOpen) => set({ optionsOpen }),
  setAbout: (about) => set({ about }),
  setReverseOpen: (reverseOpen) => set({ reverseOpen }),
  setBottomTab: (bottomTab) => set({ bottomTab }),
  setAdvanced: (advanced) => set({ advanced }),
  notify: (status) => set({ status }),
}));
