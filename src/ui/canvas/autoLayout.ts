import {
  bestChunk,
  type ChunkResult,
  decidedChunk,
  type GridEdge,
  type GridNode,
  gridLayout,
  LAYOUT_CHUNKS,
  type Point,
} from "@core/index";
import type { DocumentHandle } from "@/app/document/handle";
import { autoLayout } from "@/app/layoutCommands";
import type { LayoutRunner } from "@/app/layoutRunner";
import { fitToWindow } from "./viewport";

/**
 * Placement automatique (overrides O-09, O-30) depuis l'interface : calcul par `app/layoutCommands.ts`,
 * puis cadrage de la vue affichée sur l'ensemble (le MPD, bien plus large, laisserait le MCD minuscule),
 * sans dépasser 100 %.
 */
export async function autoLayoutTables(handle: DocumentHandle) {
  if (await autoLayout(handle)) {
    fitToWindow(handle, 1);
  }
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

/** Adaptateur du port `LayoutRunner` (`app/layoutRunner.ts`) : lots en parallèle dans le pool de Workers. */
export const workerLayoutRunner: LayoutRunner = { run: computeLayout };
