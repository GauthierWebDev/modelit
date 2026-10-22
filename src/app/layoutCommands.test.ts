import type { Id, Point, Rect } from "@core/index";
import { describe, expect, it } from "vitest";
import { addEntity } from "./commands";
import { setDiagramSizer } from "./diagramSizer";
import { createDocumentHandle } from "./document/handle";
import { autoLayout } from "./layoutCommands";
import { setLayoutRunner } from "./layoutRunner";
import { newModelDocument } from "./modelDefaults";

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
    expect(await autoLayout(createDocumentHandle(newModelDocument()))).toBe(false);
  });

  it("positions calculées appliquées, alignées sur la grille du modèle, en une entrée d'historique", async () => {
    runner();
    const doc = createDocumentHandle(newModelDocument());
    const a = addEntity(doc, { x: 500, y: 500 });
    const b = addEntity(doc, { x: 900, y: 500 });
    const before = doc.store.getState().past.length;
    expect(await autoLayout(doc)).toBe(true);
    const { positions } = doc.store.getState().doc.layout;
    expect(positions[a]).toEqual({ x: 0, y: 10 });
    expect(positions[b]).toEqual({ x: 200, y: 10 });
    expect(doc.store.getState().past.length).toBe(before + 1);
  });

  it("objets changés pendant le calcul : résultat abandonné", async () => {
    const doc = createDocumentHandle(newModelDocument());
    const a = addEntity(doc, { x: 500, y: 500 });
    runner(() => addEntity(doc, { x: 0, y: 0 }));
    expect(await autoLayout(doc)).toBe(false);
    expect(doc.store.getState().doc.layout.positions[a]).toEqual({ x: 500, y: 500 });
  });
});
