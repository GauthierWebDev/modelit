import { describe, expect, it } from "vitest";
import { applyTypology, logicalName, stripAccents } from "./typology";

describe("typologie des noms logiques", () => {
  it.each([
    ["snake", "date_commande"],
    ["screamingSnake", "DATE_COMMANDE"],
    ["camel", "dateCommande"],
    ["pascal", "DateCommande"],
    ["conceptual", "Date commande"],
    ["standard", "Date_commande"],
  ] as const)("%s", (typology, expected) => {
    expect(applyTypology("Date commande", typology)).toBe(expected);
  });

  it("le nom logique saisi prime", () => {
    expect(
      logicalName({ name: "Bon de commande", logicalName: "bon_cmd" }, { typology: "snake", stripAccents: false }),
    ).toBe("bon_cmd");
  });

  it("suppression des accents", () => {
    expect(stripAccents("Libellé catégorie")).toBe("Libelle categorie");
    expect(logicalName({ name: "Libellé catégorie" }, { typology: "standard", stripAccents: true })).toBe(
      "Libelle_categorie",
    );
  });
});
