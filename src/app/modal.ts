import { useDialogStore } from "./dialogStore";
import { useUiStore } from "./uiStore";

/**
 * Une boîte modale est-elle ouverte (confirmation en attente ou boîte de l'application) ? Seule
 * définition : la fenêtre flottante se bloque, l'assistant IA attend (O-46, O-47 ; audit A-01, A-5).
 */
export function modalOpen(): boolean {
  const ui = useUiStore.getState();
  return (
    useDialogStore.getState().queue.length > 0 ||
    ui.exportOpen ||
    ui.optionsOpen ||
    ui.modelSettingsOpen ||
    ui.reverseOpen ||
    ui.shareOpen ||
    ui.about !== null
  );
}
