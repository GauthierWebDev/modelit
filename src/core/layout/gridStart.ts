import type { Point } from "../model/document";
import { placeInCell, shuffle } from "./gridGeometry";
import type { Problem } from "./gridProblem";

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
    repulse(n, k, { x, y, dx, dy });
    attract(pb, k, { x, y, dx, dy });
    const temperature = 0.1 * (1 - it / iterations) + 0.002;
    for (let v = 0; v < n; v += 1) {
      const d = Math.max(Math.sqrt(dx[v]! * dx[v]! + dy[v]! * dy[v]!), 1e-9);
      const step = Math.min(d, temperature);
      x[v] = x[v]! + (dx[v]! / d) * step;
      y[v] = y[v]! + (dy[v]! / d) * step;
    }
  }
  return nearestCells(pb, x, y);
}

/** Positions et déplacements de la simulation par forces. */
interface Forces {
  x: Float64Array;
  y: Float64Array;
  dx: Float64Array;
  dy: Float64Array;
}

/** Tous les objets se repoussent. */
function repulse(n: number, k: number, { x, y, dx, dy }: Forces) {
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
}

/** Les objets liés s'attirent. */
function attract(pb: Problem, k: number, { x, y, dx, dy }: Forces) {
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
}

/** Rangs en x et en y → colonnes et lignes (ordre préservé), puis cellule libre la plus proche. */
function nearestCells(pb: Problem, x: Float64Array, y: Float64Array): number[] {
  const { n } = pb;
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
