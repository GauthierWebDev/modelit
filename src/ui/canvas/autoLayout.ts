import {
  bestChunk,
  type ChunkResult,
  decidedChunk,
  type GridEdge,
  type GridNode,
  LAYOUT_CHUNKS,
  type Point,
} from "@core/index";
import type { DocumentHandle } from "@/app/document/handle";
import { type AutoLayoutOutcome, autoLayout } from "@/app/layoutCommands";
import type { LayoutRunner } from "@/app/layoutRunner";
import { fitToWindow } from "./viewport";

/**
 * Placement automatique (overrides O-09, O-30) depuis l'interface : calcul par `app/layoutCommands.ts`,
 * puis cadrage de la vue affichée sur l'ensemble (le MPD, bien plus large, laisserait le MCD minuscule),
 * sans dépasser 100 %.
 */
export async function autoLayoutTables(handle: DocumentHandle): Promise<AutoLayoutOutcome> {
  const outcome = await autoLayout(handle);
  if (outcome === "placed") {
    fitToWindow(handle, 1);
  }
  return outcome;
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
 * Jamais de calcul sur le fil de l'interface (override O-62) : un placement long reste dans les Workers et
 * s'annule par `signal`. Si les Workers échouent, le placement échoue (signalé par la commande).
 */
function computeLayout(nodes: GridNode[], edges: GridEdge[], signal: AbortSignal): Promise<Map<string, Point>> {
  const run = queue.then(async () => {
    // Annulé pendant qu'un autre onglet calculait : rien à lancer.
    signal.throwIfAborted();
    try {
      return await computeLayoutNow(nodes, edges, signal);
    } catch (e: unknown) {
      if (!signal.aborted) {
        resetPool();
      }
      throw e;
    }
  });
  queue = run.catch(() => undefined);
  return run;
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
 * Même résultat qu'en séquentiel. Annulation (`signal`) : les lots en cours sont abandonnés de même.
 */
async function computeLayoutNow(
  nodes: GridNode[],
  edges: GridEdge[],
  signal: AbortSignal,
): Promise<Map<string, Point>> {
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
          results.push(await runChunk(worker, { nodes, edges, chunk }, signal));
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

/** Un lot calculé par un Worker ; rejeté à l'annulation (le Worker est ensuite arrêté et remplacé). */
function runChunk(
  worker: Worker,
  task: { nodes: GridNode[]; edges: GridEdge[]; chunk: number },
  signal: AbortSignal,
): Promise<ChunkResult> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    const settle = () => signal.removeEventListener("abort", abort);
    worker.onmessage = (event: MessageEvent<ChunkResult>) => {
      settle();
      resolve(event.data);
    };
    worker.onerror = (event) => {
      event.preventDefault();
      settle();
      reject(
        new Error(
          event.message || `layout worker failed${event.filename ? ` (${event.filename}:${event.lineno})` : ""}`,
        ),
      );
    };
    if (signal.aborted) {
      return abort();
    }
    worker.postMessage(task);
  });
}

/** Adaptateur du port `LayoutRunner` (`app/layoutRunner.ts`) : lots en parallèle dans le pool de Workers. */
export const workerLayoutRunner: LayoutRunner = { run: computeLayout };
