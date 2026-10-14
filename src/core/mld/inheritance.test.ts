import { describe, expect, it } from "vitest";
import { generateDdl } from "../ddl/generate";
import { model } from "../testing/builder";
import { MSG } from "../validation/messages";
import { hasErrors } from "./logical";
import { mldPlainText } from "./text";
import { toLogicalModel } from "./transform";

const personnes = () =>
  model()
    .entity("PERSONNE", ["id*", "nom"])
    .entity("CLIENT", ["remise"])
    .entity("FOURNISSEUR", ["siret"]);

describe("héritage (override O-18)", () => {
  it("chaque sous-type reçoit la clé du surtype, en clé primaire et étrangère", () => {
    const logical = toLogicalModel(personnes().inherit("PERSONNE", ["CLIENT", "FOURNISSEUR"], "XT").build());
    expect(hasErrors(logical)).toBe(false);
    expect(mldPlainText(logical)).toBe(
      ["PERSONNE = (_id_, nom);", "CLIENT = (_#id_, remise);", "FOURNISSEUR = (_#id_, siret);"].join("\n"),
    );
    expect(logical.tables[1]!.foreignKeys).toEqual([
      { relationId: expect.any(String), columns: ["id"], referencedTable: "PERSONNE", referencedColumns: ["id"] },
    ]);
  });

  it("SQL : le surtype est créé avant les sous-types", () => {
    const result = generateDdl(toLogicalModel(personnes().inherit("PERSONNE", ["CLIENT", "FOURNISSEUR"]).build()), { dbms: "sqlite" });
    expect(result.ok && result.sql.indexOf("CREATE TABLE PERSONNE")).toBe(0);
  });

  it("héritage en cascade", () => {
    const doc = personnes()
      .entity("PARTICULIER", ["age"])
      .entity("ENTREPRISE", ["raison"])
      .inherit("PERSONNE", ["CLIENT", "FOURNISSEUR"])
      .inherit("CLIENT", ["PARTICULIER", "ENTREPRISE"])
      .build();
    expect(mldPlainText(toLogicalModel(doc))).toContain("PARTICULIER = (_#id_, age);");
  });

  it("sans entité cible", () => {
    const messages = toLogicalModel(personnes().inherit(null, ["PERSONNE", "CLIENT", "FOURNISSEUR"]).build()).issues.map((i) => i.message);
    expect(messages).toContain(MSG.inheritanceNeedsParent);
  });

  it("une seule entité spécialisée suffit (override O-36) ; aucune : erreur", () => {
    const one = toLogicalModel(personnes().inherit("PERSONNE", ["CLIENT"]).build());
    expect(one.issues.map((i) => i.message)).not.toContain(MSG.inheritanceNeedsTwoChildren);
    expect(one.tables.find((t) => t.name === "CLIENT")).toMatchObject({ primaryKey: ["id"], foreignKeys: [expect.objectContaining({ referencedTable: "PERSONNE" })] });
    const none = toLogicalModel(personnes().inherit("PERSONNE", []).build());
    expect(none.issues.map((i) => i.message)).toContain(MSG.inheritanceNeedsTwoChildren);
  });

  it("un sous-type ne peut dépendre que d'un surtype", () => {
    const doc = personnes()
      .entity("SOCIETE", ["siren*"])
      .entity("AUTRE", ["x"])
      .inherit("PERSONNE", ["CLIENT", "FOURNISSEUR"])
      .inherit("SOCIETE", ["CLIENT", "AUTRE"])
      .build();
    expect(toLogicalModel(doc).issues.map((i) => i.message)).toContain(MSG.multipleParents("CLIENT"));
  });

  it("les identifiants propres d'un sous-type sont ignorés (avertissement)", () => {
    const doc = model()
      .entity("PERSONNE", ["id*"])
      .entity("CLIENT", ["num_client*"])
      .entity("FOURNISSEUR", [])
      .inherit("PERSONNE", ["CLIENT", "FOURNISSEUR"])
      .build();
    const logical = toLogicalModel(doc);
    expect(logical.issues.map((i) => i.message)).toContain(MSG.subtypeKeyConceptual("CLIENT"));
    expect(logical.tables[1]!.primaryKey).toEqual(["id"]);
  });

  it("héritage circulaire", () => {
    const doc = model()
      .entity("A", ["a*"])
      .entity("B", [])
      .entity("C", [])
      .inherit("A", ["B", "C"])
      .inherit("B", ["A", "C"])
      .build();
    expect(hasErrors(toLogicalModel(doc))).toBe(true);
  });
});

describe("traits entre tables (override O-25)", () => {
  it("le trait d'un sous-type est rattaché à son lien d'héritage", () => {
    const doc = personnes().inherit("PERSONNE", ["CLIENT", "FOURNISSEUR"]).build();
    const clientLink = doc.inheritanceLinks.find((l) => l.entityId === doc.entities[1]!.id)!;
    expect(toLogicalModel(doc).tables[1]!.foreignKeys[0]!.relationId).toBe(clientLink.id);
  });

  it("le trait d'une association est rattaché à la patte de l'entité référencée", () => {
    const doc = model().entity("A", ["a*"]).entity("B", ["b*"]).association("R", ["A 0,n", "B 1,1"]).build();
    expect(toLogicalModel(doc).tables[1]!.foreignKeys[0]!.relationId).toBe(doc.links[0]!.id);
  });
});
