import type { Point } from "../model/document";
import { quantize, random } from "./gridGeometry";
import { Problem } from "./gridProblem";
import { improve, improveCompound, perfect } from "./gridSearch";
import { fittedCorners, forceCells, initialCells } from "./gridStart";
import { State } from "./gridState";

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
  let best: RunResult | null = null;

  for (let i = 0; i < RUNS_PER_CHUNK; i += 1) {
    const result = searchRun(pb, chunk * RUNS_PER_CHUNK + i, large, radius);
    const { quality } = result;
    if (!best || result.cost < best.cost - 1e-9) {
      best = result;
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

interface RunResult {
  cells: Int32Array;
  cost: number;
  quality: GridQuality;
}

/** Un départ : recherche en géométrie régulière, puis polissage en géométrie exacte. */
function searchRun(pb: Problem, run: number, large: boolean, radius: number): RunResult {
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
  return { cells: Int32Array.from(exact.cellOf), cost, quality };
}

/**
 * Lot retenu si la décision est déjà certaine avec les lots connus (premier lot parfait dont tous
 * les prédécesseurs sont connus), sinon `undefined`.
 */
export function decidedChunk(results: ChunkResult[]): ChunkResult | undefined {
  const known = new Set(results.map((r) => r.chunk));
  const perfectOnes = results.filter((r) => perfect(r.quality)).sort((a, b) => a.chunk - b.chunk);
  const [first] = perfectOnes;
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
