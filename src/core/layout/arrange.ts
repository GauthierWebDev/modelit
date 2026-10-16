import type { Point } from "../model/document";

/**
 * Aligner et répartir des objets (override O-57). Les boîtes sont celles de la vue courante ; le
 * résultat est un décalage par objet, à ajouter à sa position (non ramené sur la grille).
 */

export interface Box {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export type Alignment = "left" | "center" | "right" | "top" | "middle" | "bottom";
export type DistributeAxis = "horizontal" | "vertical";

export const ALIGNMENTS: Alignment[] = ["left", "center", "right", "top", "middle", "bottom"];

/** Aligne sur l'emprise de la sélection : bord extrême, ou centre de l'emprise. */
export function alignBoxes(boxes: Box[], alignment: Alignment): Map<string, Point> {
  const offsets = new Map<string, Point>();
  if (boxes.length < 2) return offsets;
  const left = Math.min(...boxes.map((b) => b.x));
  const right = Math.max(...boxes.map((b) => b.x + b.width));
  const top = Math.min(...boxes.map((b) => b.y));
  const bottom = Math.max(...boxes.map((b) => b.y + b.height));
  for (const b of boxes) {
    const dx =
      alignment === "left"
        ? left - b.x
        : alignment === "right"
          ? right - b.x - b.width
          : alignment === "center"
            ? (left + right) / 2 - b.x - b.width / 2
            : 0;
    const dy =
      alignment === "top"
        ? top - b.y
        : alignment === "bottom"
          ? bottom - b.y - b.height
          : alignment === "middle"
            ? (top + bottom) / 2 - b.y - b.height / 2
            : 0;
    if (dx || dy) offsets.set(b.id, { x: dx, y: dy });
  }
  return offsets;
}

/**
 * Répartit avec le même espace entre deux voisins (de bord à bord) ; les deux objets extrêmes ne
 * bougent pas, les autres gardent leur ordre.
 */
export function distributeBoxes(boxes: Box[], axis: DistributeAxis): Map<string, Point> {
  const offsets = new Map<string, Point>();
  if (boxes.length < 3) return offsets;
  const start = (b: Box) => (axis === "horizontal" ? b.x : b.y);
  const size = (b: Box) => (axis === "horizontal" ? b.width : b.height);
  const sorted = [...boxes].sort((a, b) => start(a) - start(b) || start(a) + size(a) - start(b) - size(b));
  const first = sorted[0]!;
  const last = sorted.at(-1)!;
  const span = start(last) + size(last) - start(first);
  const occupied = sorted.reduce((sum, b) => sum + size(b), 0);
  const gap = (span - occupied) / (sorted.length - 1);
  let cursor = start(first) + size(first) + gap;
  for (const b of sorted.slice(1, -1)) {
    const delta = cursor - start(b);
    if (delta) offsets.set(b.id, axis === "horizontal" ? { x: delta, y: 0 } : { x: 0, y: delta });
    cursor += size(b) + gap;
  }
  return offsets;
}
