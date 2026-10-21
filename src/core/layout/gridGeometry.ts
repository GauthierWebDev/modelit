// biome-ignore-all lint/suspicious/noBitwiseOperators: générateur pseudo-aléatoire en entiers 32 bits (O-34)
import type { Point } from "../model/document";
import type { GridNode } from "./grid";

/**
 * Reproductibilité : le moteur JavaScript peut calculer certaines fonctions (trigonométrie,
 * `hypot`, puissances) au dernier bit près différemment selon que le code est interprété ou
 * optimisé ; deux options de coût presque égal seraient alors départagées au hasard. Le calcul
 * n'utilise que + − × ÷ √ (exacts en IEEE 754), et les coûts sont arrondis avant comparaison.
 */
export const quantize = (x: number) => Math.round(x * 1e6) / 1e6;

const orient = (ax: number, ay: number, bx: number, by: number, cx: number, cy: number) =>
  (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);

/** Intersection stricte de deux segments (extrémités partagées exclues) ; recouvrement colinéaire compris. */
export function segmentsCross(
  px: number,
  py: number,
  qx: number,
  qy: number,
  rx: number,
  ry: number,
  sx: number,
  sy: number,
): boolean {
  const d1 = orient(rx, ry, sx, sy, px, py);
  const d2 = orient(rx, ry, sx, sy, qx, qy);
  const d3 = orient(px, py, qx, qy, rx, ry);
  const d4 = orient(px, py, qx, qy, sx, sy);
  if (((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))) {
    return true;
  }
  if (d1 === 0 && d2 === 0) {
    const overlap = (u: number, v: number, w: number, z: number) =>
      Math.min(Math.max(u, v), Math.max(w, z)) - Math.max(Math.min(u, v), Math.min(w, z));
    return overlap(px, qx, rx, sx) > 1e-6 || overlap(py, qy, ry, sy) > 1e-6;
  }
  return false;
}

/** Le segment traverse-t-il le rectangle centré en (cx, cy), de demi-dimensions hx, hy ? (Liang-Barsky) */
export function segmentHitsBox(
  px: number,
  py: number,
  qx: number,
  qy: number,
  cx: number,
  cy: number,
  hx: number,
  hy: number,
): boolean {
  const dx = qx - px;
  const dy = qy - py;
  let t0 = 0;
  let t1 = 1;
  const ps = [-dx, dx, -dy, dy];
  const qs = [px - (cx - hx), cx + hx - px, py - (cy - hy), cy + hy - py];
  for (let i = 0; i < 4; i += 1) {
    const p = ps[i]!;
    const q = qs[i]!;
    if (p === 0) {
      if (q < 0) {
        return false;
      }
      continue;
    }
    const r = q / p;
    if (p < 0) {
      if (r > t1) {
        return false;
      }
      if (r > t0) {
        t0 = r;
      }
    } else {
      if (r < t0) {
        return false;
      }
      if (r < t1) {
        t1 = r;
      }
    }
  }
  return t0 < t1;
}

/**
 * Mélange de Fisher-Yates, déterministe pour un générateur donné. Surtout pas
 * `sort(() => rnd() - 0.5)` : avec un comparateur incohérent, l'ordre obtenu dépend de
 * l'implémentation du tri, qui change quand le moteur JavaScript optimise le code.
 */
export function shuffle<T>(items: T[], rnd: () => number): T[] {
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rnd() * (i + 1));
    const tmp = items[i]!;
    items[i] = items[j]!;
    items[j] = tmp;
  }
  return items;
}

/** Générateur pseudo-aléatoire déterministe (mulberry32). */
export function random(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d_2b_79_f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/** Coin de l'objet dans une cellule `w` × `h` : centré sur sa taille MCD, sans que sa plus grande boîte (MPD) en sorte. */
export function placeInCell(node: GridNode, w: number, h: number): Point {
  return {
    x: Math.max(0, Math.min((w - (node.mcdWidth ?? node.width)) / 2, w - node.width)),
    y: Math.max(0, Math.min((h - (node.mcdHeight ?? node.height)) / 2, h - node.height)),
  };
}
