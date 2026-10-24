import type { GridQuality } from "./grid";
import { segmentHitsBox, segmentsCross } from "./gridGeometry";
import type { State } from "./gridState";

const WEIGHT = { through: 150, crossing: 60, angle: 20, length: 1 };

/** En dessous de cet angle, deux traits issus d'un même objet sont jugés confondus. */
/** cos(20°), en littéral : pas de trigonométrie à l'exécution (voir `quantize`). */
const COS_MIN_ANGLE = 0.939_692_620_785_908_4;

function lengthTerm(s: State, e: number, quality?: GridQuality): number {
  const { pb } = s;
  const a = pb.ea[e]!;
  const b = pb.eb[e]!;
  const dx = (s.px[a]! - s.px[b]!) / pb.unitW;
  const dy = (s.py[a]! - s.py[b]!) / pb.unitH;
  const d = Math.sqrt(dx * dx + dy * dy);
  let cost = WEIGHT.length * (d + d * d);
  if (pb.double[e]) {
    const ca = s.cellOf[a]!;
    const cb = s.cellOf[b]!;
    if (ca % pb.cols === cb % pb.cols || Math.floor(ca / pb.cols) === Math.floor(cb / pb.cols)) {
      cost += WEIGHT.angle;
      if (quality) {
        quality.closeAngles += 1;
      }
    }
  }
  return cost;
}

/**
 * Boîtes englobantes des traits `e` et `f` strictement séparées : ni croisement, ni boucle coupée (la zone
 * d'une réflexive est dans la boîte de son trait). Pré-test exact, sans appel : la plupart des paires sont loin.
 */
const apart = (s: State, e: number, f: number) =>
  s.maxX[e]! < s.minX[f]! || s.maxX[f]! < s.minX[e]! || s.maxY[e]! < s.minY[f]! || s.maxY[f]! < s.minY[e]!;

/** Trait `e` strictement d'un côté de la boîte de l'objet `w` : il ne la traverse pas (pré-test exact). */
const clear = (s: State, e: number, w: number) =>
  s.maxX[e]! < s.px[w]! - s.pb.halfW[w]! ||
  s.minX[e]! > s.px[w]! + s.pb.halfW[w]! ||
  s.maxY[e]! < s.py[w]! - s.pb.halfH[w]! ||
  s.minY[e]! > s.py[w]! + s.pb.halfH[w]!;

/** Croisement ou boucle coupée entre `e` et `f`. */
const conflict = (s: State, e: number, f: number) =>
  !apart(s, e, f) && (crosses(s, e, f) || cutsLoop(s, e, f) || cutsLoop(s, f, e));

function crosses(s: State, e: number, f: number): boolean {
  const { pb, px, py } = s;
  const a = pb.ea[e]!;
  const b = pb.eb[e]!;
  const c = pb.ea[f]!;
  const d = pb.eb[f]!;
  if (a === c || a === d || b === c || b === d) {
    return false;
  }
  return segmentsCross(px[a]!, py[a]!, px[b]!, py[b]!, px[c]!, py[c]!, px[d]!, py[d]!);
}

/**
 * La seconde patte d'une réflexive `e` contourne la zone comprise entre l'association et son
 * entité : un autre trait `f` qui traverse cette zone coupera forcément la boucle.
 */
function cutsLoop(s: State, e: number, f: number): boolean {
  const { pb, px, py } = s;
  if (!pb.double[e]) {
    return false;
  }
  const a = pb.ea[e]!;
  const b = pb.eb[e]!;
  const c = pb.ea[f]!;
  const d = pb.eb[f]!;
  if (c === a || d === a) {
    return false;
  }
  const cx = (px[a]! + px[b]!) / 2;
  const cy = (py[a]! + py[b]!) / 2;
  // Zone légèrement réduite : les centres (coins de la zone) restent dehors, seul un trait qui y entre compte.
  const hx = Math.abs(px[a]! - px[b]!) / 2 - 1;
  const hy = Math.abs(py[a]! - py[b]!) / 2 - 1;
  if (hx <= 0 || hy <= 0) {
    return false; // réflexive alignée : pénalisée par ailleurs
  }
  return segmentHitsBox(px[c]!, py[c]!, px[d]!, py[d]!, cx, cy, hx, hy);
}

function hits(s: State, e: number, w: number): boolean {
  const { pb, px, py } = s;
  const a = pb.ea[e]!;
  const b = pb.eb[e]!;
  if (clear(s, e, w) || w === a || w === b) {
    return false;
  }
  return segmentHitsBox(px[a]!, py[a]!, px[b]!, py[b]!, px[w]!, py[w]!, pb.halfW[w]!, pb.halfH[w]!);
}

function angleTerm(s: State, v: number, e: number, f: number, quality?: GridQuality): number {
  const { pb, px, py } = s;
  const u = pb.other(e, v);
  const w = pb.other(f, v);
  // Angle entre les deux traits par son cosinus (produit scalaire) : pas de trigonométrie.
  const ux = px[u]! - px[v]!;
  const uy = py[u]! - py[v]!;
  const wx = px[w]! - px[v]!;
  const wy = py[w]! - py[v]!;
  const norms = Math.sqrt((ux * ux + uy * uy) * (wx * wx + wy * wy));
  const cos = norms > 0 ? (ux * wx + uy * wy) / norms : 1;
  if (cos <= COS_MIN_ANGLE) {
    return 0;
  }
  if (quality) {
    quality.closeAngles += 1;
  }
  return WEIGHT.angle * ((cos - COS_MIN_ANGLE) / (1 - COS_MIN_ANGLE) + 0.2);
}

/** Coût complet ; chaque terme compté une fois. */
export function fullCost(s: State, quality?: GridQuality): number {
  s.refresh();
  const { pb } = s;
  pb.work += (pb.m * (pb.m + 2 * pb.n)) / 2;
  let cost = 0;
  for (let e = 0; e < pb.m; e += 1) {
    cost += lengthTerm(s, e, quality);
  }
  for (let e = 0; e < pb.m; e += 1) {
    cost = edgeConflicts(s, e, cost, quality);
  }
  for (let v = 0; v < pb.n; v += 1) {
    cost = nodeAngles(s, v, cost, quality);
  }
  return cost;
}

/** Croisements de `e` avec les traits suivants, puis objets que `e` traverse (ajoutés à `cost`, dans l'ordre). */
function edgeConflicts(s: State, e: number, cost: number, quality?: GridQuality): number {
  const { pb } = s;
  let total = cost;
  for (let f = e + 1; f < pb.m; f += 1) {
    if (conflict(s, e, f)) {
      total += WEIGHT.crossing;
      if (quality) {
        quality.crossings += 1;
      }
    }
  }
  for (let w = 0; w < pb.n; w += 1) {
    if (hits(s, e, w)) {
      total += WEIGHT.through;
      if (quality) {
        quality.through += 1;
      }
    }
  }
  return total;
}

/** Angles entre les traits issus de `v` (ajoutés à `cost`, dans l'ordre). */
function nodeAngles(s: State, v: number, cost: number, quality?: GridQuality): number {
  const list = s.pb.incident[v]!;
  let total = cost;
  for (let i = 0; i < list.length; i += 1) {
    for (let j = i + 1; j < list.length; j += 1) {
      total += angleTerm(s, v, list[i]!, list[j]!, quality);
    }
  }
  return total;
}

/**
 * Coût des seuls termes qui font intervenir `v` ou `w` (w = -1 : aucun). En géométrie régulière,
 * ce sont les seuls qui changent quand on les déplace : la différence avant / après suffit.
 */
export function partialCost(s: State, v: number, w: number): number {
  const { pb } = s;
  pb.work += (pb.incident[v]!.length + (w >= 0 ? pb.incident[w]!.length : 0) + 1) * (pb.m + pb.n);
  s.stamp += 1;
  const { stamp } = s;
  s.nodeMark[v] = stamp;
  if (w >= 0) {
    s.nodeMark[w] = stamp;
  }
  const { touchedCount, cornerCount } = markTouched(s, v, w, stamp);
  let cost = 0;
  for (let i = 0; i < touchedCount; i += 1) {
    cost = touchedEdgeCost(s, s.touched[i]!, stamp, cost);
  }
  for (const x of w >= 0 ? [v, w] : [v]) {
    for (let e = 0; e < pb.m; e += 1) {
      if (s.edgeMark[e] !== stamp && hits(s, e, x)) {
        cost += WEIGHT.through;
      }
    }
  }
  for (let i = 0; i < cornerCount; i += 1) {
    cost = cornerAngles(s, s.corners[i]!, stamp, cost);
  }
  return cost;
}

/** Marque les traits issus de `v` et `w`, et leurs extrémités (coins dont les angles changent). */
function markTouched(s: State, v: number, w: number, stamp: number) {
  const { pb } = s;
  let touchedCount = 0;
  let cornerCount = 0;
  const addCorner = (x: number) => {
    if (s.cornerMark[x] !== stamp) {
      s.cornerMark[x] = stamp;
      s.corners[cornerCount] = x;
      cornerCount += 1;
    }
  };
  for (const x of w >= 0 ? [v, w] : [v]) {
    addCorner(x);
    for (const e of pb.incident[x]!) {
      if (s.edgeMark[e] === stamp) {
        continue;
      }
      s.edgeMark[e] = stamp;
      s.touched[touchedCount] = e;
      touchedCount += 1;
      addCorner(pb.ea[e]!);
      addCorner(pb.eb[e]!);
    }
  }
  return { touchedCount, cornerCount };
}

/** Longueur, croisements (chaque paire de traits marqués une seule fois) et traversées d'un trait marqué. */
function touchedEdgeCost(s: State, e: number, stamp: number, cost: number): number {
  const { pb } = s;
  let total = cost + lengthTerm(s, e);
  for (let f = 0; f < pb.m; f += 1) {
    if (f === e || (s.edgeMark[f] === stamp && f < e)) {
      continue;
    }
    if (conflict(s, e, f)) {
      total += WEIGHT.crossing;
    }
  }
  for (let x = 0; x < pb.n; x += 1) {
    if (hits(s, e, x)) {
      total += WEIGHT.through;
    }
  }
  return total;
}

/** Angles au coin `x` qui font intervenir un objet ou un trait marqué. */
function cornerAngles(s: State, x: number, stamp: number, cost: number): number {
  const list = s.pb.incident[x]!;
  let total = cost;
  for (let a = 0; a < list.length; a += 1) {
    for (let b = a + 1; b < list.length; b += 1) {
      const e = list[a]!;
      const f = list[b]!;
      if (s.nodeMark[x] === stamp || s.edgeMark[e] === stamp || s.edgeMark[f] === stamp) {
        total += angleTerm(s, x, e, f);
      }
    }
  }
  return total;
}
