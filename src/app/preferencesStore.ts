import { type CustomDbms, type Dbms, type KeyPattern, latestVersion, migrateLegacyPattern } from "@core/index";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { type Locale, systemLocale } from "@/i18n";
import { IDENTITY_COLORS, type IdentityPreferences, newIdentity } from "./collab/identity";
import { defaultLayout } from "./dock/layout";
import type { DockLayout } from "./dock/model";
import { sanitizeLayout } from "./dock/sanitize";

/**
 * Options générales (override O-21) : propres au poste, conservées dans le localStorage,
 * jamais dans le fichier modèle.
 */

export type ThemePreference = "system" | "light" | "dark";
/** Stockage de la sauvegarde automatique (O-22) : IndexedDB uniquement, ou désactivée. */
export type AutosaveBackend = "indexeddb" | "off";

/** Derniers réglages d'export d'image (overrides O-17, O-63). */
export interface ExportPreferences {
  format: "svg" | "png" | "jpg" | "webp";
  /** `screen` : le thème affiché (O-63). */
  theme: "light" | "dark" | "screen";
  /** Zone exportée : partie affichée, sélection ou schéma complet (O-63). */
  area: "viewport" | "selection" | "all";
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
  /** Dernière version lancée sur ce poste : ses nouveautés sont montrées après une mise à jour. */
  lastSeenVersion: string;
  /** Disposition de la barre d'outils et des sections (overrides O-45, O-46). */
  dock: DockLayout;
  /** Blocs repliables des sections (« Avancé », clés étrangères…) dépliés (O-50) ; absents = repliés. */
  disclosures: Record<string, boolean>;
  /** Dernier onglet de la boîte « Paramètres du modèle » (O-55). */
  modelSettingsTab: ModelSettingsTab;
  /** « Mes SGBD » : SGBD personnalisés réutilisables (O-59). */
  customDbms: LibraryDbms[];
  /** Assistants IA par MCP (override O-47) : désactivé par défaut. */
  mcp: McpPreferences;
  /** Fichiers récents, du plus récent au plus ancien (O-65, `app/recentFiles.ts`). */
  recentFiles: string[];
  /** Identité en session collaborative (O-05 §3). */
  identity: IdentityPreferences;
}

export type ModelSettingsTab = "naming" | "script" | "conversions" | "types";

/** SGBD personnalisé de la bibliothèque du poste (override O-59) : définition et base. */
export interface LibraryDbms extends CustomDbms {
  base: Dbms;
  version: string;
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
  setLastSeenVersion: (version: string) => void;
  setDisclosure: (id: string, open: boolean) => void;
  setModelSettingsTab: (tab: ModelSettingsTab) => void;
  /** Ajoute un SGBD personnalisé à la bibliothèque, ou y remplace celui de même identifiant. */
  saveCustomDbms: (dbms: LibraryDbms) => void;
  renameCustomDbms: (id: string, name: string) => void;
  duplicateCustomDbms: (id: string, name: string) => void;
  deleteCustomDbms: (id: string) => void;
  /** Applique une opération de `dock/layout.ts` à la disposition. */
  updateDock: (change: (layout: DockLayout) => DockLayout) => void;
  setMcp: (patch: Partial<McpPreferences>) => void;
  setRecentFiles: (recentFiles: string[]) => void;
  setIdentity: (patch: Partial<Pick<IdentityPreferences, "name" | "color">>) => void;
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
  export: { format: "png", theme: "screen", area: "viewport", transparent: false, color: "#ffffff", dpi: 150 },
  updateCheck: true,
  lastSeenVersion: "",
  dock: defaultLayout(),
  disclosures: {},
  modelSettingsTab: "naming",
  customDbms: [],
  mcp: { enabled: false, port: 47_321, token: "" },
  recentFiles: [],
  identity: newIdentity(),
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
      setLastSeenVersion: (lastSeenVersion) => set({ lastSeenVersion }),
      setDisclosure: (id, open) => set((s) => ({ disclosures: { ...s.disclosures, [id]: open } })),
      setModelSettingsTab: (modelSettingsTab) => set({ modelSettingsTab }),
      saveCustomDbms: (dbms) =>
        set((s) => ({
          customDbms: s.customDbms.some((d) => d.id === dbms.id)
            ? s.customDbms.map((d) => (d.id === dbms.id ? dbms : d))
            : [...s.customDbms, dbms],
        })),
      renameCustomDbms: (id, name) =>
        set((s) => ({ customDbms: s.customDbms.map((d) => (d.id === id ? { ...d, name } : d)) })),
      duplicateCustomDbms: (id, name) =>
        set((s) => {
          const source = s.customDbms.find((d) => d.id === id);
          return source
            ? {
                customDbms: [...s.customDbms, { ...source, types: { ...source.types }, id: crypto.randomUUID(), name }],
              }
            : {};
        }),
      deleteCustomDbms: (id) => set((s) => ({ customDbms: s.customDbms.filter((d) => d.id !== id) })),
      updateDock: (change) => set((s) => ({ dock: change(s.dock) })),
      setMcp: (patch) => set((s) => ({ mcp: { ...s.mcp, ...patch } })),
      setRecentFiles: (recentFiles) => set({ recentFiles }),
      setIdentity: (patch) =>
        set((s) => ({ identity: { ...s.identity, ...patch, name: (patch.name ?? s.identity.name).slice(0, 40) } })),
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
          recentFiles: Array.isArray(saved.recentFiles) ? saved.recentFiles.filter((p) => typeof p === "string") : [],
          customDbms: Array.isArray(saved.customDbms)
            ? saved.customDbms.filter((d) => d && typeof d.id === "string" && typeof d.name === "string" && d.types)
            : [],
          identity: {
            ...current.identity,
            ...saved.identity,
            color:
              IDENTITY_COLORS.includes(saved.identity?.color ?? "") ||
              /^#[0-9a-f]{6}$/i.test(saved.identity?.color ?? "")
                ? saved.identity!.color
                : current.identity.color,
          },
        };
      },
      migrate: (persisted) => persisted as PreferencesState,
    },
  ),
);

/**
 * Options écrites par une autre fenêtre de l'application (thème, langue, disposition) : relues dès qu'elles
 * changent (fenêtres flottantes, J-01 phase 4). Démarré par `src/main.tsx` dans toutes les fenêtres ;
 * renvoie la désinscription (audit A-01, A-3).
 */
export function startPreferencesSync(): () => void {
  const reread = (e: StorageEvent) => {
    if (e.key === "modelit/preferences") {
      void usePreferencesStore.persist.rehydrate();
    }
  };
  globalThis.addEventListener("storage", reread);
  return () => globalThis.removeEventListener("storage", reread);
}
