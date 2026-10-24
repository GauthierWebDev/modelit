import type { Id } from "@core/index";
import { createStore, type StoreApi } from "zustand/vanilla";

/**
 * État d'affichage propre à un document : vue, sélection, cadrage. Hors historique et hors
 * fichier ; chaque document ouvert garde le sien (docs/jalons/J-01, phase 1). L'état propre
 * à la fenêtre (outil, boîtes ouvertes…) est dans `uiStore`.
 */

/** Étape affichée dans la zone graphique (override O-01). */
export type ViewMode = "mcd" | "mld" | "mpd";

export interface Viewport {
  /** Translation écran (px) du repère du modèle. */
  x: number;
  y: number;
  zoom: number;
}

export const ZOOM_MIN = 0.1;
export const ZOOM_MAX = 4;

/** Point de cassure sélectionné (supprimable avec Suppr, override O-10). */
export interface ActiveBend {
  linkId: Id;
  index: number;
}

/** Recherche dans le canevas (override O-64) : champ ouvert, texte cherché, résultat courant. */
export interface SearchState {
  open: boolean;
  query: string;
  index: number;
}

export interface DocumentViewState {
  view: ViewMode;
  selection: Id[];
  viewport: Viewport;
  activeBend: ActiveBend | null;
  /** Placement automatique en cours sur ce document : bouton désactivé, nouvel appel ignoré. */
  layoutRunning: boolean;
  search: SearchState;

  setView: (view: ViewMode) => void;
  select: (ids: Id[]) => void;
  toggleSelected: (id: Id) => void;
  setViewport: (viewport: Viewport) => void;
  setActiveBend: (bend: ActiveBend | null) => void;
  setLayoutRunning: (running: boolean) => void;
  setSearch: (patch: Partial<SearchState>) => void;
}

export type DocumentViewStore = StoreApi<DocumentViewState>;

export const createDocumentViewStore = (): DocumentViewStore =>
  createStore<DocumentViewState>()((set) => ({
    view: "mcd",
    selection: [],
    viewport: { x: 40, y: 40, zoom: 1 },
    activeBend: null,
    layoutRunning: false,
    search: { open: false, query: "", index: 0 },

    setView: (view) => set({ view }),
    select: (selection) => set({ selection, activeBend: null }),
    toggleSelected: (id) =>
      set((s) => ({
        activeBend: null,
        selection: s.selection.includes(id) ? s.selection.filter((x) => x !== id) : [...s.selection, id],
      })),
    setViewport: (viewport) =>
      set({ viewport: { ...viewport, zoom: Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, viewport.zoom)) } }),
    setActiveBend: (activeBend) => set({ activeBend }),
    setLayoutRunning: (layoutRunning) => set({ layoutRunning }),
    setSearch: (patch) => set((s) => ({ search: { ...s.search, ...patch } })),
  }));
