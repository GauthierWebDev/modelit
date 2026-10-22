import type { Id, Point } from "../model/document";
import { snap } from "./move";
import { center, intersects, type Rect } from "./rect";
import { reflexiveBends } from "./reflexive";

/**
 * Place d'une association créée à l'outil Lien (overrides O-02, O-08, O-60) : règle pure, sur les boîtes
 * fournies par l'appelant (celles du MCD, et la plus grande boîte de chaque objet, MPD compris).
 */

export interface Size {
  width: number;
  height: number;
}

/** Taille de la nouvelle association dans le MCD, et place qu'elle réserve (sa future table du MPD comprise). */
export interface AssociationSize {
  mcd: Size;
  reserved: Size;
}

/** Marge entre la nouvelle association et tout objet (O-08, O-60). */
const MARGIN = 16;
/** Pas entre deux couronnes ou deux décalages successifs, et nombre d'essais au-delà du premier. */
const STEP = 60;
const TRIES = 12;

/** Le coin `p` laisse-t-il la place `size`, marge comprise, hors de tous les obstacles ? */
const isFree = (p: Point, size: Size, obstacles: Rect[]) =>
  !obstacles.some((r) =>
    intersects(
      { x: p.x - MARGIN, y: p.y - MARGIN, width: size.width + 2 * MARGIN, height: size.height + 2 * MARGIN },
      r,
    ),
  );

/**
 * Association réflexive (O-08, O-60) : premier emplacement libre autour de l'entité (droite,
 * dessous, gauche, dessus, puis de plus en plus loin) ; à défaut, à droite.
 */
export function reflexiveSlot(entity: Rect, size: Size, obstacles: Rect[], grid: number | null): Point {
  const ce = center(entity);
  type Side = "right" | "below" | "left" | "above";
  const at = (side: Side, distance: number): Point => {
    switch (side) {
      case "right":
        return { x: entity.x + entity.width + distance, y: ce.y - size.height / 2 };
      case "left":
        return { x: entity.x - distance - size.width, y: ce.y - size.height / 2 };
      case "below":
        return { x: ce.x - size.width / 2, y: entity.y + entity.height + distance };
      case "above":
        return { x: ce.x - size.width / 2, y: entity.y - distance - size.height };
    }
  };
  for (let distance = 90; distance <= 90 + STEP * TRIES; distance += STEP) {
    for (const candidate of ["right", "below", "left", "above"] as Side[]) {
      const p = at(candidate, distance);
      const snapped = { x: snap(p.x, grid), y: snap(p.y, grid) };
      if (isFree(snapped, size, obstacles)) {
        return snapped;
      }
    }
  }
  return at("right", 90);
}

/**
 * Association entre deux entités (O-02, O-60) : centrée entre elles (boîtes du MCD) si la place est
 * libre ; sinon décalée perpendiculairement au segment qui les joint, d'un côté puis de l'autre, de
 * plus en plus loin ; à défaut, au centre. `mcd` place le coin, `size` est la place réservée.
 */
export function betweenSlot(a: Rect, b: Rect, mcd: Size, size: Size, obstacles: Rect[], grid: number | null): Point {
  const ca = center(a);
  const cb = center(b);
  const middle = { x: (ca.x + cb.x) / 2, y: (ca.y + cb.y) / 2 };
  const length = Math.hypot(cb.x - ca.x, cb.y - ca.y);
  // Perpendiculaire au segment ; entités confondues : décalage vertical.
  const normal = length ? { x: -(cb.y - ca.y) / length, y: (cb.x - ca.x) / length } : { x: 0, y: 1 };
  const corner = (offset: number): Point => ({
    x: snap(middle.x + normal.x * offset - mcd.width / 2, grid),
    y: snap(middle.y + normal.y * offset - mcd.height / 2, grid),
  });
  for (const offset of [0, ...Array.from({ length: TRIES }, (_, i) => [(i + 1) * STEP, -(i + 1) * STEP]).flat()]) {
    const p = corner(offset);
    if (isFree(p, size, obstacles)) {
      return p;
    }
  }
  return corner(0);
}

/**
 * Place de l'association créée en reliant `fromId` à `toId`, deux entités : aucun objet existant déplacé.
 * Réflexive : la seconde patte contourne l'ensemble dans le MCD (O-10, O-33).
 * `mcdBoxes` : boîtes du MCD ; `placementBoxes` : plus grande boîte de chaque objet (O-60).
 */
export function associationPlacement(
  fromId: Id,
  toId: Id,
  boxes: { mcd: Map<Id, Rect>; placement: Map<Id, Rect> },
  size: AssociationSize,
  grid: number | null,
): { associationPosition: Point; reflexiveBends?: Point[] } {
  const obstacles = [...boxes.placement.values()];
  if (fromId !== toId) {
    return {
      associationPosition: betweenSlot(
        boxes.mcd.get(fromId)!,
        boxes.mcd.get(toId)!,
        size.mcd,
        size.reserved,
        obstacles,
        grid,
      ),
    };
  }
  const position = reflexiveSlot(boxes.placement.get(fromId)!, size.reserved, obstacles, grid);
  const entity = boxes.mcd.get(fromId)!;
  const others = [...boxes.mcd.values()].filter((r) => r !== entity);
  return {
    associationPosition: position,
    reflexiveBends: reflexiveBends(entity, { ...position, ...size.mcd }, grid, others),
  };
}
