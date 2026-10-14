import { isTauri } from "@tauri-apps/api/core";

/** Ouvre une adresse dans le navigateur du système (un lien de la webview n'en sort pas sous Tauri). */
export async function openExternal(url: string) {
  if (isTauri()) {
    const { openUrl } = await import("@tauri-apps/plugin-opener");
    await openUrl(url);
  } else {
    window.open(url, "_blank", "noopener");
  }
}
