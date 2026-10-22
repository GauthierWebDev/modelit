import { unplugged } from "./unplugged";

/**
 * Port de la source des mises à jour, défini par l'application (`updates.ts`) ; implémenté par la
 * plateforme (`platform/updater.ts` : plugin updater de Tauri, releases GitHub signées) et branché au
 * démarrage (`src/bootstrap.ts`). Les tests branchent un faux.
 */

export interface AvailableUpdate {
  version: string;
  currentVersion: string;
  /** Notes de version de la release. */
  notes: string;
  /** Télécharge, installe puis redémarre l'application ; `progress` : 0 → 1, ou `null` si taille inconnue. */
  install: (progress: (ratio: number | null) => void) => Promise<void>;
}

export interface UpdateSource {
  /** La plateforme sait-elle se mettre à jour (faux dans le navigateur) ? */
  supported: () => boolean;
  /** Le build connaît-il l'adresse des mises à jour (faux hors build de release) ? */
  configured: () => Promise<boolean>;
  /** Mise à jour disponible, ou `null`. */
  check: () => Promise<AvailableUpdate | null>;
}

let source: UpdateSource = unplugged<UpdateSource>("UpdateSource");

export function setUpdateSource(adapter: UpdateSource) {
  source = adapter;
}

export const updateSource = (): UpdateSource => source;
