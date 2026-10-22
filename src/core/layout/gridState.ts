import type { GridQuality } from "./grid";
import { fullCost, partialCost } from "./gridCost";
import type { Problem } from "./gridProblem";

export class State {
  readonly cellOf: Int32Array;
  readonly nodeAt: Int32Array;
  readonly px: Float64Array;
  readonly py: Float64Array;
  private dirty = true;
  // Marques réutilisées (pas d'allocation dans la boucle de recherche).
  stamp = 0;
  readonly edgeMark: Int32Array;
  readonly nodeMark: Int32Array;
  readonly cornerMark: Int32Array;
  readonly touched: Int32Array;
  readonly corners: Int32Array;
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

  /** Coût complet ; chaque terme compté une fois. */
  totalCost(quality?: GridQuality): number {
    return fullCost(this, quality);
  }

  /** Coût des seuls termes qui font intervenir `v` ou `w` (w = -1 : aucun). */
  localCost(v: number, w: number): number {
    return partialCost(this, v, w);
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
