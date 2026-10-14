import type { Id } from "@core/index";
import { create } from "zustand";

/** État d'interface, non enregistré dans le fichier modèle et hors historique. */

export type Tool = "select" | "entity" | "association" | "inheritance" | "link";
/** Étape affichée dans la zone graphique (override O-01). */
export type ViewMode = "mcd" | "mld" | "mpd";
export type BottomTab = "mld" | "sql" | "issues";

export interface Viewport {
  /** Translation écran (px) du repère du modèle. */
  x: number;
  y: number;
  zoom: number;
}

export const ZOOM_MIN = 0.1;
export const ZOOM_MAX = 4;

/** Onglets de la boîte À propos. */
export type AboutTab = "about" | "changes";

export interface StatusMessage {
  kind: "info" | "error";
  text: string;
}

/** Point de cassure sélectionné (supprimable avec Suppr, override O-10). */
export interface ActiveBend {
  linkId: Id;
  index: number;
}

interface UiState {
  view: ViewMode;
  /** Boîte « Exporter l'image » ouverte. */
  exportOpen: boolean;
  /** Boîte « Options générales » ouverte. */
  optionsOpen: boolean;
  /** Boîte À propos : onglet affiché, ou `null` si fermée. */
  about: AboutTab | null;
  /** Boîte « Rétroconception » ouverte. */
  reverseOpen: boolean;
  activeBend: ActiveBend | null;
  tool: Tool;
  selection: Id[];
  viewport: Viewport;
  bottomTab: BottomTab;
  status: StatusMessage | null;
  /** Vue avancée de l'inspecteur : annotations physiques (override O-29). */
  advanced: boolean;

  setView: (view: ViewMode) => void;
  setExportOpen: (open: boolean) => void;
  setOptionsOpen: (open: boolean) => void;
  setAbout: (tab: AboutTab | null) => void;
  setReverseOpen: (open: boolean) => void;
  setActiveBend: (bend: ActiveBend | null) => void;
  setTool: (tool: Tool) => void;
  select: (ids: Id[]) => void;
  toggleSelected: (id: Id) => void;
  setViewport: (viewport: Viewport) => void;
  setBottomTab: (tab: BottomTab) => void;
  setAdvanced: (advanced: boolean) => void;
  notify: (status: StatusMessage | null) => void;
}

export const useUiStore = create<UiState>()((set) => ({
  view: "mcd",
  exportOpen: false,
  optionsOpen: false,
  about: null,
  reverseOpen: false,
  activeBend: null,
  tool: "select",
  selection: [],
  viewport: { x: 40, y: 40, zoom: 1 },
  bottomTab: "mld",
  status: null,
  advanced: false,

  // Les outils de création n'existent que dans le MCD.
  setView: (view) => set(view === "mcd" ? { view } : { view, tool: "select" }),
  setTool: (tool) => set((s) => (s.view === "mcd" ? { tool } : {})),
  setActiveBend: (activeBend) => set({ activeBend }),
  setExportOpen: (exportOpen) => set({ exportOpen }),
  setOptionsOpen: (optionsOpen) => set({ optionsOpen }),
  setAbout: (about) => set({ about }),
  setReverseOpen: (reverseOpen) => set({ reverseOpen }),
  select: (selection) => set({ selection, activeBend: null }),
  toggleSelected: (id) =>
    set((s) => ({
      activeBend: null,
      selection: s.selection.includes(id) ? s.selection.filter((x) => x !== id) : [...s.selection, id],
    })),
  setViewport: (viewport) =>
    set({ viewport: { ...viewport, zoom: Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, viewport.zoom)) } }),
  setBottomTab: (bottomTab) => set({ bottomTab }),
  setAdvanced: (advanced) => set({ advanced }),
  notify: (status) => set({ status }),
}));
