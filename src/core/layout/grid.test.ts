import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { diagramLinks, diagramNodes, linkSourceId } from "../model/document";
import { emptyDocument } from "../model/factory";
import { reverseEngineer } from "../reverse/build";
import { bestChunk, type GridEdge, type GridNode, gridLayout, gridLayoutChunk, LAYOUT_CHUNKS } from "./grid";

/**
 * Placement par lots, comme dans l'interface ; `wall` = durée du lot le plus long, c'est-à-dire
 * le temps perçu quand les lots tournent en parallèle (un Web Worker par lot).
 */
function layout(nodes: GridNode[], edges: GridEdge[]) {
  let wall = 0;
  const results = Array.from({ length: LAYOUT_CHUNKS }, (_, chunk) => {
    const started = performance.now();
    const result = gridLayoutChunk(nodes, edges, chunk);
    wall = Math.max(wall, performance.now() - started);
    return result;
  });
  return { ...bestChunk(results), wall };
}

/**
 * Budgets de temps mesurés sur un poste de développement. Les runners partagés de la CI sont plus
 * lents et irréguliers (×1,2 à ×1,5 observés) : marge ×3, qui détecte encore une vraie régression.
 */
const budget = (ms: number) => ms * (process.env.CI ? 3 : 1);
/**
 * Vérifiés seulement dans un passage isolé (`pnpm test:perf`, PERF=1) : dans la suite complète, les
 * autres fichiers de test occupent les cœurs et faussent la mesure. La qualité du placement, elle,
 * est toujours vérifiée.
 */
const PERF = process.env.PERF === "1";
// Délai de Vitest (5 s par défaut) porté à 30 s : chaque cas lance plusieurs placements complets,
// plus lents quand le reste de la suite occupe les cœurs.
const expectWithin = (ms: number, limit: number) => PERF && expect(ms).toBeLessThan(budget(limit));

/** Graphe du MCD du laboratoire (5 entités, 11 associations dont 2 réflexives). */
function laboGraph() {
  const doc = reverseEngineer(readFileSync("fixtures/labo_sqlite.sql", "utf8"), emptyDocument()).doc;
  // Dimensions relevées dans l'interface : MCD ≈ 120 px de large, MPD 330 à 570 px (types, contraintes).
  const nodes: GridNode[] = diagramNodes(doc).map((n) =>
    n.kind === "entity"
      ? {
          id: n.id,
          width: n.name === "chercheur" ? 567 : 350,
          height: 200,
          mcdWidth: 120,
          mcdHeight: 36 + 18 * n.attributes.length,
        }
      : { id: n.id, width: 20 + 7.5 * ("name" in n ? n.name.length : 4), height: 36 },
  );
  const edges: GridEdge[] = diagramLinks(doc).map((l) => ({ a: linkSourceId(l), b: l.entityId }));
  return { nodes, edges };
}

const overlaps = (nodes: GridNode[], positions: Map<string, { x: number; y: number }>) => {
  const boxes = nodes.map((n) => ({ ...positions.get(n.id)!, w: n.width, h: n.height }));
  return boxes.some((a, i) =>
    boxes.some((b, j) => j > i && a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y),
  );
};

describe("placement sur grille (override O-30)", { timeout: 30_000 }, () => {
  it("MCD du laboratoire : aucun trait ne traverse un objet, aucun croisement, au plus un angle serré, en moins de 0,3 s (parallèle)", () => {
    const { nodes, edges } = laboGraph();
    const { positions, quality, wall } = layout(nodes, edges);
    expect(quality).toMatchObject({ through: 0, crossings: 0 });
    expect(quality.closeAngles).toBeLessThanOrEqual(1);
    expect(overlaps(nodes, positions)).toBe(false);
    // Proportions raisonnables (la disposition précédente faisait ~ 7:1).
    const xs = nodes.map((n) => positions.get(n.id)!.x);
    const ys = nodes.map((n) => positions.get(n.id)!.y);
    // Emprise du MCD (la vue concernée ; le MPD, plus large, ne sert qu'à éviter les chevauchements).
    const width = Math.max(...nodes.map((n) => positions.get(n.id)!.x + (n.mcdWidth ?? n.width))) - Math.min(...xs);
    const height = Math.max(...nodes.map((n) => positions.get(n.id)!.y + (n.mcdHeight ?? n.height))) - Math.min(...ys);
    expect(width / height).toBeLessThan(1.8);
    expect(width / height).toBeGreaterThan(0.6);
    // Temps réel : meilleure de trois mesures, pour ne pas compter la charge des autres fichiers de
    // test exécutés en même temps (le budget, lui, est inchangé).
    const best = Math.min(wall, ...[0, 1].map(() => layout(nodes, edges).wall));
    expectWithin(best, 300);
  });

  it("reproductible quel que soit l'état d'optimisation du moteur : aucun tri à comparateur aléatoire", () => {
    // `sort(() => rnd() - 0.5)` donnait un ordre différent une fois le code optimisé par le moteur :
    // le même modèle changeait de disposition d'une session (ou d'un Web Worker) à l'autre.
    const source = readFileSync("src/core/layout/grid.ts", "utf8");
    expect(source).not.toMatch(/\.sort\(\s*\(\)\s*=>/);
    expect(source).not.toMatch(/Math\.(random|hypot|atan2|cos|sin|exp|pow)\(/);
  });

  it("cas signalé (dimensions réelles relevées dans l'interface) : aucun croisement, aucune traversée", () => {
    // fixtures/labo_layout_input.json : données envoyées au Web Worker pour le MCD du laboratoire.
    const { nodes, edges } = JSON.parse(readFileSync("fixtures/labo_layout_input.json", "utf8")) as {
      nodes: GridNode[];
      edges: GridEdge[];
    };
    const { positions, quality } = gridLayout(nodes, edges);
    expect(quality).toMatchObject({ through: 0, crossings: 0 });
    expect(overlaps(nodes, positions)).toBe(false);
  });

  it("déterministe, et identique qu'on calcule les lots en parallèle ou l'un après l'autre", () => {
    const { nodes, edges } = laboGraph();
    const sequential = [...gridLayout(nodes, edges).positions];
    expect([...gridLayout(nodes, edges).positions]).toEqual(sequential);
    // Lots rendus dans le désordre (fin des Web Workers) : même choix.
    const chunks = Array.from({ length: LAYOUT_CHUNKS }, (_, chunk) => gridLayoutChunk(nodes, edges, chunk)).reverse();
    expect([...bestChunk(chunks).positions]).toEqual(sequential);
  });

  it("grand modèle (80 objets) : sans chevauchement ni traversée, au plus 2 croisements, en moins de 0,8 s (parallèle)", () => {
    const nodes: GridNode[] = Array.from({ length: 80 }, (_, i) => ({
      id: `n${i}`,
      width: 150 + (i % 3) * 30,
      height: 60 + (i % 4) * 20,
    }));
    const edges: GridEdge[] = nodes.slice(1).map((n, i) => ({ a: n.id, b: `n${Math.floor(i / 2)}` }));
    const { positions, quality, wall } = layout(nodes, edges);
    expect(overlaps(nodes, positions)).toBe(false);
    expect(quality.through).toBe(0);
    expect(quality.crossings).toBeLessThanOrEqual(2);
    expectWithin(wall, 800);
  });

  it("20 MCD variés (5 à 12 entités, binaires, ternaires, réflexives) : aucune traversée, rares croisements, rapide", () => {
    let crossings = 0;
    let total = 0;
    let worst = 0;
    for (let seed = 1; seed <= 20; seed += 1) {
      const { nodes, edges } = randomModel(seed);
      const { positions, quality, wall: elapsed } = layout(nodes, edges);
      total += elapsed;
      worst = Math.max(worst, elapsed);
      expect(overlaps(nodes, positions)).toBe(false);
      expect(quality.through).toBe(0);
      crossings += quality.crossings;
    }
    expect(crossings).toBeLessThanOrEqual(6);
    expectWithin(total / 20, 250);
    expectWithin(worst, 600);
  }, 30_000); // 20 modèles × 4 lots enchaînés (en parallèle dans l'interface)
});

/** MCD aléatoire réaliste : entités larges en MPD, associations binaires, ternaires (10 %), réflexives (10 %). */
function randomModel(seed: number) {
  let state = seed;
  const r = () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
  const k = 5 + Math.floor(r() * 8);
  const nodes: GridNode[] = [];
  const edges: GridEdge[] = [];
  for (let i = 0; i < k; i += 1) {
    nodes.push({
      id: `e${i}`,
      width: 330 + r() * 240,
      height: 120 + r() * 100,
      mcdWidth: 110 + r() * 30,
      mcdHeight: 60 + r() * 90,
    });
  }
  const associations = Math.round(k * (1 + r() * 0.8));
  for (let j = 0; j < associations; j += 1) {
    const id = `a${j}`;
    nodes.push({ id, width: 110 + r() * 60, height: 36 });
    const a = Math.floor(r() * k);
    let b = Math.floor(r() * k);
    const kind = r();
    if (kind < 0.1) {
      b = a;
    } else {
      while (b === a) {
        b = Math.floor(r() * k);
      }
    }
    edges.push({ a: id, b: `e${a}` }, { a: id, b: `e${b}` });
    if (kind > 0.9) {
      let c = Math.floor(r() * k);
      while (c === a || c === b) {
        c = Math.floor(r() * k);
      }
      edges.push({ a: id, b: `e${c}` });
    }
  }
  return { nodes, edges };
}
