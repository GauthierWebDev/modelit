import type { GridEdge, GridNode, GridOptions } from "./grid";
import { placeInCell } from "./gridGeometry";

/** Proportions visées (largeur / hauteur). */
const ASPECT = 4 / 3;

export class Problem {
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

  readonly nodes: GridNode[];
  readonly options: GridOptions;

  constructor(nodes: GridNode[], edges: GridEdge[], options: GridOptions) {
    this.nodes = nodes;
    this.options = options;
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
