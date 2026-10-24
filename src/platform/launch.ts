import { isTauri } from "@tauri-apps/api/core";

/**
 * Fichiers à ouvrir donnés par le système (override O-68 ; `src-tauri/src/launch.rs`) : ceux du lancement
 * (`modelit a.mcd`, double-clic), puis ceux d'un second lancement ou du Finder, au fil de l'eau.
 * `open` reçoit des chemins absolus ; rien dans le navigateur.
 */
export function startLaunchFiles(open: (paths: string[]) => void) {
  if (!isTauri()) {
    return;
  }
  void (async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    const { listen } = await import("@tauri-apps/api/event");
    // Écoute d'abord : les fichiers arrivés entre-temps attendent côté Rust jusqu'à `launch_files`.
    await listen<string[]>("open-files", ({ payload }) => open(payload));
    const files = await invoke<string[]>("launch_files");
    if (files.length > 0) {
      open(files);
    }
  })();
}
