import { describe, expect, it } from "vitest";
import { model } from "../testing/builder";
import { CURRENT_VERSION, deserializeModel, FILE_FORMAT, ModelFileError, serializeModel } from "./modelFile";

describe("format de fichier natif", () => {
  it("aller-retour sans perte", () => {
    const doc = model().entity("CLIENT", ["id*"]).entity("COMMANDE", ["num*"]).association("PASSER", ["CLIENT 0,n", "COMMANDE 1,1"]).build();
    const { doc: loaded, warnings } = deserializeModel(serializeModel(doc));
    expect(loaded).toEqual(doc);
    expect(warnings).toEqual([]);
  });

  it("refuse un fichier étranger", () => {
    expect(() => deserializeModel("{}")).toThrow(ModelFileError);
    expect(() => deserializeModel("pas du json")).toThrow(ModelFileError);
  });

  it("avertit pour une version plus récente et complète les paramètres absents", () => {
    const text = JSON.stringify({ format: FILE_FORMAT, version: CURRENT_VERSION + 1, model: { settings: { dbms: "oracle" } } });
    const { doc, warnings } = deserializeModel(text);
    expect(warnings).toHaveLength(1);
    expect(doc.settings.dbms).toBe("oracle");
    expect(doc.settings.grid.size).toBeGreaterThan(0);
    expect(doc.entities).toEqual([]);
  });
});
