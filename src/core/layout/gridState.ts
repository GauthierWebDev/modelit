import type { GridQuality } from "./grid";
import { segmentHitsBox, segmentsCross } from "./gridGeometry";
import type { Problem } from "./gridProblem";

const WEIGHT = { through: 150, crossing: 60, angle: 20, length: 1 };

/** En dessous de cet angle, deux traits issus d'un même objet sont jugés confondus. */
/** cos(20°), en littéral : pas de trigonométrie à l'exécution (voir `quantize`). */
const COS_MIN_ANGLE = 0.939_692_620_785_908_4;

export class State {
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

  readonly pb: Problem;
  /** Géométrie exacte (affichage final) plutôt que régulière. */
  readonly exact: boolean;

  constructor(pb: Problem, cellOf: ArrayLike<number>, exact: boolean) {
    this.pb = pb;
    this.exact = exact;
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
    let { x } = origin;
    for (let c = 0; c < pb.cols; c += 1) {
      colX[c] = x;
      if (colW[c]! >= 0) {
        x += colW[c]! + gapX;
      }
    }
    let { y } = origin;
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
    const { stamp } = this;
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
