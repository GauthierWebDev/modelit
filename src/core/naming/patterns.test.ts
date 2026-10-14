import { describe, expect, it } from "vitest";
import { deserializeModel, FILE_FORMAT } from "../io/modelFile";
import { autoIdentifierName } from "../model/factory";
import { aliasIndex, applyPattern, displayPattern, parsePattern } from "./patterns";

describe("schémas libres (override O-26)", () => {
  it("les alias de toutes les langues désignent la même variable", () => {
    expect(parsePattern("pk_<entité>", "primaryKey")).toEqual({ ok: true, pattern: "pk_<entity>" });
    expect(parsePattern("pk_<Entity>", "primaryKey")).toEqual({ ok: true, pattern: "pk_<entity>" });
    expect(parsePattern("fk_<colonne>_<table>", "foreignKey")).toEqual({ ok: true, pattern: "fk_<column>_<table>" });
    expect(parsePattern("<NOM>", "primaryKey")).toEqual({ ok: true, pattern: "<name>" });
  });

  it("casse et accents ignorés", () => {
    expect(parsePattern("code <ENTITE>", "discriminant")).toEqual({ ok: true, pattern: "code <entity>" });
  });

  it("variable inconnue ou non permise pour ce schéma", () => {
    expect(parsePattern("<truc>_id", "foreignKey")).toEqual({ ok: false, unknown: ["<truc>"] });
    expect(parsePattern("code <table>", "discriminant")).toEqual({ ok: false, unknown: ["<table>"] });
    expect(parsePattern("  ", "foreignKey")).toEqual({ ok: false, empty: true });
  });

  it("affichage dans la langue de l'interface", () => {
    expect(displayPattern("fk_<column>_<table>", "fr")).toBe("fk_<colonne>_<table>");
    expect(displayPattern("fk_<column>_<table>", "en")).toBe("fk_<column>_<table>");
  });

  it("application", () => {
    expect(applyPattern("<table>_<column>", { table: "user", column: "id" })).toBe("user_id");
    expect(autoIdentifierName("num_<entity>", "Client")).toBe("num_Client");
  });

  it("un alias ambigu entre langues est désactivé partout ; un alias transparent reste valable", () => {
    // « nom » voudrait dire « name » en français et « column » dans une langue fictive.
    const index = aliasIndex({
      entity: { fr: ["entité"], xx: ["entity"] },
      table: { fr: ["table"], xx: ["table"] },
      column: { fr: ["colonne"], xx: ["nom"] },
      name: { fr: ["nom"], xx: ["name"] },
    });
    expect(index.has("nom")).toBe(false);
    expect(index.get("name")).toBe("name");
    expect(index.get("column")).toBe("column");
    expect(index.get("table")).toBe("table");
    expect(parsePattern("<nom>", "primaryKey", index)).toEqual({ ok: false, unknown: ["<nom>"] });
  });

  it("les fichiers des versions précédentes sont convertis", () => {
    const text = JSON.stringify({
      format: FILE_FORMAT,
      version: 1,
      model: { settings: { autoIdMask: "Id_[Classe]", keys: { primary: "[Nom]", foreign: "[Table]_[Colonne]" } } },
    });
    const { settings } = deserializeModel(text).doc;
    expect([settings.autoIdMask, settings.keys.primary, settings.keys.foreign]).toEqual(["Id_<entity>", "<name>", "<table>_<column>"]);
  });
});
