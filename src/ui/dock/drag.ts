import { create } from "zustand";
import type { DropTarget, SectionId } from "@/app/dock/layout";

/**
 * Glisser-déposer des onglets et des groupes (override O-46) : état partagé par les cibles,
 * qui s'allument pendant le survol. Les cibles sont repérées par attributs DOM :
 *  - `data-drop-group="<id>"` : barre d'onglets d'un groupe (rejoindre le groupe) ;
 *  - `data-drop-zone="right|bottom"` + `data-drop-index="<n>"` : emplacement dans une zone.
 * Relâché ailleurs : nouveau groupe flottant sous le pointeur.
 */

export type DragItem = { kind: "section"; section: SectionId; group: string } | { kind: "group"; group: string };

interface DragState {
  item: DragItem | null;
  pointer: { x: number; y: number } | null;
  target: DropTarget | null;
}

export const useDragStore = create<DragState>()(() => ({ item: null, pointer: null, target: null }));

/** Taille d'un groupe flottant créé par un glisser. */
export const FLOAT_SIZE = { width: 320, height: 320 };

export function targetAt(x: number, y: number, item: DragItem): DropTarget {
  const element = document.elementFromPoint(x, y);
  const group = element?.closest<HTMLElement>("[data-drop-group]")?.dataset.dropGroup;
  if (group && item.kind === "section" && group !== item.group) return { kind: "group", group };
  const slot = element?.closest<HTMLElement>("[data-drop-zone]");
  if (slot) return { kind: "zone", zone: slot.dataset.dropZone as "right" | "bottom", index: Number(slot.dataset.dropIndex ?? 0) };
  return { kind: "float", rect: { x: x - 24, y: y - 14, ...FLOAT_SIZE } };
}

const sameTarget = (a: DropTarget | null, b: DropTarget | null) =>
  a?.kind === b?.kind &&
  (a?.kind !== "group" || a.group === (b as typeof a).group) &&
  (a?.kind !== "zone" || (a.zone === (b as typeof a).zone && a.index === (b as typeof a).index));

const THRESHOLD = 4;

/**
 * Démarre un glisser depuis un `pointerdown` ; `onClick` si le pointeur n'a pas bougé.
 * `onDrop` reçoit la cible au relâchement.
 */
export function startDrag(event: { clientX: number; clientY: number; pointerId: number }, item: DragItem, onDrop: (target: DropTarget) => void, onClick?: () => void) {
  const start = { x: event.clientX, y: event.clientY };
  let moving = false;
  const move = (e: PointerEvent) => {
    if (!moving && Math.hypot(e.clientX - start.x, e.clientY - start.y) < THRESHOLD) return;
    moving = true;
    const target = targetAt(e.clientX, e.clientY, item);
    const state = useDragStore.getState();
    useDragStore.setState({ item, pointer: { x: e.clientX, y: e.clientY }, target: sameTarget(state.target, target) ? state.target : target });
  };
  const end = (e: PointerEvent) => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", end);
    window.removeEventListener("pointercancel", cancel);
    useDragStore.setState({ item: null, pointer: null, target: null });
    if (moving) onDrop(targetAt(e.clientX, e.clientY, item));
    else onClick?.();
  };
  const cancel = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", end);
    window.removeEventListener("pointercancel", cancel);
    useDragStore.setState({ item: null, pointer: null, target: null });
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", end);
  window.addEventListener("pointercancel", cancel);
}
