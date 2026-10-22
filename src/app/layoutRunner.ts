import type { GridEdge, GridNode, Point } from "@core/index";
import { unplugged } from "./unplugged";

/**
 * Port du calcul du placement automatique (`gridLayout`, override O-30) : implémenté par l'interface
 * (`ui/canvas/autoLayout.ts` : lots calculés en parallèle par un pool de Web Workers, repli sur le fil
 * principal) et branché au démarrage (`src/bootstrap.ts`). Même résultat que `gridLayout`.
 */
export interface LayoutRunner {
  run: (nodes: GridNode[], edges: GridEdge[]) => Promise<Map<string, Point>>;
}

let current: LayoutRunner = unplugged<LayoutRunner>("LayoutRunner");

export function setLayoutRunner(adapter: LayoutRunner) {
  current = adapter;
}

export const layoutRunner = (): LayoutRunner => current;
