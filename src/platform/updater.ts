import { invoke, isTauri } from "@tauri-apps/api/core";

/**
 * Mises à jour de l'application (plugin updater de Tauri) : la release GitHub publiée la plus
 * récente décrit, dans `latest.json`, la version et un installeur signé par plateforme. La
 * signature est vérifiée avec la clé publique de `tauri.conf.json` avant toute installation.
 * Hors Tauri (navigateur), aucune mise à jour. Seuls les builds de release connaissent l'adresse
 * de `latest.json` (ajoutée par la CI) : les autres builds ne peuvent pas se mettre à jour.
 */

export interface AvailableUpdate {
  version: string;
  currentVersion: string;
  /** Notes de version de la release. */
  notes: string;
  /** Télécharge, installe puis redémarre l'application ; `progress` : 0 → 1, ou `null` si taille inconnue. */
  install: (progress: (ratio: number | null) => void) => Promise<void>;
}

export async function checkForUpdate(): Promise<AvailableUpdate | null> {
  if (!isTauri()) return null;
  const { check } = await import("@tauri-apps/plugin-updater");
  const update = await check();
  if (!update) return null;
  return {
    version: update.version,
    currentVersion: update.currentVersion,
    notes: update.body ?? "",
    install: async (progress) => {
      let total: number | undefined;
      let received = 0;
      await update.downloadAndInstall((event) => {
        if (event.event === "Started") total = event.data.contentLength;
        if (event.event === "Progress") received += event.data.chunkLength;
        progress(total ? Math.min(received / total, 1) : null);
      });
      const { relaunch } = await import("@tauri-apps/plugin-process");
      await relaunch();
    },
  };
}

export const updatesSupported = isTauri;

/** Faux pour un build sans adresse de mise à jour (développement, installeur joint à un run de CI). */
export async function updatesConfigured(): Promise<boolean> {
  return isTauri() && (await invoke<boolean>("updater_configured"));
}
