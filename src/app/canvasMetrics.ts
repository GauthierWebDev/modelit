import { unplugged } from "./unplugged";

/**
 * Port de la taille du canevas affiché (écran), connue de l'interface (`ui/canvas/viewport.ts`, qui
 * l'implémente) : convertir un cadrage en centre du modèle et inversement (« Suivre », O-05 §5 ; audit A-01,
 * U-7). Branché au démarrage (`src/bootstrap.ts`) ; les tests branchent une taille fixe.
 */
export interface CanvasMetrics {
  canvasSize: () => { width: number; height: number };
}

let current: CanvasMetrics = unplugged<CanvasMetrics>("CanvasMetrics");

export function setCanvasMetrics(adapter: CanvasMetrics) {
  current = adapter;
}

export const canvasMetrics = (): CanvasMetrics => current;
