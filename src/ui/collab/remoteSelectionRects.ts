import type { Id, Rect } from "@core/index";
import type { CollabState } from "@/app/collab/sessionState";
import type { ViewMode } from "@/app/document/documentView";

/** Écart entre la boîte et le liseré d'un autre participant, en pixels d'écran (ma sélection reste visible). */
export const REMOTE_SELECTION_GAP = 4;

/**
 * Boîtes sélectionnées par les autres participants sur ma vue (O-05 §5, précisé le 2026-10-23) : une par objet
 * et par participant, à sa couleur. Seuls les objets qui ont une boîte dans la vue comptent (pas les pattes).
 */
export function remoteSelectionRects(
  { presence, participants, you }: Pick<CollabState, "presence" | "participants" | "you">,
  view: ViewMode,
  boxes: Map<Id, Rect>,
): { key: string; color: string; rect: Rect }[] {
  return participants.flatMap((p) => {
    const state = presence[p.id];
    if (p.id === you || state?.view !== view) {
      return [];
    }
    return state.selection.flatMap((id) => {
      const rect = boxes.get(id);
      return rect ? [{ key: `${p.id}:${id}`, color: p.color, rect }] : [];
    });
  });
}
