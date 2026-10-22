import { describe, expect, it } from "vitest";
import { model } from "../testing/builder";
import { applyMove, moveOrigins, snap } from "./move";

/** Client et Commande reliés par Passer ; cassures sur la patte vers Commande. */
function setup() {
  const doc = model()
    .entity("Client", ["id*"])
    .entity("Commande", ["num*"])
    .association("Passer", ["Client 0,n", "Commande 1,1"])
    .build();
  const id = (name: string) => [...doc.entities, ...doc.associations].find((n) => n.name === name)!.id;
  doc.layout.positions[id("Client")] = { x: 0, y: 0 };
  doc.layout.positions[id("Passer")] = { x: 200, y: 0 };
  doc.layout.positions[id("Commande")] = { x: 400, y: 0 };
  const leg = doc.links.find((l) => l.entityId === id("Commande"))!;
  doc.layout.bends[leg.id] = [{ x: 300, y: 50 }];
  return { doc, id, leg };
}

/** Déplacement d'objets (O-10, O-57 ; audit A-01, U-1). */
describe("déplacement d'objets", () => {
  it("les cassures d'un trait suivent si ses deux extrémités bougent", () => {
    const { doc, id, leg } = setup();
    const origins = moveOrigins(doc, [id("Passer"), id("Commande")]);
    applyMove(doc.layout, origins, { x: 15, y: 25 }, null);
    expect(doc.layout.positions[id("Passer")]).toEqual({ x: 215, y: 25 });
    expect(doc.layout.positions[id("Commande")]).toEqual({ x: 415, y: 25 });
    expect(doc.layout.bends[leg.id]).toEqual([{ x: 315, y: 75 }]);
    expect(doc.layout.positions[id("Client")]).toEqual({ x: 0, y: 0 });
  });

  it("une seule extrémité déplacée : les cassures restent", () => {
    const { doc, id, leg } = setup();
    applyMove(doc.layout, moveOrigins(doc, [id("Commande")]), { x: 15, y: 25 }, null);
    expect(doc.layout.bends[leg.id]).toEqual([{ x: 300, y: 50 }]);
  });

  it("alignement sur la grille ; le décalage part toujours des origines", () => {
    const { doc, id, leg } = setup();
    const origins = moveOrigins(doc, [id("Passer"), id("Commande")]);
    applyMove(doc.layout, origins, { x: 7, y: 13 }, 10);
    applyMove(doc.layout, origins, { x: 14, y: 26 }, 10);
    expect(doc.layout.positions[id("Passer")]).toEqual({ x: 210, y: 30 });
    expect(doc.layout.bends[leg.id]).toEqual([{ x: 310, y: 80 }]);
  });

  it("snap : sans grille, valeur inchangée", () => {
    expect(snap(13, null)).toBe(13);
    expect(snap(13, 10)).toBe(10);
    expect(snap(16, 10)).toBe(20);
  });
});
