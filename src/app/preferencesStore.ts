import { latestVersion, migrateLegacyPattern, type Dbms, type KeyPattern } from "@core/index";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { systemLocale, type Locale } from "@/i18n";
import { defaultLayout, sanitizeLayout, type DockLayout } from "./dock/layout";

/**
 * Options générales (override O-21) : propres au poste, conservées dans le localStorage,
 * jamais dans le fichier modèle.
 */

export type ThemePreference = "system" | "light" | "dark";
/** Stockage de la sauvegarde automatique (O-22) : IndexedDB uniquement, ou désactivée. */
export type AutosaveBackend = "indexeddb" | "off";

/** Derniers réglages d'export d'image (override O-17). */
export interface ExportPreferences {
  format: "svg" | "png" | "jpg" | "webp";
  theme: "light" | "dark";
  transparent: boolean;
  color: string;
  dpi: number;
}

/** Réglages appliqués à chaque nouveau modèle. */
export interface ModelDefaults {
  dbms: Dbms;
  dbmsVersion: string;
  autoIdMask: KeyPattern;
  primaryKey: KeyPattern;
  foreignKey: KeyPattern;
}

export interface Preferences {
  theme: ThemePreference;
  locale: Locale;
  /** Liens brisés tracés en courbes. */
  smoothBends: boolean;
  defaults: ModelDefaults;
  autosave: AutosaveBackend;
  /** Délai entre deux sauvegardes automatiques, en minutes ; 0 = après chaque opération. */
  autosaveDelay: number;
  export: ExportPreferences;
  /** Recherche automatique des mises à jour au lancement. */
  updateCheck: boolean;
  /** Date (ms) de la dernière recherche de mise à jour réussie. */
  lastUpdateCheck: number;
  /** Dernière version lancée sur ce poste : ses nouveautés sont montrées après une mise à jour. */
  lastSeenVersion: string;
  /** Disposition de la barre d'outils et des sections (overrides O-45, O-46). */
  dock: DockLayout;
  /** Assistants IA par MCP (override O-47) : désactivé par défaut. */
  mcp: McpPreferences;
}

export interface McpPreferences {
  enabled: boolean;
  port: number;
  /** Jeton d'accès propre au poste ; créé à la première activation. */
  token: string;
}

interface PreferencesState extends Preferences {
  setTheme: (theme: ThemePreference) => void;
  setLocale: (locale: Locale) => void;
  setSmoothBends: (smooth: boolean) => void;
  setDefaults: (patch: Partial<ModelDefaults>) => void;
  setAutosave: (backend: AutosaveBackend) => void;
  setAutosaveDelay: (minutes: number) => void;
  setExport: (patch: Partial<ExportPreferences>) => void;
  setUpdateCheck: (enabled: boolean) => void;
  setLastUpdateCheck: (time: number) => void;
  setLastSeenVersion: (version: string) => void;
  /** Applique une opération de `dock/layout.ts` à la disposition. */
  updateDock: (change: (layout: DockLayout) => DockLayout) => void;
  setMcp: (patch: Partial<McpPreferences>) => void;
}

const initial: Preferences = {
  theme: "system",
  locale: systemLocale(),
  smoothBends: false,
  defaults: {
    dbms: "postgresql",
    dbmsVersion: latestVersion("postgresql"),
    autoIdMask: "code <entity>",
    primaryKey: "id_<table>",
    foreignKey: "<table>_id",
  },
  autosave: "indexeddb",
  autosaveDelay: 0,
  export: { format: "png", theme: "light", transparent: false, color: "#ffffff", dpi: 150 },
  updateCheck: true,
  lastUpdateCheck: 0,
  lastSeenVersion: "",
  dock: defaultLayout(),
  mcp: { enabled: false, port: 47321, token: "" },
};

export const usePreferencesStore = create<PreferencesState>()(
  persist(
    (set) => ({
      ...initial,
      setTheme: (theme) => set({ theme }),
      setLocale: (locale) => set({ locale }),
      setSmoothBends: (smoothBends) => set({ smoothBends }),
      setDefaults: (patch) => set((s) => ({ defaults: { ...s.defaults, ...patch } })),
      setAutosave: (autosave) => set({ autosave }),
      setAutosaveDelay: (autosaveDelay) => set({ autosaveDelay: Math.max(0, autosaveDelay) }),
      setExport: (patch) => set((s) => ({ export: { ...s.export, ...patch } })),
      setUpdateCheck: (updateCheck) => set({ updateCheck }),
      setLastUpdateCheck: (lastUpdateCheck) => set({ lastUpdateCheck }),
      setLastSeenVersion: (lastSeenVersion) => set({ lastSeenVersion }),
      updateDock: (change) => set((s) => ({ dock: change(s.dock) })),
      setMcp: (patch) => set((s) => ({ mcp: { ...s.mcp, ...patch } })),
    }),
    {
      name: "modelit/preferences",
      version: 3,
      // Les préférences enregistrées par une version antérieure sont complétées par les valeurs initiales.
      merge: (persisted, current) => {
        const saved = (persisted ?? {}) as Partial<Preferences>;
        const defaults = { ...current.defaults, ...saved.defaults };
        return {
          ...current,
          ...saved,
          // Le localStorage n'est plus proposé pour la sauvegarde automatique (O-22).
          autosave: saved.autosave === "off" ? "off" : "indexeddb",
          defaults: {
            ...defaults,
            autoIdMask: migrateLegacyPattern(defaults.autoIdMask),
            primaryKey: migrateLegacyPattern(defaults.primaryKey),
            foreignKey: migrateLegacyPattern(defaults.foreignKey),
          },
          export: { ...current.export, ...saved.export },
          dock: saved.dock ? sanitizeLayout(saved.dock) : current.dock,
          mcp: { ...current.mcp, ...saved.mcp },
        };
      },
      migrate: (persisted) => persisted as PreferencesState,
    },
  ),
);

// Fenêtres flottantes (J-01, phase 4) : les options écrites par une autre fenêtre de l'application
// (thème, langue, disposition) sont relues dès qu'elles changent.
if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key === "modelit/preferences") void usePreferencesStore.persist.rehydrate();
  });
}
