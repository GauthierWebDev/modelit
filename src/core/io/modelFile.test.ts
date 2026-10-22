import { describe, expect, it } from "vitest";
import { model } from "../testing/builder";
import { CURRENT_VERSION, deserializeModel, FILE_FORMAT, ModelFileError, serializeModel } from "./modelFile";

describe("format de fichier natif", () => {
  it("aller-retour sans perte", () => {
    const doc = model()
      .entity("CLIENT", ["id*"])
      .entity("COMMANDE", ["num*"])
      .association("PASSER", ["CLIENT 0,n", "COMMANDE 1,1"])
      .build();
    const { doc: loaded, warnings } = deserializeModel(serializeModel(doc));
    expect(loaded).toEqual(doc);
    expect(warnings).toEqual([]);
  });

  it("refuse un fichier étranger", () => {
    expect(() => deserializeModel("{}")).toThrow(ModelFileError);
    expect(() => deserializeModel("pas du json")).toThrow(ModelFileError);
  });

  it("avertit pour une version plus récente et complète les paramètres absents", () => {
    const text = JSON.stringify({
      format: FILE_FORMAT,
      version: CURRENT_VERSION + 1,
      model: { settings: { dbms: "oracle" } },
    });
    const { doc, warnings } = deserializeModel(text);
    expect(warnings).toHaveLength(1);
    expect(doc.settings.dbms).toBe("oracle");
    expect(doc.settings.grid.size).toBeGreaterThan(0);
    expect(doc.entities).toEqual([]);
  });
});

describe("format de fichier natif", () => {
  it("v2 → v3 : positions et cassures sorties des objets vers layout (J-01, phase 3)", () => {
    // Forme écrite par la v0.1.0.
    const v2 = {
      format: FILE_FORMAT,
      version: 2,
      model: {
        settings: {},
        entities: [
          { id: "e1", kind: "entity", name: "CLIENT", attributes: [], fictive: false, position: { x: 10, y: 20 } },
        ],
        associations: [{ id: "a1", kind: "association", name: "PASSER", attributes: [], position: { x: 200, y: 20 } }],
        links: [
          {
            id: "l1",
            associationId: "a1",
            entityId: "e1",
            cardinality: { min: 0, max: "n" },
            relativeId: false,
            bends: [{ x: 100, y: 0 }],
          },
          {
            id: "l2",
            associationId: "a1",
            entityId: "e1",
            cardinality: { min: 1, max: 1 },
            relativeId: false,
            bends: [],
          },
        ],
        inheritances: [{ id: "h1", kind: "inheritance", constraint: "X", position: { x: 5, y: 300 } }],
        inheritanceLinks: [{ id: "il1", inheritanceId: "h1", entityId: "e1", bends: [{ x: 7, y: 8 }] }],
      },
    };
    const { doc, warnings } = deserializeModel(JSON.stringify(v2));
    expect(warnings).toEqual([]);
    expect(doc.layout).toEqual({
      positions: { e1: { x: 10, y: 20 }, a1: { x: 200, y: 20 }, h1: { x: 5, y: 300 } },
      bends: { l1: [{ x: 100, y: 0 }], il1: [{ x: 7, y: 8 }] },
    });
    for (const node of [...doc.entities, ...doc.associations, ...doc.inheritances]) {
      expect(node).not.toHaveProperty("position");
    }
    for (const link of [...doc.links, ...doc.inheritanceLinks]) {
      expect(link).not.toHaveProperty("bends");
    }
    expect(JSON.parse(serializeModel(doc)).version).toBe(3);
  });
});

describe("format de fichier natif", () => {
  it("fichier sans layout : géométrie vide, objets à l'origine", () => {
    const text = JSON.stringify({ format: FILE_FORMAT, version: CURRENT_VERSION, model: { entities: [] } });
    expect(deserializeModel(text).doc.layout).toEqual({ positions: {}, bends: {} });
  });

  it("SGBD inconnu (fichier abîmé ou plus récent) : refusé avec un message, jamais remplacé en silence (A-01, C-6)", () => {
    const text = JSON.stringify({
      format: FILE_FORMAT,
      version: CURRENT_VERSION,
      model: { settings: { dbms: "duckdb" } },
    });
    expect(() => deserializeModel(text)).toThrow(ModelFileError);
    expect(() => deserializeModel(text)).toThrow(/duckdb/);
  });

  it("SGBD absent : celui des paramètres par défaut", () => {
    const text = JSON.stringify({ format: FILE_FORMAT, version: CURRENT_VERSION, model: { settings: {} } });
    expect(deserializeModel(text).doc.settings.dbms).toBe(model().build().settings.dbms);
  });
});
