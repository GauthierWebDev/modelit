/**
 * Index spatial du placement (override O-31) : des seaux sur une grille régulière, chaque élément (trait ou
 * objet) inscrit dans les seaux que couvre sa boîte englobante. Une requête rend chaque élément dont la boîte
 * peut toucher la boîte demandée, une seule fois : un sur-ensemble des éléments non strictement séparés (le
 * passage coordonnée → seau est croissant), le test exact reste à faire. Les boucles de coût ne visitent plus
 * que le voisinage au lieu de tous les traits et objets ; le résultat ne change pas.
 *
 * Petit schéma (`whole`) : tenir l'index à jour coûterait plus que les tests évités ; une requête rend alors
 * tous les éléments, sans inscription.
 */
export class BoxIndex {
  private readonly buckets: number[][];
  /** Seaux couverts par chaque élément (colonnes c0…c1, lignes r0…r1), c0 = -1 : non inscrit. */
  private readonly c0: Int32Array;
  private readonly c1: Int32Array;
  private readonly r0: Int32Array;
  private readonly r1: Int32Array;
  // Marques réutilisées : un élément rendu une fois par requête, sans allocation.
  private readonly mark: Int32Array;
  private stamp = 0;
  /** Résultat de la dernière requête (`count` premiers éléments). */
  readonly found: Int32Array;

  private readonly cols: number;
  private readonly rows: number;
  private readonly sizeX: number;
  private readonly sizeY: number;
  private readonly whole: boolean;
  private readonly items: number;

  constructor(items: number, grid: { cols: number; rows: number; sizeX: number; sizeY: number }, whole: boolean) {
    this.whole = whole;
    this.items = items;
    this.cols = grid.cols;
    this.rows = grid.rows;
    this.sizeX = grid.sizeX;
    this.sizeY = grid.sizeY;
    this.buckets = Array.from({ length: grid.cols * grid.rows }, () => []);
    this.c0 = new Int32Array(items).fill(-1);
    this.c1 = new Int32Array(items);
    this.r0 = new Int32Array(items);
    this.r1 = new Int32Array(items);
    this.mark = new Int32Array(items);
    this.found = Int32Array.from({ length: items }, (_, i) => i);
  }

  private col(x: number): number {
    return Math.min(this.cols - 1, Math.max(0, Math.floor(x / this.sizeX)));
  }

  private row(y: number): number {
    return Math.min(this.rows - 1, Math.max(0, Math.floor(y / this.sizeY)));
  }

  /** Inscrit l'élément `i` avec sa nouvelle boîte ; rien à faire si elle couvre les mêmes seaux. */
  set(i: number, minX: number, maxX: number, minY: number, maxY: number) {
    if (this.whole) {
      return;
    }
    const c0 = this.col(minX);
    const c1 = this.col(maxX);
    const r0 = this.row(minY);
    const r1 = this.row(maxY);
    if (c0 === this.c0[i] && c1 === this.c1[i] && r0 === this.r0[i] && r1 === this.r1[i]) {
      return;
    }
    if (this.c0[i]! >= 0) {
      this.remove(i);
    }
    this.c0[i] = c0;
    this.c1[i] = c1;
    this.r0[i] = r0;
    this.r1[i] = r1;
    for (let r = r0; r <= r1; r += 1) {
      for (let c = c0; c <= c1; c += 1) {
        this.buckets[r * this.cols + c]!.push(i);
      }
    }
  }

  /** Retire `i` des seaux qu'il couvre (échange avec le dernier : l'ordre d'un seau est sans importance). */
  private remove(i: number) {
    for (let r = this.r0[i]!; r <= this.r1[i]!; r += 1) {
      for (let c = this.c0[i]!; c <= this.c1[i]!; c += 1) {
        const bucket = this.buckets[r * this.cols + c]!;
        bucket[bucket.indexOf(i)] = bucket[bucket.length - 1]!;
        bucket.pop();
      }
    }
  }

  /** Éléments dont la boîte peut toucher celle-ci, dans `found` ; renvoie leur nombre. */
  query(minX: number, maxX: number, minY: number, maxY: number): number {
    if (this.whole) {
      return this.items;
    }
    this.stamp += 1;
    const { stamp, mark, found } = this;
    let count = 0;
    const c0 = this.col(minX);
    const c1 = this.col(maxX);
    for (let r = this.row(minY), r1 = this.row(maxY); r <= r1; r += 1) {
      for (let c = c0; c <= c1; c += 1) {
        for (const i of this.buckets[r * this.cols + c]!) {
          if (mark[i] !== stamp) {
            mark[i] = stamp;
            found[count] = i;
            count += 1;
          }
        }
      }
    }
    return count;
  }
}
