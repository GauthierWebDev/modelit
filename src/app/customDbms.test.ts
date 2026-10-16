import { displayedSqlType, MSG, targetOf, toLogicalModel } from "@core/index";
import { model } from "@core/testing/builder";
import { describe, expect, it } from "vitest";
import {
  applyCustomDbms,
  customizeTarget,
  removeCustomization,
  setColumnSqlType,
  setCustomType,
  setDbmsVersion,
  setTargetDbms,
} from "./commands";
import { createDocumentHandle } from "./document/handle";

/** SGBD personnalisés et type d'une colonne depuis le MPD (override O-59). */
describe("SGBD personnalisé d'un modèle", () => {
  const setup = () => {
    const doc = model().entity("Client", ["id_client*", "nom"]).build();
    doc.settings.dbms = "postgresql";
    doc.settings.dbmsVersion = "18";
    return createDocumentHandle(doc);
  };
  const settings = (doc: ReturnType<typeof setup>) => doc.store.getState().doc.settings;

  it("personnaliser, redéfinir, refuser une variable sans objet, revenir au standard", () => {
    const doc = setup();
    customizeTarget(doc);
    expect(settings(doc).customDbms?.name).toContain("PostgreSQL 18");
    expect(setCustomType(doc, "counter", "BIGINT({n})")).toBe(MSG.invalidTemplateVariable("{n}"));
    expect(setCustomType(doc, "counter", "BIGSERIAL")).toBeNull();
    expect(settings(doc).customDbms?.types).toEqual({ counter: "BIGSERIAL" });
    // Changer la version garde la personnalisation ; changer la base aussi, si demandé.
    setDbmsVersion(doc, "16");
    setTargetDbms(doc, "mysql", true);
    expect(settings(doc).customDbms?.types).toEqual({ counter: "BIGSERIAL" });
    removeCustomization(doc);
    expect(settings(doc).customDbms).toBeUndefined();
    doc.store.getState().undo();
    expect(settings(doc).customDbms).toBeDefined();
    // Choisir un SGBD standard retire la personnalisation.
    setTargetDbms(doc, "oracle");
    expect(settings(doc).customDbms).toBeUndefined();
  });

  it("choisir un SGBD de la bibliothèque copie sa définition et sa base", () => {
    const doc = setup();
    applyCustomDbms(doc, {
      id: "lib",
      name: "Maison",
      base: "mysql",
      version: "8.0",
      types: { boolean: "TINYINT(1)" },
    });
    expect(settings(doc)).toMatchObject({
      dbms: "mysql",
      customDbms: { id: "lib", name: "Maison", types: { boolean: "TINYINT(1)" } },
    });
  });

  it("type d'une colonne pour ce dialecte : annotation, vidée sans toucher un autre dialecte", () => {
    const doc = setup();
    const client = () => doc.store.getState().doc.entities[0]!;
    const nom = client().attributes[1]!.id;
    expect(setColumnSqlType(doc, client().id, nom, "CITEXT")).toBeNull();
    expect(client().attributes[1]!.sourceType).toEqual({ sql: "CITEXT", dialect: "postgresql" });
    const column = toLogicalModel(doc.store.getState().doc).tables[0]!.columns.find((c) => c.attributeId === nom)!;
    expect(displayedSqlType(column, targetOf(settings(doc)))).toBe("CITEXT");
    expect(setColumnSqlType(doc, client().id, nom, "")).toBeNull();
    expect(client().attributes[1]!.sourceType).toBeUndefined();
    // Type d'origine d'un autre dialecte (rétroconception) : un champ vide ne l'efface pas.
    doc.store.getState().change("history.columnType", (d) => {
      d.entities[0]!.attributes[1]!.sourceType = { sql: "TINYTEXT", dialect: "mysql" };
    });
    expect(setColumnSqlType(doc, client().id, nom, "")).toBeNull();
    expect(client().attributes[1]!.sourceType).toEqual({ sql: "TINYTEXT", dialect: "mysql" });
  });
});
