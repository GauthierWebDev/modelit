import { describe, expect, it } from "vitest";
import { matchesSearch, searchKey } from "./search";

/** Recherche d'un objet du schéma (override O-64). */
describe("recherche : comparaison", () => {
  it("minuscules, accents de base, séparateurs → « - »", () => {
    expect(searchKey("Bon_De  Commande")).toBe("bon-de-commande");
    expect(searchKey("Élève (tuteur)")).toBe("eleve-tuteur-");
    expect(searchKey("ÇA_VA-BIEN")).toBe("ca-va-bien");
  });

  it("« bon de » trouve « Bon_De_Commande », « eleve » trouve « Élève »", () => {
    expect(matchesSearch(["Bon_De_Commande"], "bon de")).toBe(true);
    expect(matchesSearch(["Élève"], "eleve")).toBe(true);
    expect(matchesSearch(["Élève"], "ÉLÈ")).toBe(true);
  });

  it("un des noms suffit (conceptuel ou logique)", () => {
    expect(matchesSearch(["Client", "tbl_customer"], "custom")).toBe(true);
    expect(matchesSearch(["Client", "tbl_customer"], "fourn")).toBe(false);
  });

  it("séparateurs en bord de recherche ignorés ; recherche vide ou faite de séparateurs : rien", () => {
    expect(matchesSearch(["CLIENT"], " client ")).toBe(true);
    expect(matchesSearch(["CLIENT"], "")).toBe(false);
    expect(matchesSearch(["CLIENT"], " _ ")).toBe(false);
  });
});
