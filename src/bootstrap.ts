import { flushAutosave } from "./app/autosave";
import { setFileAccess } from "./app/fileAccess";
import { setLocalStore } from "./app/localStore";
import { setUpdateSource } from "./app/updateSource";
import { platformFiles } from "./platform/files";
import { indexedDbStore } from "./platform/localStore";
import { platformUpdates } from "./platform/updater";

/**
 * Point d'assemblage de la fenêtre principale (esprit hexagonal, audit A-01 / M-00 L3) : seul endroit qui
 * branche les adaptateurs de la plateforme sur les ports de l'application. Appelé une fois, avant le
 * premier rendu. Les fenêtres flottantes n'en ont pas besoin : elles relaient leurs commandes à la principale.
 */
export function bootstrapMain() {
  setFileAccess(platformFiles);
  setUpdateSource(platformUpdates);
  setLocalStore(indexedDbStore);
  // Sauvegarde automatique : copies en attente écrites quand la fenêtre passe en arrière-plan ou se ferme.
  document.addEventListener("visibilitychange", () => document.visibilityState === "hidden" && flushAutosave());
  globalThis.addEventListener("pagehide", flushAutosave);
}
