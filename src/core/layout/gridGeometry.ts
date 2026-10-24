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
  // Boîtes englobantes strictement séparées : aucun contact possible (même résultat, bien plus rapide).
  if (
    Math.max(px, qx) < Math.min(rx, sx) ||
    Math.max(rx, sx) < Math.min(px, qx) ||
    Math.max(py, qy) < Math.min(ry, sy) ||
    Math.max(ry, sy) < Math.min(py, qy)
  ) {
    return false;
  }
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
  // Segment strictement d'un côté du rectangle : aucun contact possible (même résultat, bien plus rapide).
  if (
    Math.max(px, qx) < cx - hx ||
    Math.min(px, qx) > cx + hx ||
    Math.max(py, qy) < cy - hy ||
    Math.min(py, qy) > cy + hy
  ) {
    return false;
  }
  const dx = qx - px;
  const dy = qy - py;
  clipRange[0] = 0;
  clipRange[1] = 1;
  // Les quatre bords, sans tableau intermédiaire (appel très fréquent).
  return (
    clip(-dx, px - (cx - hx)) &&
    clip(dx, cx + hx - px) &&
    clip(-dy, py - (cy - hy)) &&
    clip(dy, cy + hy - py) &&
    clipRange[0]! < clipRange[1]!
  );
}

/** Intervalle [t0, t1] du segment encore dans le rectangle (tampon réutilisé, sans allocation). */
const clipRange = new Float64Array(2);

/** Restreint `clipRange` par un bord (p, q) de Liang-Barsky ; faux si le segment sort du rectangle. */
function clip(p: number, q: number): boolean {
  if (p === 0) {
    return !(q < 0);
  }
  const r = q / p;
  if (p < 0) {
    if (r > clipRange[1]!) {
      return false;
    }
    if (r > clipRange[0]!) {
      clipRange[0] = r;
    }
  } else {
    if (r < clipRange[0]!) {
      return false;
    }
    if (r < clipRange[1]!) {
      clipRange[1] = r;
    }
  }
  return true;
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
