import { create } from "zustand";
import { updateDock } from "@/app/dock/actions";
import { moveGroup, moveSection } from "@/app/dock/layout";
import type { DragItem, DropTarget } from "@/app/dock/model";
import { usePreferencesStore } from "@/app/preferencesStore";

/**
 * Glisser-déposer des onglets et des groupes (override O-46) : état partagé par les cibles,
 * qui s'allument pendant le survol. Les cibles sont repérées par attributs DOM :
 *  - `data-drop-group="<id>"` : barre d'onglets d'un groupe (rejoindre le groupe) ;
 *  - `data-drop-zone="right|bottom"` + `data-drop-index="<n>"` : emplacement dans une zone.
 * Relâché ailleurs : nouveau groupe flottant sous le pointeur.
 *
 * Dans l'application native, les positions flottantes sont en coordonnées de l'écran : `screenOrigin`
 * est la position de la page à l'écran. Une fenêtre flottante délègue la décision du dépôt à la
 * fenêtre principale (`setDropDelegate`), seule à connaître ses zones.
 */

let screenOrigin = { x: 0, y: 0 };
export const setScreenOrigin = (origin: { x: number; y: number }) => {
  screenOrigin = origin;
};
export const toScreen = <R extends { x: number; y: number }>(r: R): R => ({
  ...r,
  x: r.x + screenOrigin.x,
  y: r.y + screenOrigin.y,
});

let dropDelegate: ((item: DragItem, screen: { x: number; y: number }) => void) | null = null;
export const setDropDelegate = (delegate: typeof dropDelegate) => {
  dropDelegate = delegate;
};

/** Applique un dépôt à la disposition. */
export function dropItem(item: DragItem, target: DropTarget) {
  if (item.kind === "section") {
    updateDock((l) => moveSection(l, item.section, target));
  } else if (target.kind !== "group") {
    updateDock((l) => moveGroup(l, item.group, target));
  }
}

export type { DragItem } from "@/app/dock/model";

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
  if (group && item.kind === "section" && group !== item.group) {
    return { kind: "group", group };
  }
  const slot = element?.closest<HTMLElement>("[data-drop-zone]");
  if (slot) {
    return {
      kind: "zone",
      zone: slot.dataset.dropZone as "right" | "bottom",
      index: Number(slot.dataset.dropIndex ?? 0),
    };
  }
  // Groupe entier : toute la zone d'ancrage (et ses abords) est une cible.
  if (item.kind === "group") {
    const zone = zoneTargetAt(x, y);
    if (zone) {
      return zone;
    }
  }
  // Fenêtre flottante native sous le pointeur (hors de la page) : son en-tête accueille un onglet.
  const sx = x + screenOrigin.x;
  const sy = y + screenOrigin.y;
  const header = usePreferencesStore
    .getState()
    .dock.floating.find(
      (g) => sx >= g.rect.x && sx <= g.rect.x + g.rect.width && sy >= g.rect.y && sy <= g.rect.y + 34,
    );
  if (header && item.kind === "section" && header.id !== item.group) {
    return { kind: "group", group: header.id };
  }
  return { kind: "float", rect: { x: x - 24 + screenOrigin.x, y: y - 14 + screenOrigin.y, ...FLOAT_SIZE } };
}

/** Marge (px) autour d'une zone d'ancrage dans laquelle un groupe glissé s'y ancre. */
const ZONE_SNAP = 48;

/**
 * Zone d'ancrage sous le point, marge comprise : place d'insertion selon le milieu des groupes
 * (au-dessus / à gauche du milieu : avant ce groupe). Ancrage large d'un groupe entier (O-46).
 */
export function zoneTargetAt(x: number, y: number): DropTarget | null {
  for (const zone of document.querySelectorAll<HTMLElement>("[data-dock-zone]")) {
    const r = zone.getBoundingClientRect();
    if (x < r.left - ZONE_SNAP || x > r.right + ZONE_SNAP || y < r.top - ZONE_SNAP || y > r.bottom + ZONE_SNAP) {
      continue;
    }
    const name = zone.dataset.dockZone as "right" | "bottom";
    const groups = [
      ...zone.querySelectorAll<HTMLElement>(":scope > [data-group-id], :scope > .contents > [data-group-id]"),
    ];
    const index = groups.filter((g) => {
      const b = g.getBoundingClientRect();
      return name === "right" ? b.top + b.height / 2 < y : b.left + b.width / 2 < x;
    }).length;
    return { kind: "zone", zone: name, index };
  }
  return null;
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
export function startDrag(
  event: { clientX: number; clientY: number; pointerId: number },
  item: DragItem,
  onDrop: (target: DropTarget) => void,
  onClick?: () => void,
) {
  const start = { x: event.clientX, y: event.clientY };
  let moving = false;
  const move = (e: PointerEvent) => {
    if (!moving && Math.hypot(e.clientX - start.x, e.clientY - start.y) < THRESHOLD) {
      return;
    }
    moving = true;
    const target = targetAt(e.clientX, e.clientY, item);
    const state = useDragStore.getState();
    useDragStore.setState({
      item,
      pointer: { x: e.clientX, y: e.clientY },
      target: sameTarget(state.target, target) ? state.target : target,
    });
  };
  const end = (e: PointerEvent) => {
    globalThis.removeEventListener("pointermove", move);
    globalThis.removeEventListener("pointerup", end);
    globalThis.removeEventListener("pointercancel", cancel);
    useDragStore.setState({ item: null, pointer: null, target: null });
    if (!moving) {
      onClick?.();
    } else if (dropDelegate) {
      dropDelegate(item, { x: e.clientX + screenOrigin.x, y: e.clientY + screenOrigin.y });
    } else {
      onDrop(targetAt(e.clientX, e.clientY, item));
    }
  };
  const cancel = () => {
    globalThis.removeEventListener("pointermove", move);
    globalThis.removeEventListener("pointerup", end);
    globalThis.removeEventListener("pointercancel", cancel);
    useDragStore.setState({ item: null, pointer: null, target: null });
  };
  globalThis.addEventListener("pointermove", move);
  globalThis.addEventListener("pointerup", end);
  globalThis.addEventListener("pointercancel", cancel);
}
