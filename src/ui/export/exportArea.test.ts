import { toLogicalModel } from "@core/index";
import { model } from "@core/testing/builder";
import { describe, expect, it } from "vitest";
import { effectiveArea, selectionIds, visibleArea } from "./exportArea";

const doc = model()
  .entity("CLIENT", ["id*"])
  .entity("COMMANDE", ["num*"])
  .entity("PRODUIT", ["ref*"])
  .association("PASSER", ["CLIENT 0,n", "COMMANDE 1,1"])
  .association("CONTENIR", ["COMMANDE 0,n", "PRODUIT 1,n"])
  .build();
const id = (name: string) => [...doc.entities, ...doc.associations].find((n) => n.name === name)!.id;
const legs = (association: string) => doc.links.filter((l) => l.associationId === id(association)).map((l) => l.id);

/** Zone exportée (override O-63). */
describe("zone exportée", () => {
  it("zone affichée : partie du modèle visible au cadrage et au zoom courants, image de la taille du canevas", () => {
    expect(visibleArea({ x: 40, y: -100, zoom: 2 }, { width: 800.4, height: 600 })).toEqual({
      rect: { x: -20, y: 50, width: 400, height: 300 },
      pixels: { width: 800, height: 600 },
    });
  });

  it("sélection (MCD) : objets sélectionnés et pattes dont les deux extrémités le sont", () => {
    const kept = selectionIds(doc, "mcd", [id("CLIENT"), id("PASSER"), id("COMMANDE")]);
    expect(kept).toEqual(new Set([id("CLIENT"), id("PASSER"), id("COMMANDE"), ...legs("PASSER")]));
  });

  it("sélection (MLD / MPD) : tables sélectionnées et traits des clés étrangères entre elles", () => {
    const logical = toLogicalModel(doc);
    const fks = (table: string) => logical.tables.find((t) => t.name === table)!.foreignKeys.map((f) => f.relationId);
    const kept = selectionIds(doc, "mld", [id("CLIENT"), id("COMMANDE")]);
    expect(kept).toEqual(new Set([id("CLIENT"), id("COMMANDE"), ...fks("COMMANDE")]));
    // Table de CONTENIR non sélectionnée : ni elle ni ses traits.
    expect(fks("CONTENIR").some((f) => kept.has(f))).toBe(false);
  });

  it("« Sélection » sans sélection : zone affichée", () => {
    expect(effectiveArea("selection", [])).toBe("viewport");
    expect(effectiveArea("selection", ["x"])).toBe("selection");
    expect(effectiveArea("all", [])).toBe("all");
  });
});
