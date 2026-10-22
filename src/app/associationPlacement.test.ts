import type { Id, Rect } from "@core/index";
import { describe, expect, it } from "vitest";
import { connectPlaced } from "./associationPlacement";
import { addEntity } from "./commands";
import { setDiagramSizer } from "./diagramSizer";
import { createDocumentHandle } from "./document/handle";
import { newModelDocument } from "./modelDefaults";

/** Fausse mesure : chaque objet du schéma est une boîte 100 × 40 à sa position. */
setDiagramSizer({
  mcdBoxes: (doc) =>
    new Map<Id, Rect>(Object.entries(doc.layout.positions).map(([id, p]) => [id, { ...p, width: 100, height: 40 }])),
  placementBoxes: (doc) =>
    new Map<Id, Rect>(Object.entries(doc.layout.positions).map(([id, p]) => [id, { ...p, width: 100, height: 40 }])),
  associationSize: () => ({ mcd: { width: 80, height: 30 }, reserved: { width: 80, height: 30 } }),
});

/** Relier deux entités : l'association créée est placée par l'application (O-60 ; audit A-01, U-2). */
describe("association créée à l'outil Lien", () => {
  it("entre deux entités : centrée entre elles, alignée sur la grille du modèle", () => {
    const doc = createDocumentHandle(newModelDocument());
    expect(doc.store.getState().doc.settings.grid).toEqual({ enabled: true, size: 10 }); // valeur par défaut
    const a = addEntity(doc, { x: 0, y: 0 });
    const b = addEntity(doc, { x: 400, y: 0 });
    const result = connectPlaced(doc, a, b);
    expect(result && "created" in result).toBe(true);
    const id = (result as { created: Id }).created;
    // Milieu des centres (250, 20), coin = milieu − taille / 2 = (210, 5), aligné sur 10.
    expect(doc.store.getState().doc.layout.positions[id]).toEqual({ x: 210, y: 10 });
  });

  it("réflexive : à côté de l'entité, seconde patte avec cassures", () => {
    const doc = createDocumentHandle(newModelDocument());
    const a = addEntity(doc, { x: 0, y: 0 });
    const result = connectPlaced(doc, a, a) as { created: Id };
    const { layout, links } = doc.store.getState().doc;
    expect(layout.positions[result.created]!.x).toBeGreaterThan(100);
    const second = links.filter((l) => l.associationId === result.created)[1]!;
    expect(layout.bends[second.id]?.length).toBeGreaterThan(0);
  });
});
