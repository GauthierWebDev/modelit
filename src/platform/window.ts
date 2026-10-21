import { isTauri } from "@tauri-apps/api/core";

/** Titre et fermeture de la fenêtre, selon la plateforme. */

export async function setWindowTitle(title: string) {
  document.title = title;
  if (isTauri()) {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    await getCurrentWindow().setTitle(title);
  }
}

/** Thème de la barre de titre native ; `null` = suivre le système. */
export async function setNativeTheme(theme: "light" | "dark" | null) {
  if (!isTauri()) return;
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  await getCurrentWindow().setTheme(theme);
}

/**
 * Intercepte la fermeture de la fenêtre : `canClose` décide (avec confirmation
 * éventuelle) ; `isDirty` sert au navigateur, qui n'accepte qu'un test synchrone.
 * Renvoie la fonction de désinscription (pour un `useEffect`).
 */
export function onCloseRequested(canClose: () => Promise<boolean>, isDirty: () => boolean): () => void {
  if (!isTauri()) {
    const handler = (e: BeforeUnloadEvent) => {
      if (isDirty()) e.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }
  let unlisten: (() => void) | undefined;
  let disposed = false;
  void import("@tauri-apps/api/window").then(async ({ getCurrentWindow }) => {
    const off = await getCurrentWindow().onCloseRequested(async (event) => {
      if (!(await canClose())) event.preventDefault();
    });
    if (disposed) off();
    else unlisten = off;
  });
  return () => {
    disposed = true;
    unlisten?.();
  };
}

/** Événement émis par un élément du menu natif (macOS, `src-tauri/src/lib.rs`) ; renvoie la désinscription. */
function onMenuEvent(event: string, handler: () => void): () => void {
  if (!isTauri())
    return () => {
      // Hors de Tauri, pas de menu natif : rien à désabonner.
    };
  let unlisten: (() => void) | undefined;
  let disposed = false;
  void import("@tauri-apps/api/event").then(async ({ listen }) => {
    const off = await listen(event, handler);
    if (disposed) off();
    else unlisten = off;
  });
  return () => {
    disposed = true;
    unlisten?.();
  };
}

/** Élément « About » du menu de l'application (macOS). */
export const onMenuAbout = (handler: () => void) => onMenuEvent("menu-about", handler);

/** Élément « Model Settings… » (⌥⌘,) du menu de l'application (macOS, override O-55). */
export const onMenuModelSettings = (handler: () => void) => onMenuEvent("menu-model-settings", handler);

/** Élément « Close Tab » (⌘W) du menu (macOS, override O-44). */
export const onMenuCloseTab = (handler: () => void) => onMenuEvent("menu-close-tab", handler);
