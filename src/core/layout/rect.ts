import type { Point } from "../model/document";

/** Géométrie plane des boîtes du schéma, en coordonnées du modèle (placement, traits, sélection). */

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const center = (r: Rect): Point => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 });

/** Point où le segment centre(r) → `toward` sort du rectangle. */
export function clipToRect(r: Rect, toward: Point): Point {
  const c = center(r);
  const dx = toward.x - c.x;
  const dy = toward.y - c.y;
  if (dx === 0 && dy === 0) {
    return c;
  }
  const scale = Math.min(
    dx === 0 ? Number.POSITIVE_INFINITY : r.width / 2 / Math.abs(dx),
    dy === 0 ? Number.POSITIVE_INFINITY : r.height / 2 / Math.abs(dy),
  );
  return { x: c.x + dx * scale, y: c.y + dy * scale };
}

export const intersects = (a: Rect, b: Rect) =>
  a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;

export function normalizeRect(p: Point, q: Point): Rect {
  return { x: Math.min(p.x, q.x), y: Math.min(p.y, q.y), width: Math.abs(p.x - q.x), height: Math.abs(p.y - q.y) };
}
