import {
  bendsOf,
  bestChunk,
  type ChunkResult,
  decidedChunk,
  diagramLinks,
  diagramNodes,
  type GridEdge,
  type GridNode,
  gridLayout,
  type Id,
  LAYOUT_CHUNKS,
  linkSourceId,
  type Point,
  positionOf,
} from "@core/index";
import { moveNodes } from "@/app/commands";
import { logicalModelOf } from "@/app/derived";
import type { DocumentHandle } from "@/app/document/handle";
import { associationNamesByLink, center, nodeLayout, type Rect, reflexiveBends } from "./geometry";
import { tableLayouts } from "./logicalGeometry";
import { fitToWindow } from "./viewport";

/**
 * « Placement automatique » (overrides O-09, O-30), disposition commune aux trois vues (O-01).
 *
 * 1. Tous les objets du MCD (entités, associations, héritages) sont placés ensemble sur une grille
 *    qui évite les traits traversant un objet, les croisements et les cardinalités superposées
 *    (`gridLayout`). Chaque cellule a la taille de l'objet dans sa vue la plus grande (MCD ou
 *    MPD) : aucun chevauchement, dans aucune vue.
 * 2. Cassures : la seconde patte d'une réflexive est (re)tracée pour ne pas se confondre avec la
 *    première ; celles d'un autre lien suivent si ses deux extrémités bougent ensemble, sinon
 *    elles sont retirées (le tracé n'aurait plus de sens).
 * 3. La vue est cadrée sur l'ensemble.
 *
 * Le calcul tourne dans des Web Workers, en parallèle (lots de départs) : l'interface reste réactive.
 */
export async function autoLayoutTables(handle: DocumentHandle) {
  let { doc } = handle.store.getState();
  let nodes = diagramNodes(doc);
  if (nodes.length === 0) {
    return;
  }
  const { display } = doc.settings;
  const mpd = new Map(tableLayouts(logicalModelOf(doc), doc, "mpd").map((t) => [t.sourceId, t]));
  const placed = await computeLayout(
    nodes.map((node) => {
      const mcd = nodeLayout(node, positionOf(doc.layout, node.id), display, associationNamesByLink(doc));
      const table = mpd.get(node.id);
      return {
        id: node.id,
        width: Math.max(mcd.width, table?.width ?? 0),
        height: Math.max(mcd.height, table?.height ?? 0),
        mcdWidth: mcd.width,
        mcdHeight: mcd.height,
      };
    }),
    diagramLinks(doc).map((l) => ({ a: linkSourceId(l), b: l.entityId })),
  );
  // Repartir du document courant ; s'il a changé d'objets pendant le calcul, résultat abandonné.
  ({ doc } = handle.store.getState());
  nodes = diagramNodes(doc);
  if (nodes.length !== placed.size || nodes.some((n) => !placed.has(n.id))) {
    return;
  }

  // Alignement sur la grille sans risque de chevauchement (décalage ≤ demi-pas, très inférieur aux écarts).
  const grid = doc.settings.grid.enabled && doc.settings.grid.size <= 20 ? doc.settings.grid.size : null;
  const snap = (p: Point) => (grid ? { x: Math.round(p.x / grid) * grid, y: Math.round(p.y / grid) * grid } : p);
  const positions = new Map<Id, Point>([...placed].map(([id, p]) => [id, snap(p)]));
  const mcdRect = (id: Id): Rect => {
    const node = nodes.find((n) => n.id === id)!;
    const { width, height } = nodeLayout(node, positionOf(doc.layout, id), display, associationNamesByLink(doc));
    return { ...positions.get(id)!, width, height };
  };

  const bends = new Map<Id, Point[]>();
  for (const link of diagramLinks(doc)) {
    const sourceId = linkSourceId(link);
    const legs = doc.links.filter((l) => l.associationId === sourceId);
    const reflexive = legs.length === 2 && legs.every((l) => l.entityId === link.entityId);
    if (reflexive) {
      // Seconde patte : contourne l'entité et l'association ; la première reste droite.
      if (link.id !== legs[1]!.id) {
        if (bendsOf(doc.layout, link.id).length > 0) {
          bends.set(link.id, []);
        }
        continue;
      }
      const obstacles = [...positions.keys()].filter((id) => id !== link.entityId && id !== sourceId).map(mcdRect);
      // Traits droits des autres liens (centre à centre) : le contournement évite de les couper.
      const lines = diagramLinks(doc)
        .filter((l) => linkSourceId(l) !== sourceId)
        .map((l): [Point, Point] => [center(mcdRect(linkSourceId(l))), center(mcdRect(l.entityId))]);
      bends.set(link.id, reflexiveBends(mcdRect(link.entityId), mcdRect(sourceId), grid, obstacles, lines));
      continue;
    }
    const linkBends = bendsOf(doc.layout, link.id);
    if (linkBends.length === 0) {
      continue;
    }
    const node = (id: Id) => positionOf(doc.layout, id);
    const delta = (id: Id) => ({ x: positions.get(id)!.x - node(id).x, y: positions.get(id)!.y - node(id).y });
    const dE = delta(link.entityId);
    const dA = delta(sourceId);
    bends.set(link.id, dE.x === dA.x && dE.y === dA.y ? linkBends.map((b) => ({ x: b.x + dE.x, y: b.y + dE.y })) : []);
  }

  moveNodes(handle, positions, bends);
  // Cadrage sur la vue affichée (le MPD, bien plus large, laisserait le MCD minuscule), sans dépasser 100 %.
  fitToWindow(handle, 1);
}

/**
 * Pool de Web Workers gardés d'un placement à l'autre : module déjà chargé et code déjà optimisé
 * par le moteur JavaScript (le premier calcul d'un Worker neuf est nettement plus lent).
 */
const pool: Worker[] = [];
const newWorker = () => new Worker(new URL("./layoutWorker.ts", import.meta.url), { type: "module" });

/**
 * Un placement à la fois : les Workers du pool sont partagés entre les onglets (override O-44),
 * deux calculs simultanés se répondraient l'un à l'autre.
 */
let queue: Promise<unknown> = Promise.resolve();

/**
 * Délai au-delà duquel les Workers sont jugés indisponibles (fenêtre en arrière-plan, que le moteur
 * peut ralentir ou suspendre ; Worker qui ne se charge pas) : le calcul se fait alors sur le fil
 * principal, au même résultat. Un placement finit donc toujours, et n'en bloque aucun autre.
 */
const WORKER_TIMEOUT = 8000;

function computeLayout(nodes: GridNode[], edges: GridEdge[]): Promise<Map<string, Point>> {
  const run = queue.then(async () => {
    try {
      return await withTimeout(computeLayoutNow(nodes, edges), WORKER_TIMEOUT);
    } catch (e: unknown) {
      // biome-ignore lint/suspicious/noConsole: diagnostic de repli pour le développeur, sans effet pour l'utilisateur
      console.warn("Placement automatique : Workers indisponibles, calcul sur le fil principal.", e);
      resetPool();
      return gridLayout(nodes, edges).positions;
    }
  });
  queue = run.catch(() => undefined);
  return run;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no answer from the layout workers after ${ms} ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/** Workers arrêtés et oubliés : le prochain placement en recrée. */
function resetPool() {
  for (const worker of pool.splice(0)) {
    worker.terminate();
  }
}

/**
 * Lots de départs calculés en parallèle, un Web Worker par cœur disponible ; dès que la décision
 * est certaine (`decidedChunk`), les lots en cours sont abandonnés (leurs Workers remplacés).
 * Même résultat qu'en séquentiel.
 */
async function computeLayoutNow(nodes: GridNode[], edges: GridEdge[]): Promise<Map<string, Point>> {
  const workerCount = Math.max(1, Math.min(LAYOUT_CHUNKS, (navigator.hardwareConcurrency || 2) - 1));
  while (pool.length < workerCount) {
    pool.push(newWorker());
  }
  const workers = pool.slice(0, workerCount);
  const busy = new Set<Worker>();
  const results: ChunkResult[] = [];
  let next = 0;
  try {
    await new Promise<void>((resolve, reject) => {
      let running = workers.length;
      const lane = async (worker: Worker) => {
        while (next < LAYOUT_CHUNKS) {
          const chunk = next;
          next += 1;
          busy.add(worker);
          // biome-ignore lint/performance/noAwaitInLoops: un fil traite ses lots l'un après l'autre ; les fils tournent en parallèle
          results.push(await runChunk(worker, nodes, edges, chunk));
          busy.delete(worker);
          // Décision certaine : inutile d'attendre les lots en cours ailleurs.
          if (decidedChunk(results)) {
            return resolve();
          }
        }
        running -= 1;
        if (running === 0) {
          resolve();
        }
      };
      for (const worker of workers) {
        lane(worker).catch(reject);
      }
    });
  } finally {
    // Workers encore occupés (lots abandonnés, ou erreur) : arrêtés et remplacés.
    for (const worker of busy) {
      worker.terminate();
      pool[pool.indexOf(worker)] = newWorker();
    }
  }
  return bestChunk(results).positions;
}

function runChunk(worker: Worker, nodes: GridNode[], edges: GridEdge[], chunk: number): Promise<ChunkResult> {
  return new Promise((resolve, reject) => {
    worker.onmessage = (event: MessageEvent<ChunkResult>) => resolve(event.data);
    worker.onerror = (event) => {
      event.preventDefault();
      reject(
        new Error(
          event.message || `layout worker failed${event.filename ? ` (${event.filename}:${event.lineno})` : ""}`,
        ),
      );
    };
    worker.postMessage({ nodes, edges, chunk });
  });
}
