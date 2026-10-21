import type { GridQuality } from "./grid";
import { quantize, shuffle } from "./gridGeometry";
import type { Problem } from "./gridProblem";
import type { State } from "./gridState";

/** Cellules proches de `v` et de ses voisins (rayon `radius`), ou toutes si `radius` est infini. */
function candidates(state: State, v: number, radius: number, out: number[]): number[] {
  const { pb } = state;
  out.length = 0;
  if (!Number.isFinite(radius)) {
    for (let c = 0; c < pb.cells; c += 1) {
      out.push(c);
    }
    return out;
  }
  const seen = new Set<number>();
  const centres = [state.cellOf[v]!, ...pb.incident[v]!.map((e) => state.cellOf[pb.other(e, v)]!)];
  for (const c of centres) {
    const col = c % pb.cols;
    const row = Math.floor(c / pb.cols);
    for (let r = Math.max(0, row - radius); r <= Math.min(pb.rows - 1, row + radius); r += 1) {
      for (let k = Math.max(0, col - radius); k <= Math.min(pb.cols - 1, col + radius); k += 1) {
        const cell = r * pb.cols + k;
        if (!seen.has(cell)) {
          seen.add(cell);
          out.push(cell);
        }
      }
    }
  }
  return out;
}

/** Descente : chaque objet va dans la meilleure cellule (ou s'échange), tant que le coût baisse. */
export function improve(state: State, rnd: () => number, radius: number, maxPasses: number) {
  const { pb } = state;
  const list: number[] = [];
  const order = pb.nodes.map((_, i) => i);
  for (let pass = 0; pass < maxPasses; pass += 1) {
    let improved = false;
    shuffle(order, rnd);
    for (const v of order) {
      const bestCell = bestMove(state, v, radius, list);
      if (bestCell >= 0) {
        state.move(v, bestCell);
        improved = true;
      }
    }
    if (!improved) {
      break;
    }
  }
}

/** Meilleure cellule pour `v` parmi les candidates (variation la plus négative), ou -1. */
function bestMove(state: State, v: number, radius: number, list: number[]): number {
  let best = -1e-9;
  let bestCell = -1;
  for (const cell of candidates(state, v, radius, list)) {
    if (cell === state.cellOf[v]) {
      continue;
    }
    const d = quantize(state.delta(v, cell));
    if (d < best) {
      best = d;
      bestCell = cell;
    }
  }
  return bestCell;
}

/** Aucun défaut : inutile de chercher plus loin (sinon, le budget de travail borne la recherche). */
export const perfect = (q: GridQuality) => q.through + q.crossings + q.closeAngles === 0;

/**
 * Mouvement composé : déplacer un objet très relié (une entité) puis replacer au mieux chacun de
 * ses voisins (ses associations) autour de lui. Un déplacement isolé de l'entité allongerait et
 * croiserait d'abord ses traits ; la recherche simple ne le tenterait jamais.
 */
export function improveCompound(state: State, rnd: () => number, radius: number, maxPasses: number) {
  const { pb } = state;
  const hubs = pb.nodes.map((_, i) => i).filter((v) => pb.incident[v]!.length >= 3);
  const buffers: CompoundBuffers = { cells: [], near: [], undo: [] };
  for (let pass = 0; pass < maxPasses; pass += 1) {
    let improved = false;
    shuffle(hubs, rnd);
    for (const v of hubs) {
      const bestCells = bestCompound(state, v, radius, buffers);
      if (bestCells) {
        state.restore(bestCells);
        improved = true;
      }
    }
    if (!improved) {
      break;
    }
  }
}

/** Tampons réutilisés : cellules autour de l'objet, autour d'un voisin, déplacements à annuler. */
interface CompoundBuffers {
  cells: number[];
  near: number[];
  /** Paires (objet, cellule d'origine), à rejouer à l'envers. */
  undo: number[];
}

/** Meilleure disposition obtenue en déplaçant `v` puis ses voisins, ou `null` si aucune n'améliore. */
function bestCompound(state: State, v: number, radius: number, buffers: CompoundBuffers): Int32Array | null {
  const { cells, undo } = buffers;
  let bestTotal = -1e-9;
  let bestCells: Int32Array | null = null;
  for (const cell of around(state.pb, state.cellOf[v]!, 2, cells).slice()) {
    if (cell === state.cellOf[v]) {
      continue;
    }
    const total = compoundMove(state, v, cell, radius, buffers);
    if (total < bestTotal) {
      bestTotal = total;
      bestCells = Int32Array.from(state.cellOf);
    }
    for (let k = undo.length - 2; k >= 0; k -= 2) {
      state.move(undo[k]!, undo[k + 1]!);
    }
  }
  return bestCells;
}

/**
 * Déplace `v` en `cell`, puis replace au mieux chacun de ses voisins ; renvoie la variation totale
 * (somme des variations locales de chaque étape, géométrie régulière). Les déplacements sont notés
 * dans `undo`.
 */
function compoundMove(state: State, v: number, cell: number, radius: number, buffers: CompoundBuffers): number {
  const { pb } = state;
  const { near, undo } = buffers;
  let total = quantize(state.delta(v, cell));
  undo.length = 0;
  undo.push(v, state.cellOf[v]!);
  state.move(v, cell);
  // Voisins replacés au mieux, près du milieu de leurs propres voisins (position idéale).
  for (const e of pb.incident[v]!) {
    const u = pb.other(e, v);
    let bestDelta = -1e-9;
    let bestCell = -1;
    for (const c of around(pb, idealCell(state, u), radius, near)) {
      if (c === state.cellOf[u] || c === state.cellOf[v]) {
        continue;
      }
      const d = quantize(state.delta(u, c));
      if (d < bestDelta) {
        bestDelta = d;
        bestCell = c;
      }
    }
    if (bestCell >= 0) {
      undo.push(u, state.cellOf[u]!);
      state.move(u, bestCell);
      total += bestDelta;
    }
  }
  return total;
}

/** Cellule la plus proche du barycentre des voisins de `u`. */
function idealCell(state: State, u: number): number {
  const { pb } = state;
  let col = 0;
  let row = 0;
  for (const e of pb.incident[u]!) {
    const c = state.cellOf[pb.other(e, u)]!;
    col += c % pb.cols;
    row += Math.floor(c / pb.cols);
  }
  const k = pb.incident[u]!.length || 1;
  return Math.min(pb.rows - 1, Math.round(row / k)) * pb.cols + Math.min(pb.cols - 1, Math.round(col / k));
}

/** Cellules à `radius` (Tchebychev) d'une cellule. */
function around(pb: Problem, cell: number, radius: number, out: number[]): number[] {
  out.length = 0;
  const col = cell % pb.cols;
  const row = Math.floor(cell / pb.cols);
  for (let r = Math.max(0, row - radius); r <= Math.min(pb.rows - 1, row + radius); r += 1) {
    for (let k = Math.max(0, col - radius); k <= Math.min(pb.cols - 1, col + radius); k += 1) {
      out.push(r * pb.cols + k);
    }
  }
  return out;
}
