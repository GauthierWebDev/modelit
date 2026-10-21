import type { Point } from "../model/document";
import type { GridQuality } from "./grid";
import { placeInCell, quantize, shuffle } from "./gridGeometry";
import type { Problem } from "./gridProblem";
import type { State } from "./gridState";

/** Coins des objets quand chaque colonne (ligne) occupée prend la taille de son plus grand objet. */
export function fittedCorners(pb: Problem, cellOf: ArrayLike<number>): Point[] {
  const { origin, gapX, gapY } = pb.options;
  const colW = new Float64Array(pb.cols).fill(-1);
  const rowH = new Float64Array(pb.rows).fill(-1);
  for (let v = 0; v < pb.n; v += 1) {
    const col = cellOf[v]! % pb.cols;
    const row = Math.floor(cellOf[v]! / pb.cols);
    colW[col] = Math.max(colW[col]!, pb.nodes[v]!.width);
    rowH[row] = Math.max(rowH[row]!, pb.nodes[v]!.height);
  }
  const colX = new Float64Array(pb.cols);
  let { x } = origin;
  for (let c = 0; c < pb.cols; c += 1) {
    if (colW[c]! < 0) {
      continue;
    }
    colX[c] = x;
    x += colW[c]! + gapX;
  }
  const rowY = new Float64Array(pb.rows);
  let { y } = origin;
  for (let r = 0; r < pb.rows; r += 1) {
    if (rowH[r]! < 0) {
      continue;
    }
    rowY[r] = y;
    y += rowH[r]! + gapY;
  }
  return pb.nodes.map((node, v) => {
    const col = cellOf[v]! % pb.cols;
    const row = Math.floor(cellOf[v]! / pb.cols);
    const box = placeInCell(node, colW[col]!, rowH[row]!);
    return { x: colX[col]! + box.x, y: rowY[row]! + box.y };
  });
}

/** Départ : parcours en largeur depuis l'objet le plus relié, posé en spirale autour du centre. */
export function initialCells(pb: Problem, rnd: () => number, shuffled: boolean): number[] {
  const order: number[] = [];
  const seen = new Uint8Array(pb.n);
  const starts = pb.nodes.map((_, i) => i).sort((a, b) => pb.incident[b]!.length - pb.incident[a]!.length || a - b);
  for (const s of starts) {
    if (seen[s]) {
      continue;
    }
    const queue = [s];
    seen[s] = 1;
    // biome-ignore lint/style/useForOf: file de parcours en largeur, agrandie pendant la boucle (chemin critique du placement)
    for (let head = 0; head < queue.length; head += 1) {
      const v = queue[head]!;
      order.push(v);
      const next = pb.incident[v]!.map((e) => pb.other(e, v)).filter((u) => !seen[u]);
      if (shuffled) {
        shuffle(next, rnd);
      }
      for (const u of next) {
        seen[u] = 1;
        queue.push(u);
      }
    }
  }
  const midC = (pb.cols - 1) / 2;
  const midR = (pb.rows - 1) / 2;
  const distance = (i: number) => {
    const dc = ((i % pb.cols) - midC) * 1.2;
    const dr = Math.floor(i / pb.cols) - midR;
    return Math.sqrt(dc * dc + dr * dr);
  };
  const cells = Array.from({ length: pb.cells }, (_, i) => i).sort((a, b) => distance(a) - distance(b) || a - b);
  const cellOf = new Array<number>(pb.n);
  order.forEach((v, i) => {
    cellOf[v] = cells[i]!;
  });
  return cellOf;
}

/**
 * Départ par forces (Fruchterman-Reingold) : les objets liés s'attirent, tous se repoussent, ce qui
 * déplie le graphe (peu de croisements) ; les positions sont ensuite rangées dans les cellules les
 * plus proches, en préservant l'ordre des colonnes et des lignes.
 */
export function forceCells(pb: Problem, rnd: () => number): number[] {
  const { n } = pb;
  const x = new Float64Array(n);
  const y = new Float64Array(n);
  for (let v = 0; v < n; v += 1) {
    x[v] = rnd() * 2 - 1;
    y[v] = rnd() * 2 - 1;
  }
  const k = Math.sqrt(4 / n);
  const dx = new Float64Array(n);
  const dy = new Float64Array(n);
  const iterations = 300;
  for (let it = 0; it < iterations; it += 1) {
    dx.fill(0);
    dy.fill(0);
    for (let u = 0; u < n; u += 1) {
      for (let v = u + 1; v < n; v += 1) {
        const ex = x[u]! - x[v]!;
        const ey = y[u]! - y[v]!;
        const d2 = Math.max(ex * ex + ey * ey, 1e-6);
        const f = (k * k) / d2;
        dx[u] = dx[u]! + ex * f;
        dy[u] = dy[u]! + ey * f;
        dx[v] = dx[v]! - ex * f;
        dy[v] = dy[v]! - ey * f;
      }
    }
    for (let e = 0; e < pb.m; e += 1) {
      const a = pb.ea[e]!;
      const b = pb.eb[e]!;
      const ex = x[a]! - x[b]!;
      const ey = y[a]! - y[b]!;
      const d = Math.max(Math.sqrt(ex * ex + ey * ey), 1e-3);
      const f = d / k;
      dx[a] = dx[a]! - ex * f;
      dy[a] = dy[a]! - ey * f;
      dx[b] = dx[b]! + ex * f;
      dy[b] = dy[b]! + ey * f;
    }
    const temperature = 0.1 * (1 - it / iterations) + 0.002;
    for (let v = 0; v < n; v += 1) {
      const d = Math.max(Math.sqrt(dx[v]! * dx[v]! + dy[v]! * dy[v]!), 1e-9);
      const step = Math.min(d, temperature);
      x[v] = x[v]! + (dx[v]! / d) * step;
      y[v] = y[v]! + (dy[v]! / d) * step;
    }
  }
  // Rangs en x et en y → colonnes et lignes (ordre préservé), puis cellule libre la plus proche.
  const rank = (values: Float64Array, slots: number) => {
    const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => values[a]! - values[b]! || a - b);
    const result = new Float64Array(n);
    order.forEach((v, i) => {
      result[v] = n > 1 ? (i / (n - 1)) * (slots - 1) : 0;
    });
    return result;
  };
  const col = rank(x, pb.cols);
  const row = rank(y, pb.rows);
  const taken = new Uint8Array(pb.cells);
  const cellOf = new Array<number>(n);
  const byDegree = Array.from({ length: n }, (_, i) => i).sort(
    (a, b) => pb.incident[b]!.length - pb.incident[a]!.length || a - b,
  );
  for (const v of byDegree) {
    let best = -1;
    let bestD = Number.POSITIVE_INFINITY;
    for (let c = 0; c < pb.cells; c += 1) {
      if (taken[c]) {
        continue;
      }
      const dc = (c % pb.cols) - col[v]!;
      const dr = Math.floor(c / pb.cols) - row[v]!;
      const d = dc * dc + dr * dr;
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    taken[best] = 1;
    cellOf[v] = best;
  }
  return cellOf;
}

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
  const cells: number[] = [];
  const near: number[] = [];
  const undo: number[] = []; // paires (objet, cellule d'origine), à rejouer à l'envers
  for (let pass = 0; pass < maxPasses; pass += 1) {
    let improved = false;
    shuffle(hubs, rnd);
    for (const v of hubs) {
      let bestTotal = -1e-9;
      let bestCells: Int32Array | null = null;
      for (const cell of around(pb, state.cellOf[v]!, 2, cells).slice()) {
        if (cell === state.cellOf[v]) {
          continue;
        }
        // Variation totale = somme des variations locales de chaque étape (géométrie régulière).
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
        if (total < bestTotal) {
          bestTotal = total;
          bestCells = Int32Array.from(state.cellOf);
        }
        for (let k = undo.length - 2; k >= 0; k -= 2) {
          state.move(undo[k]!, undo[k + 1]!);
        }
      }
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
