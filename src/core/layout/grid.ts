// biome-ignore-all lint/suspicious/noBitwiseOperators: générateur pseudo-aléatoire et grille en entiers (O-34)
import type { Point } from "../model/document";

/**
 * Placement automatique lisible (overrides O-30, O-31) : les objets du MCD (entités, associations,
 * héritages) sont posés dans les cellules d'une grille, puis déplacés ou échangés tant que la
 * disposition s'améliore.
 *
 * Coût minimisé, par ordre d'importance :
 *  1. un trait qui traverse un objet ;
 *  2. deux traits qui se croisent ;
 *  3. deux traits qui partent d'un même objet presque dans la même direction (cardinalités
 *     superposées), ou une réflexive alignée sur son entité ;
 *  4. la longueur des traits, les longs traits comptant davantage (schéma compact, association
 *     au milieu de ses entités).
 *
 * Deux géométries :
 *  - régulière (toutes les cellules à la taille du plus grand objet) : un déplacement ne change que
 *    la position de l'objet déplacé, son coût se calcule localement — c'est la recherche, rapide ;
 *  - exacte (chaque colonne / ligne à la taille de son plus grand objet, vides retirées) : c'est
 *    l'affichage final ; un court polissage y corrige les défauts créés par ce resserrage.
 * Aucune boîte ne chevauche une autre, dans aucune vue : chaque cellule contient la plus grande
 * boîte de son objet (MPD compris).
 *
 * Performances : tableaux typés, aucune allocation dans la boucle de recherche, coût incrémental
 * (seuls les termes touchés par le déplacement sont recalculés).
 */

export interface GridNode {
  id: string;
  /** Plus grandes dimensions de l'objet, toutes vues confondues. */
  width: number;
  height: number;
  /** Dimensions dans le MCD (centrage dans la cellule) ; par défaut, les précédentes. */
  mcdWidth?: number;
  mcdHeight?: number;
}

export interface GridEdge {
  a: string;
  b: string;
}

export interface GridOptions {
  origin: Point;
  gapX: number;
  gapY: number;
}

export interface GridQuality {
  through: number;
  crossings: number;
  closeAngles: number;
}

export interface GridLayoutResult {
  positions: Map<string, Point>;
  quality: GridQuality;
}

const DEFAULTS: GridOptions = { origin: { x: 40, y: 40 }, gapX: 70, gapY: 60 };

/**
 * Les départs sont répartis en lots fixes, indépendants : l'interface peut les calculer en
 * parallèle (un Web Worker par lot). Chaque lot s'arrête dès qu'il trouve une disposition sans
 * défaut. Règle de choix : le premier lot (par numéro) sans défaut l'emporte, sinon le coût le plus
 * faible. Dès qu'un lot k est parfait et que les lots 0 … k-1 sont connus, la décision est prise :
 * les autres lots peuvent être abandonnés. Le résultat ne dépend pas du nombre de cœurs.
 */
export const LAYOUT_CHUNKS = 8;
const RUNS_PER_CHUNK = 2;

/** Proportions visées (largeur / hauteur). */
const ASPECT = 4 / 3;
/** Au-delà de cette taille, seules les cellules proches sont essayées. */
const LOCAL_SEARCH_ABOVE = 20;
const RADIUS = 2;
/** Polissage en géométrie exacte : cellules voisines seulement, quelques passes. */
const POLISH_RADIUS = 2;
const POLISH_PASSES = 4;
/**
 * Budget de travail (opérations géométriques) au-delà duquel on ne relance plus de départ :
 * borne le temps de calcul (≈ 0,2 s) tout en restant déterministe, contrairement à un délai.
 */
const WORK_BUDGET = 2e7;

const WEIGHT = { through: 150, crossing: 60, angle: 20, length: 1 };
/** En dessous de cet angle, deux traits issus d'un même objet sont jugés confondus. */
/** cos(20°), en littéral : pas de trigonométrie à l'exécution (voir `quantize`). */
const COS_MIN_ANGLE = 0.939_692_620_785_908_4;

/**
 * Reproductibilité : le moteur JavaScript peut calculer certaines fonctions (trigonométrie,
 * `hypot`, puissances) au dernier bit près différemment selon que le code est interprété ou
 * optimisé ; deux options de coût presque égal seraient alors départagées au hasard. Le calcul
 * n'utilise que + − × ÷ √ (exacts en IEEE 754), et les coûts sont arrondis avant comparaison.
 */
const quantize = (x: number) => Math.round(x * 1e6) / 1e6;

// ---------------------------------------------------------------------------------------------
// Géométrie

const orient = (ax: number, ay: number, bx: number, by: number, cx: number, cy: number) =>
  (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);

/** Intersection stricte de deux segments (extrémités partagées exclues) ; recouvrement colinéaire compris. */
function segmentsCross(
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
function segmentHitsBox(
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
function shuffle<T>(items: T[], rnd: () => number): T[] {
  for (let i = items.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rnd() * (i + 1));
    const tmp = items[i]!;
    items[i] = items[j]!;
    items[j] = tmp;
  }
  return items;
}

/** Générateur pseudo-aléatoire déterministe (mulberry32). */
function random(seed: number) {
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
function placeInCell(node: GridNode, w: number, h: number): Point {
  return {
    x: Math.max(0, Math.min((w - (node.mcdWidth ?? node.width)) / 2, w - node.width)),
    y: Math.max(0, Math.min((h - (node.mcdHeight ?? node.height)) / 2, h - node.height)),
  };
}

// ---------------------------------------------------------------------------------------------
// Problème

class Problem {
  readonly n: number;
  readonly m: number;
  readonly cols: number;
  readonly rows: number;
  readonly cells: number;
  readonly cellW: number;
  readonly cellH: number;
  readonly unitW: number;
  readonly unitH: number;
  /** Extrémités des arêtes dédoublonnées (une réflexive ne compte qu'une fois). */
  readonly ea: Int32Array;
  readonly eb: Int32Array;
  /** Arête doublée : les deux pattes d'une réflexive. */
  readonly double: Uint8Array;
  readonly incident: number[][];
  /** Travail effectué (opérations géométriques), pour borner la recherche de façon déterministe. */
  work = 0;
  readonly halfW: Float64Array;
  readonly halfH: Float64Array;
  /** Centre MCD dans une cellule régulière, par rapport à son coin. */
  readonly offX: Float64Array;
  readonly offY: Float64Array;
  readonly width: Float64Array;
  readonly height: Float64Array;
  readonly mcdW: Float64Array;
  readonly mcdH: Float64Array;

  constructor(
    readonly nodes: GridNode[],
    edges: GridEdge[],
    readonly options: GridOptions,
  ) {
    const n = nodes.length;
    this.n = n;
    // Géométrie de recherche : cellules de taille moyenne, plus proches de l'affichage final
    // (colonnes ajustées à leur contenu) que des cellules à la taille du plus grand objet.
    const mean = (f: (x: GridNode) => number) => nodes.reduce((sum, x) => sum + f(x), 0) / n;
    this.cellW = mean((x) => x.width) + options.gapX;
    this.cellH = mean((x) => x.height) + options.gapY;
    this.unitW = Math.max(...nodes.map((x) => x.mcdWidth ?? x.width)) + options.gapX;
    this.unitH = Math.max(...nodes.map((x) => x.mcdHeight ?? x.height)) + options.gapY;
    // Grille un peu plus grande que nécessaire (place pour les déplacements), aux proportions ≈ 4:3.
    const wanted = Math.max(4, Math.ceil(n * 1.8));
    // Forme de la grille : d'après les plus grandes boîtes (celles qui fixent les colonnes larges).
    const widest = Math.max(...nodes.map((x) => x.width)) + options.gapX;
    const tallest = Math.max(...nodes.map((x) => x.height)) + options.gapY;
    this.cols = Math.max(2, Math.round(Math.sqrt((wanted * ASPECT * tallest) / widest)));
    this.rows = Math.max(2, Math.ceil(wanted / this.cols));
    this.cells = this.cols * this.rows;

    const index = new Map(nodes.map((x, i) => [x.id, i]));
    const pairs: [number, number][] = [];
    const doubled: number[] = [];
    const seen = new Map<string, number>();
    for (const e of edges) {
      const a = index.get(e.a);
      const b = index.get(e.b);
      if (a === undefined || b === undefined || a === b) {
        continue;
      }
      const key = a < b ? `${a}:${b}` : `${b}:${a}`;
      const known = seen.get(key);
      if (known !== undefined) {
        doubled[known] = 1;
        continue;
      }
      seen.set(key, pairs.length);
      pairs.push([a, b]);
      doubled.push(0);
    }
    this.m = pairs.length;
    this.ea = Int32Array.from(pairs.map((p) => p[0]));
    this.eb = Int32Array.from(pairs.map((p) => p[1]));
    this.double = Uint8Array.from(doubled);
    this.incident = nodes.map(() => []);
    pairs.forEach(([a, b], i) => {
      this.incident[a]!.push(i);
      this.incident[b]!.push(i);
    });
    // Boîte d'obstacle : taille MCD, légèrement agrandie (marge autour des objets).
    this.halfW = Float64Array.from(nodes.map((x) => (x.mcdWidth ?? x.width) / 2 + 12));
    this.halfH = Float64Array.from(nodes.map((x) => (x.mcdHeight ?? x.height) / 2 + 10));
    this.width = Float64Array.from(nodes.map((x) => x.width));
    this.height = Float64Array.from(nodes.map((x) => x.height));
    this.mcdW = Float64Array.from(nodes.map((x) => x.mcdWidth ?? x.width));
    this.mcdH = Float64Array.from(nodes.map((x) => x.mcdHeight ?? x.height));
    this.offX = new Float64Array(n);
    this.offY = new Float64Array(n);
    nodes.forEach((x, v) => {
      const box = placeInCell(
        x,
        Math.max(x.width, this.cellW - options.gapX),
        Math.max(x.height, this.cellH - options.gapY),
      );
      this.offX[v] = box.x + (x.mcdWidth ?? x.width) / 2;
      this.offY[v] = box.y + (x.mcdHeight ?? x.height) / 2;
    });
  }

  other(e: number, v: number) {
    return this.ea[e] === v ? this.eb[e]! : this.ea[e]!;
  }
}

// ---------------------------------------------------------------------------------------------
// État et coût

class State {
  readonly cellOf: Int32Array;
  readonly nodeAt: Int32Array;
  readonly px: Float64Array;
  readonly py: Float64Array;
  private dirty = true;
  // Marques réutilisées (pas d'allocation dans la boucle de recherche).
  private stamp = 0;
  private readonly edgeMark: Int32Array;
  private readonly nodeMark: Int32Array;
  private readonly cornerMark: Int32Array;
  private readonly touched: Int32Array;
  private readonly corners: Int32Array;
  // Géométrie exacte : tailles et origines des colonnes / lignes, et tampons de comparaison.
  private readonly colW: Float64Array;
  private readonly rowH: Float64Array;
  private readonly colX: Float64Array;
  private readonly rowY: Float64Array;
  private readonly tmpW: Float64Array;
  private readonly tmpH: Float64Array;

  constructor(
    readonly pb: Problem,
    cellOf: ArrayLike<number>,
    /** Géométrie exacte (affichage final) plutôt que régulière. */
    readonly exact: boolean,
  ) {
    this.cellOf = Int32Array.from(cellOf);
    this.nodeAt = new Int32Array(pb.cells).fill(-1);
    this.cellOf.forEach((c, v) => {
      this.nodeAt[c] = v;
    });
    this.px = new Float64Array(pb.n);
    this.py = new Float64Array(pb.n);
    this.edgeMark = new Int32Array(pb.m);
    this.nodeMark = new Int32Array(pb.n);
    this.cornerMark = new Int32Array(pb.n);
    this.touched = new Int32Array(pb.m);
    this.corners = new Int32Array(pb.n);
    this.colW = new Float64Array(pb.cols);
    this.rowH = new Float64Array(pb.rows);
    this.colX = new Float64Array(pb.cols);
    this.rowY = new Float64Array(pb.rows);
    this.tmpW = new Float64Array(pb.cols);
    this.tmpH = new Float64Array(pb.rows);
    if (!exact) {
      for (let v = 0; v < pb.n; v += 1) {
        this.locate(v);
      }
    }
  }

  private locate(v: number) {
    const c = this.cellOf[v]!;
    this.px[v] = (c % this.pb.cols) * this.pb.cellW + this.pb.offX[v]!;
    this.py[v] = Math.floor(c / this.pb.cols) * this.pb.cellH + this.pb.offY[v]!;
  }

  /** Déplace `v` en `cell`, en échangeant avec l'occupant éventuel (positions non mises à jour). */
  private swap(v: number, cell: number) {
    const from = this.cellOf[v]!;
    const w = this.nodeAt[cell]!;
    this.nodeAt[from] = -1;
    if (w >= 0) {
      this.cellOf[w] = from;
      this.nodeAt[from] = w;
    }
    this.cellOf[v] = cell;
    this.nodeAt[cell] = v;
  }

  /** Déplace `v` en `cell`, en échangeant avec l'occupant éventuel. */
  move(v: number, cell: number) {
    const w = this.nodeAt[cell]!;
    this.swap(v, cell);
    if (this.exact) {
      this.dirty = true;
    } else {
      this.locate(v);
      if (w >= 0) {
        this.locate(w);
      }
    }
  }

  /** Rétablit une disposition enregistrée (`cellOf`). */
  restore(cells: Int32Array) {
    this.cellOf.set(cells);
    this.nodeAt.fill(-1);
    for (let v = 0; v < this.pb.n; v += 1) {
      this.nodeAt[cells[v]!] = v;
    }
    if (this.exact) {
      this.dirty = true;
    } else {
      for (let v = 0; v < this.pb.n; v += 1) {
        this.locate(v);
      }
    }
  }

  /** Tailles des colonnes / lignes de la disposition courante, dans `w` et `h` (-1 : vide). */
  private measure(w: Float64Array, h: Float64Array) {
    const { pb } = this;
    w.fill(-1);
    h.fill(-1);
    for (let v = 0; v < pb.n; v += 1) {
      const c = this.cellOf[v]!;
      const col = c % pb.cols;
      const row = (c - col) / pb.cols;
      if (pb.width[v]! > w[col]!) {
        w[col] = pb.width[v]!;
      }
      if (pb.height[v]! > h[row]!) {
        h[row] = pb.height[v]!;
      }
    }
  }

  /** Les tailles des colonnes et des lignes sont-elles celles de la dernière géométrie calculée ? */
  private sameSizes(): boolean {
    this.measure(this.tmpW, this.tmpH);
    for (let c = 0; c < this.pb.cols; c += 1) {
      if (this.tmpW[c] !== this.colW[c]) {
        return false;
      }
    }
    for (let r = 0; r < this.pb.rows; r += 1) {
      if (this.tmpH[r] !== this.rowH[r]) {
        return false;
      }
    }
    return true;
  }

  /** Centre exact de `v` dans la géométrie courante (colonnes et lignes inchangées). */
  private locateExact(v: number) {
    const { pb } = this;
    const c = this.cellOf[v]!;
    const col = c % pb.cols;
    const row = (c - col) / pb.cols;
    // Même règle que placeInCell : centré sur la taille MCD, la plus grande boîte restant dans la cellule.
    const w = this.colW[col]!;
    const h = this.rowH[row]!;
    const dx = Math.max(0, Math.min((w - pb.mcdW[v]!) / 2, w - pb.width[v]!));
    const dy = Math.max(0, Math.min((h - pb.mcdH[v]!) / 2, h - pb.height[v]!));
    this.px[v] = this.colX[col]! + dx + pb.mcdW[v]! / 2;
    this.py[v] = this.rowY[row]! + dy + pb.mcdH[v]! / 2;
  }

  /** Géométrie exacte : centres MCD après ajustement des colonnes et des lignes. */
  refresh() {
    if (!(this.exact && this.dirty)) {
      return;
    }
    const { pb, colW, rowH, colX, rowY } = this;
    const { origin, gapX, gapY } = pb.options;
    this.measure(colW, rowH);
    let x = origin.x;
    for (let c = 0; c < pb.cols; c += 1) {
      colX[c] = x;
      if (colW[c]! >= 0) {
        x += colW[c]! + gapX;
      }
    }
    let y = origin.y;
    for (let r = 0; r < pb.rows; r += 1) {
      rowY[r] = y;
      if (rowH[r]! >= 0) {
        y += rowH[r]! + gapY;
      }
    }
    for (let v = 0; v < pb.n; v += 1) {
      this.locateExact(v);
    }
    this.dirty = false;
  }

  private lengthTerm(e: number, quality?: GridQuality): number {
    const { pb } = this;
    const a = pb.ea[e]!;
    const b = pb.eb[e]!;
    const dx = (this.px[a]! - this.px[b]!) / pb.unitW;
    const dy = (this.py[a]! - this.py[b]!) / pb.unitH;
    const d = Math.sqrt(dx * dx + dy * dy);
    let cost = WEIGHT.length * (d + d * d);
    if (pb.double[e]) {
      const ca = this.cellOf[a]!;
      const cb = this.cellOf[b]!;
      if (ca % pb.cols === cb % pb.cols || Math.floor(ca / pb.cols) === Math.floor(cb / pb.cols)) {
        cost += WEIGHT.angle;
        if (quality) {
          quality.closeAngles += 1;
        }
      }
    }
    return cost;
  }

  private crosses(e: number, f: number): boolean {
    const { pb, px, py } = this;
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
  private cutsLoop(e: number, f: number): boolean {
    const { pb, px, py } = this;
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

  private hits(e: number, w: number): boolean {
    const { pb, px, py } = this;
    const a = pb.ea[e]!;
    const b = pb.eb[e]!;
    if (w === a || w === b) {
      return false;
    }
    return segmentHitsBox(px[a]!, py[a]!, px[b]!, py[b]!, px[w]!, py[w]!, pb.halfW[w]!, pb.halfH[w]!);
  }

  private angleTerm(v: number, e: number, f: number, quality?: GridQuality): number {
    const { pb, px, py } = this;
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
  totalCost(quality?: GridQuality): number {
    this.refresh();
    const { pb } = this;
    pb.work += (pb.m * (pb.m + 2 * pb.n)) / 2;
    let cost = 0;
    for (let e = 0; e < pb.m; e += 1) {
      cost += this.lengthTerm(e, quality);
    }
    for (let e = 0; e < pb.m; e += 1) {
      for (let f = e + 1; f < pb.m; f += 1) {
        if (this.crosses(e, f) || this.cutsLoop(e, f) || this.cutsLoop(f, e)) {
          cost += WEIGHT.crossing;
          if (quality) {
            quality.crossings += 1;
          }
        }
      }
      for (let w = 0; w < pb.n; w += 1) {
        if (this.hits(e, w)) {
          cost += WEIGHT.through;
          if (quality) {
            quality.through += 1;
          }
        }
      }
    }
    for (let v = 0; v < pb.n; v += 1) {
      const list = pb.incident[v]!;
      for (let i = 0; i < list.length; i += 1) {
        for (let j = i + 1; j < list.length; j += 1) {
          cost += this.angleTerm(v, list[i]!, list[j]!, quality);
        }
      }
    }
    return cost;
  }

  /**
   * Coût des seuls termes qui font intervenir `v` ou `w` (w = -1 : aucun). En géométrie régulière,
   * ce sont les seuls qui changent quand on les déplace : la différence avant / après suffit.
   */
  localCost(v: number, w: number): number {
    const { pb } = this;
    pb.work += (pb.incident[v]!.length + (w >= 0 ? pb.incident[w]!.length : 0) + 1) * (pb.m + pb.n);
    this.stamp += 1;
    const stamp = this.stamp;
    this.nodeMark[v] = stamp;
    if (w >= 0) {
      this.nodeMark[w] = stamp;
    }
    let touchedCount = 0;
    let cornerCount = 0;
    const addCorner = (x: number) => {
      if (this.cornerMark[x] !== stamp) {
        this.cornerMark[x] = stamp;
        this.corners[cornerCount] = x;
        cornerCount += 1;
      }
    };
    for (const x of w >= 0 ? [v, w] : [v]) {
      addCorner(x);
      for (const e of pb.incident[x]!) {
        if (this.edgeMark[e] === stamp) {
          continue;
        }
        this.edgeMark[e] = stamp;
        this.touched[touchedCount] = e;
        touchedCount += 1;
        addCorner(pb.ea[e]!);
        addCorner(pb.eb[e]!);
      }
    }
    let cost = 0;
    for (let i = 0; i < touchedCount; i += 1) {
      const e = this.touched[i]!;
      cost += this.lengthTerm(e);
      for (let f = 0; f < pb.m; f += 1) {
        if (f === e || (this.edgeMark[f] === stamp && f < e)) {
          continue;
        }
        if (this.crosses(e, f) || this.cutsLoop(e, f) || this.cutsLoop(f, e)) {
          cost += WEIGHT.crossing;
        }
      }
      for (let x = 0; x < pb.n; x += 1) {
        if (this.hits(e, x)) {
          cost += WEIGHT.through;
        }
      }
    }
    for (const x of w >= 0 ? [v, w] : [v]) {
      for (let e = 0; e < pb.m; e += 1) {
        if (this.edgeMark[e] !== stamp && this.hits(e, x)) {
          cost += WEIGHT.through;
        }
      }
    }
    for (let i = 0; i < cornerCount; i += 1) {
      const x = this.corners[i]!;
      const list = pb.incident[x]!;
      for (let a = 0; a < list.length; a += 1) {
        for (let b = a + 1; b < list.length; b += 1) {
          const e = list[a]!;
          const f = list[b]!;
          if (this.nodeMark[x] === stamp || this.edgeMark[e] === stamp || this.edgeMark[f] === stamp) {
            cost += this.angleTerm(x, e, f);
          }
        }
      }
    }
    return cost;
  }

  /** Variation du coût si `v` va en `cell` (échange avec l'occupant). L'état est rétabli. */
  delta(v: number, cell: number): number {
    const from = this.cellOf[v]!;
    const w = this.nodeAt[cell]!;
    if (this.exact) {
      this.refresh();
      const before = this.localCost(v, w);
      this.swap(v, cell);
      if (this.sameSizes()) {
        // Colonnes et lignes inchangées : seuls `v` et `w` bougent, le coût local suffit.
        this.locateExact(v);
        if (w >= 0) {
          this.locateExact(w);
        }
        const after = this.localCost(v, w);
        this.swap(v, from);
        this.locateExact(v);
        if (w >= 0) {
          this.locateExact(w);
        }
        return after - before;
      }
      // Sinon tout peut bouger : coût complet avant / après.
      this.dirty = true;
      const after = this.totalCost();
      this.swap(v, from);
      this.dirty = true;
      return after - this.totalCost();
    }
    const before = this.localCost(v, w);
    this.move(v, cell);
    const after = this.localCost(v, w);
    this.move(v, from);
    return after - before;
  }
}

/** Coins des objets quand chaque colonne (ligne) occupée prend la taille de son plus grand objet. */
function fittedCorners(pb: Problem, cellOf: ArrayLike<number>): Point[] {
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
  let x = origin.x;
  for (let c = 0; c < pb.cols; c += 1) {
    if (colW[c]! < 0) {
      continue;
    }
    colX[c] = x;
    x += colW[c]! + gapX;
  }
  const rowY = new Float64Array(pb.rows);
  let y = origin.y;
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

// ---------------------------------------------------------------------------------------------
// Recherche

/** Départ : parcours en largeur depuis l'objet le plus relié, posé en spirale autour du centre. */
function initialCells(pb: Problem, rnd: () => number, shuffled: boolean): number[] {
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
function forceCells(pb: Problem, rnd: () => number): number[] {
  const n = pb.n;
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
function improve(state: State, rnd: () => number, radius: number, maxPasses: number) {
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
const perfect = (q: GridQuality) => q.through + q.crossings + q.closeAngles === 0;

/**
 * Mouvement composé : déplacer un objet très relié (une entité) puis replacer au mieux chacun de
 * ses voisins (ses associations) autour de lui. Un déplacement isolé de l'entité allongerait et
 * croiserait d'abord ses traits ; la recherche simple ne le tenterait jamais.
 */
function improveCompound(state: State, rnd: () => number, radius: number, maxPasses: number) {
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

export interface ChunkResult {
  chunk: number;
  positions: [string, Point][];
  cost: number;
  quality: GridQuality;
}

/** Calcule le lot de départs `chunk` (0 … LAYOUT_CHUNKS - 1). */
export function gridLayoutChunk(
  nodes: GridNode[],
  edges: GridEdge[],
  chunk: number,
  options: Partial<GridOptions> = {},
): ChunkResult {
  const opts = { ...DEFAULTS, ...options };
  if (nodes.length === 0) {
    return { chunk, positions: [], cost: 0, quality: { through: 0, crossings: 0, closeAngles: 0 } };
  }
  const pb = new Problem(nodes, edges, opts);
  const large = pb.n > LOCAL_SEARCH_ABOVE;
  const radius = large ? RADIUS : Number.POSITIVE_INFINITY;
  let best: { cells: Int32Array; cost: number; quality: GridQuality } | null = null;

  for (let i = 0; i < RUNS_PER_CHUNK; i += 1) {
    const run = chunk * RUNS_PER_CHUNK + i;
    const rnd = random(0x5e_ed + run * 7919);
    // Départs alternés : par forces (déplie le graphe), puis en largeur depuis l'objet le plus relié.
    const start = run % 2 === 0 ? forceCells(pb, rnd) : initialCells(pb, rnd, run > 1);
    // 1. Recherche en géométrie régulière (coût incrémental).
    const state = new State(pb, start, false);
    improve(state, rnd, radius, large ? 12 : 40);
    if (!large) {
      // Mouvements composés (entité + ses associations), puis retouche simple.
      improveCompound(state, rnd, 1, 3);
      improve(state, rnd, radius, 40);
    }
    // 2. Polissage en géométrie exacte (celle de l'affichage).
    const exact = new State(pb, state.cellOf, true);
    improve(exact, rnd, large ? 1 : POLISH_RADIUS, large ? 2 : POLISH_PASSES);

    const quality: GridQuality = { through: 0, crossings: 0, closeAngles: 0 };
    const cost = quantize(exact.totalCost(quality));
    if (!best || cost < best.cost - 1e-9) {
      best = { cells: Int32Array.from(exact.cellOf), cost, quality };
    }
    // Disposition sans défaut, ou budget du lot épuisé : on garde la meilleure trouvée.
    if (perfect(quality) || pb.work > WORK_BUDGET) {
      break;
    }
  }

  const corners = fittedCorners(pb, best!.cells);
  const positions = nodes.map((node, v): [string, Point] => [
    node.id,
    { x: Math.round(corners[v]!.x), y: Math.round(corners[v]!.y) },
  ]);
  return { chunk, positions, cost: best!.cost, quality: best!.quality };
}

/**
 * Lot retenu si la décision est déjà certaine avec les lots connus (premier lot parfait dont tous
 * les prédécesseurs sont connus), sinon `undefined`.
 */
export function decidedChunk(results: ChunkResult[]): ChunkResult | undefined {
  const known = new Set(results.map((r) => r.chunk));
  const perfectOnes = results.filter((r) => perfect(r.quality)).sort((a, b) => a.chunk - b.chunk);
  const first = perfectOnes[0];
  if (!first) {
    return undefined;
  }
  for (let k = 0; k < first.chunk; k += 1) {
    if (!known.has(k)) {
      return undefined;
    }
  }
  return first;
}

/** Choix final : premier lot parfait par numéro, sinon coût le plus faible puis numéro (déterministe). */
export function bestChunk(results: ChunkResult[]): GridLayoutResult {
  const best = decidedChunk(results) ?? [...results].sort((a, b) => a.cost - b.cost || a.chunk - b.chunk)[0];
  if (!best) {
    return { positions: new Map(), quality: { through: 0, crossings: 0, closeAngles: 0 } };
  }
  return { positions: new Map(best.positions), quality: best.quality };
}

/** Tous les lots, l'un après l'autre jusqu'à décision (tests, ou absence de Web Worker). */
export function gridLayout(nodes: GridNode[], edges: GridEdge[], options: Partial<GridOptions> = {}): GridLayoutResult {
  const results: ChunkResult[] = [];
  for (let chunk = 0; chunk < LAYOUT_CHUNKS && !decidedChunk(results); chunk += 1) {
    results.push(gridLayoutChunk(nodes, edges, chunk, options));
  }
  return bestChunk(results);
}
