import type { Id, Point, Rect } from "@core/index";
import { describe, expect, it } from "vitest";
import { addEntity } from "./commands";
import { setDiagramSizer } from "./diagramSizer";
import { createDocumentHandle } from "./document/handle";
import { autoLayout, cancelAutoLayout } from "./layoutCommands";
import { setLayoutRunner } from "./layoutRunner";
import { newModelDocument } from "./modelDefaults";
import { useUiStore } from "./uiStore";

const boxes = (positions: Record<Id, Point>) =>
  new Map<Id, Rect>(Object.entries(positions).map(([id, p]) => [id, { ...p, width: 100, height: 40 }]));
setDiagramSizer({
  mcdBoxes: (doc) => boxes(doc.layout.positions),
  placementBoxes: (doc) => boxes(doc.layout.positions),
  associationSize: () => ({ mcd: { width: 80, height: 30 }, reserved: { width: 80, height: 30 } }),
});

/** Faux calcul : place les objets en ligne (pas de 203, hors grille), ou exécute `during` avant de répondre. */
function runner(during?: () => void) {
  setLayoutRunner({
    run: (nodes) => {
      during?.();
      return Promise.resolve(new Map(nodes.map((n, i): [string, Point] => [n.id, { x: i * 203, y: 7 }])));
    },
  });
}

/** Placement automatique (O-09, O-30) : cas d'usage de l'application (audit A-01, U-2). */
describe("placement automatique", () => {
  it("schéma vide : rien à placer", async () => {
    runner();
    expect(await autoLayout(createDocumentHandle(newModelDocument()))).toBe("skipped");
  });

  it("positions calculées appliquées, alignées sur la grille du modèle, en une entrée d'historique", async () => {
    runner();
    const doc = createDocumentHandle(newModelDocument());
    const a = addEntity(doc, { x: 500, y: 500 });
    const b = addEntity(doc, { x: 900, y: 500 });
    const before = doc.store.getState().past.length;
    expect(await autoLayout(doc)).toBe("placed");
    const { positions } = doc.store.getState().doc.layout;
    expect(positions[a]).toEqual({ x: 0, y: 10 });
    expect(positions[b]).toEqual({ x: 200, y: 10 });
    expect(doc.store.getState().past.length).toBe(before + 1);
  });

  it("objets changés pendant le calcul : résultat abandonné", async () => {
    const doc = createDocumentHandle(newModelDocument());
    const a = addEntity(doc, { x: 500, y: 500 });
    runner(() => addEntity(doc, { x: 0, y: 0 }));
    expect(await autoLayout(doc)).toBe("skipped");
    expect(doc.store.getState().doc.layout.positions[a]).toEqual({ x: 500, y: 500 });
  });
});

/** Faux calcul en attente : `finish` le termine, l'annulation le rejette comme l'adaptateur des Workers. */
function pendingRunner() {
  const state: { calls: number; finish: () => void } = { calls: 0, finish: () => undefined };
  setLayoutRunner({
    run: (nodes, _edges, signal) => {
      state.calls += 1;
      return new Promise((resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason));
        state.finish = () => resolve(new Map(nodes.map((n): [string, Point] => [n.id, { x: 0, y: 0 }])));
      });
    },
  });
  return state;
}

/** Un seul placement à la fois par document, annulable (O-62). */
describe("placement automatique", () => {
  it("appel répété pendant le calcul : ignoré, un seul calcul, indicateur levé puis baissé", async () => {
    const pending = pendingRunner();
    const doc = createDocumentHandle(newModelDocument());
    addEntity(doc, { x: 500, y: 500 });
    const first = autoLayout(doc);
    expect(doc.view.getState().layoutRunning).toBe(true);
    expect(await autoLayout(doc)).toBe("skipped");
    pending.finish();
    expect(await first).toBe("placed");
    expect(pending.calls).toBe(1);
    expect(doc.view.getState().layoutRunning).toBe(false);
  });

  it("annulé pendant le calcul : document et historique inchangés, indicateur baissé, nouveau placement possible", async () => {
    const pending = pendingRunner();
    const doc = createDocumentHandle(newModelDocument());
    const a = addEntity(doc, { x: 500, y: 500 });
    const before = doc.store.getState().past.length;
    const placing = autoLayout(doc);
    cancelAutoLayout(doc);
    expect(await placing).toBe("cancelled");
    expect(doc.store.getState().doc.layout.positions[a]).toEqual({ x: 500, y: 500 });
    expect(doc.store.getState().past.length).toBe(before);
    expect(doc.view.getState().layoutRunning).toBe(false);
    const again = autoLayout(doc);
    pending.finish();
    expect(await again).toBe("placed");
  });

  it("annulation sans placement en cours : sans effet", () => {
    expect(() => cancelAutoLayout(createDocumentHandle(newModelDocument()))).not.toThrow();
  });

  it("calcul en échec : signalé dans la barre d'état, document inchangé, indicateur baissé", async () => {
    setLayoutRunner({ run: () => Promise.reject(new Error("échec")) });
    const doc = createDocumentHandle(newModelDocument());
    addEntity(doc, { x: 500, y: 500 });
    expect(await autoLayout(doc)).toBe("failed");
    expect(useUiStore.getState().status).toMatchObject({ kind: "error" });
    expect(doc.view.getState().layoutRunning).toBe(false);
  });
});
