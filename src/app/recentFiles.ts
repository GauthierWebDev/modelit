import { usePreferencesStore } from "./preferencesStore";

/** Fichiers récents (override O-65) : les 5 derniers ouverts ou enregistrés, propres au poste. */
export const RECENT_LIMIT = 5;

/** `path` en tête de la liste, sans doublon, au plus `RECENT_LIMIT` entrées. */
export const withRecent = (list: readonly string[], path: string): string[] =>
  [path, ...list.filter((p) => p !== path)].slice(0, RECENT_LIMIT);

export function rememberRecent(path: string) {
  const { recentFiles, setRecentFiles } = usePreferencesStore.getState();
  setRecentFiles(withRecent(recentFiles, path));
}

/** Fichier disparu : retiré de la liste. */
export function forgetRecent(path: string) {
  const { recentFiles, setRecentFiles } = usePreferencesStore.getState();
  setRecentFiles(recentFiles.filter((p) => p !== path));
}

export function clearRecent() {
  usePreferencesStore.getState().setRecentFiles([]);
}
