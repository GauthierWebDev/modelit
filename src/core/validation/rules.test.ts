import { describe, expect, it } from "vitest";
import { createAttribute } from "../model/factory";
import { model } from "../testing/builder";
import { MSG } from "./messages";
import { checkAssociation, checkAttributes, checkCardinality, checkEntityName, checkLinkCardinality } from "./rules";

describe("contrôles de saisie", () => {
  it("nom d'entité unique", () => {
    const doc = model().entity("CLIENT").build();
    expect(checkEntityName(doc, "CLIENT")).toBe(MSG.entityNameTaken);
    expect(checkEntityName(doc, "CLIENT", doc.entities[0]!.id)).toBeNull();
    expect(checkEntityName(doc, "PRODUIT")).toBeNull();
  });

  it("pas de doublon de rubrique", () => {
    expect(checkAttributes([createAttribute("nom"), createAttribute("nom")])).toBe(MSG.duplicateAttributes);
  });

  it.each([
    [{ min: 2, max: 5 }, null],
    [{ min: 0, max: "n" }, null],
    [{ min: 3, max: 1 }, MSG.maxLowerThanMin],
    [{ min: -1, max: 1 }, MSG.incoherentCardinalities],
    [{ min: 0.5, max: "n" }, MSG.incoherentCardinalities],
  ] as const)("cardinalité %o", (c, expected) => {
    expect(checkCardinality(c)).toBe(expected);
  });

  const binary = () =>
    model()
      .entity("PERSONNE", ["id*"])
      .entity("PASSEPORT", ["num*"])
      .association("DETENIR", ["PERSONNE 0,1", "PASSEPORT 1,1"]);

  it("pas de 1,1 de part et d'autre", () => {
    const doc = binary().build();
    expect(checkLinkCardinality(doc, doc.links[0]!.id, { min: 1, max: 1 })).toBe(MSG.bothSidesOneOne);
  });

  it("1,1 interdite sur une association porteuse", () => {
    const doc = model()
      .entity("A", ["a*"])
      .entity("B", ["b*"])
      .association("R", ["A 0,n", "B 0,n"], ["qte"])
      .build();
    expect(checkLinkCardinality(doc, doc.links[0]!.id, { min: 1, max: 1 })).toBe(MSG.oneOneForbiddenWithAttributes);
  });

  it("rubriques portées uniquement par une table de correspondance", () => {
    const doc = model()
      .entity("CLIENT", ["id*"])
      .entity("COMMANDE", ["num*"])
      .association("COMMANDER", ["CLIENT 0,n", "COMMANDE 0,1"])
      .build();
    const asso = { ...doc.associations[0]!, attributes: [createAttribute("date_commande")] };
    expect(checkAssociation(doc, asso)).toBe(MSG.attributesNeedTable);
  });
});
