import { describe, expect, it } from "vitest";
import { targetOf } from "../ddl/dialects";
import { displayedSqlType, generateDdl } from "../ddl/generate";
import { deserializeModel, serializeModel } from "../io/modelFile";
import { toLogicalModel } from "../mld/transform";
import { defaultSettings } from "../model/settings";
import { model } from "../testing/builder";
import { MSG } from "../validation/messages";
import { defaultTemplate, invalidTemplateVariable, sqlType } from "./typeMapping";

const types = {
  counter: "BIGSERIAL",
  unicodeVariable: 'VARCHAR({n}) COLLATE "fr-x-icu"',
  decimal: "DECIMAL({p},{s})",
};

/** SGBD personnalisés : types redéfinis, basés sur un SGBD et une version (override O-59). */
describe("SGBD personnalisé", () => {
  it("un type redéfini remplace celui de la base ; les autres restent ceux de la base", () => {
    expect(sqlType({ kind: "counter" }, "postgresql", "18", types)).toBe("BIGSERIAL");
    expect(
      sqlType({ kind: "text", encoding: "unicode", length: "variable", size: 80 }, "postgresql", "18", types),
    ).toBe('VARCHAR(80) COLLATE "fr-x-icu"');
    expect(sqlType({ kind: "decimal", precision: 10, scale: 2 }, "postgresql", "18", types)).toBe("DECIMAL(10,2)");
    expect(sqlType({ kind: "integer", bits: 32 }, "postgresql", "18", types)).toBe("INTEGER");
    // Un gabarit vide rend le type de la base, version comprise.
    expect(sqlType({ kind: "counter" }, "postgresql", "18", { counter: " " })).toBe(
      defaultTemplate("counter", "postgresql", "18"),
    );
  });

  it("variables permises selon le type", () => {
    expect(invalidTemplateVariable("counter", "BIGINT({n})")).toBe("{n}");
    expect(invalidTemplateVariable("decimal", "NUMERIC({p},{s})")).toBeNull();
    expect(invalidTemplateVariable("asciiVariable", "VARCHAR({x})")).toBe("{x}");
    expect(invalidTemplateVariable("binaryFixed", "BYTEA")).toBeNull();
  });
});

describe("SGBD personnalisé", () => {
  it("script : en-tête « basé sur » et types redéfinis ; MPD : type réellement émis", () => {
    const doc = model().entity("Client", ["id_client*", "nom"]).build();
    doc.entities[0]!.attributes[0]!.type = { kind: "counter" };
    doc.settings.dbms = "postgresql";
    doc.settings.dbmsVersion = "18";
    doc.settings.customDbms = { id: "x", name: "PostgreSQL maison", types };
    const result = generateDdl(toLogicalModel(doc), targetOf(doc.settings));
    expect(result.ok && result.sql.split("\n")[0]).toBe(
      `-- ${MSG.customDbmsHeader("PostgreSQL maison", "PostgreSQL 18")}`,
    );
    expect(result.ok && result.sql).toContain("BIGSERIAL");
    const column = toLogicalModel(doc).tables[0]!.columns[0]!;
    expect(displayedSqlType(column, targetOf(doc.settings))).toBe("BIGSERIAL");
    // Type de la colonne pour ce dialecte (type d'origine) : prioritaire, sauf compteur.
    expect(
      displayedSqlType(
        { type: { kind: "integer", bits: 32 }, sourceType: { sql: "INT4", dialect: "postgresql" } },
        targetOf(doc.settings),
      ),
    ).toBe("INT4");
    expect(
      displayedSqlType(
        { type: { kind: "integer", bits: 32 }, sourceType: { sql: "INT4", dialect: "mysql" } },
        targetOf(doc.settings),
      ),
    ).toBe("INTEGER");
  });

  it("clé étrangère vers un compteur : type redéfinissable, sinon l'entier", () => {
    const doc = model()
      .entity("Client", ["id_client*"])
      .entity("Commande", ["id_commande*"])
      .association("Passer", ["Client 0,n", "Commande 1,1"])
      .build();
    doc.entities[0]!.attributes[0]!.type = { kind: "counter" };
    doc.settings.dbms = "postgresql";
    doc.settings.dbmsVersion = "18";
    const sql = () => {
      const r = generateDdl(toLogicalModel(doc), targetOf(doc.settings));
      return r.ok ? r.sql : "";
    };
    expect(sql()).toMatch(/id_client INTEGER NOT NULL/);
    doc.settings.customDbms = { id: "x", name: "Maison", types: { counter: "BIGSERIAL", counterForeignKey: "BIGINT" } };
    expect(sql()).toMatch(/id_client BIGINT NOT NULL/);
  });
});

describe("SGBD personnalisé", () => {
  it("enregistré dans le fichier du modèle ; une définition illisible est ignorée", () => {
    const doc = model().entity("Client", ["id_client*"]).build();
    doc.settings.customDbms = { id: "x", name: "PostgreSQL maison", types: { counter: "BIGSERIAL" } };
    const back = deserializeModel(serializeModel(doc));
    expect(back.doc.settings.customDbms).toEqual({
      id: "x",
      name: "PostgreSQL maison",
      types: { counter: "BIGSERIAL" },
    });
    const broken = JSON.parse(serializeModel(doc));
    broken.model.settings.customDbms = { name: 3 };
    const read = deserializeModel(JSON.stringify(broken));
    expect(read.doc.settings.customDbms).toBeUndefined();
    expect(defaultSettings().customDbms).toBeUndefined();
  });
});
