import { model } from "@core/testing/builder";
import { describe, expect, it } from "vitest";
import { createDocumentHandle } from "./document/handle";
import { closeSearch, findMatches, openSearch, searchResults, setSearchQuery, stepSearch } from "./searchCommands";

/** Bons de commande et livraisons, disposés en grille : COMMANDE en haut à droite, BON_LIVRAISON en bas à gauche. */
function docWithLayout() {
  const doc = model()
    .entity("Bon_De_Commande", ["num*"])
    .entity("Élève", ["id*"], { logicalName: "tbl_student" })
    .entity("Bon_Livraison", ["num*"])
    .association("Commander", ["Bon_De_Commande 1,1", "Élève 0,n"])
    .build();
  const id = (name: string) => [...doc.entities, ...doc.associations].find((n) => n.name === name)!.id;
  doc.layout.positions[id("Bon_De_Commande")] = { x: 400, y: 0 };
  doc.layout.positions[id("Élève")] = { x: 0, y: 0 };
  doc.layout.positions[id("Bon_Livraison")] = { x: 0, y: 300 };
  doc.layout.positions[id("Commander")] = { x: 200, y: 100 };
  return { doc, id };
}

describe("recherche dans le canevas (O-64)", () => {
  it("MCD : entités et associations par nom conceptuel ou logique, dans l'ordre de lecture", () => {
    const { doc, id } = docWithLayout();
    expect(findMatches(doc, "mcd", "bon")).toEqual([id("Bon_De_Commande"), id("Bon_Livraison")]);
    expect(findMatches(doc, "mcd", "student")).toEqual([id("Élève")]);
    expect(findMatches(doc, "mcd", "comm")).toEqual([id("Bon_De_Commande"), id("Commander")]);
  });

  it("MLD / MPD : tables par nom de table ou nom conceptuel ; une association absorbée n'a pas de table", () => {
    const { doc, id } = docWithLayout();
    expect(findMatches(doc, "mld", "eleve")).toEqual([id("Élève")]);
    expect(findMatches(doc, "mpd", "commander")).toEqual([]);
  });
});

describe("recherche dans le canevas (O-64)", () => {
  it("navigation en boucle ; un nouveau texte revient au premier résultat ; fermer garde le texte", () => {
    const { doc, id } = docWithLayout();
    const handle = createDocumentHandle(doc);
    openSearch(handle);
    expect(setSearchQuery(handle, "bon")).toBe(id("Bon_De_Commande"));
    expect(stepSearch(handle, 1)).toBe(id("Bon_Livraison"));
    expect(stepSearch(handle, 1)).toBe(id("Bon_De_Commande"));
    expect(stepSearch(handle, -1)).toBe(id("Bon_Livraison"));
    expect(searchResults(handle).current).toBe(1);
    expect(setSearchQuery(handle, "élè")).toBe(id("Élève"));
    expect(searchResults(handle)).toEqual({ matches: [id("Élève")], current: 0 });
    closeSearch(handle);
    expect(searchResults(handle)).toEqual({ matches: [], current: -1 });
    expect(handle.view.getState().search.query).toBe("élè");
  });

  it("aucun résultat : rien à montrer", () => {
    const handle = createDocumentHandle(docWithLayout().doc);
    openSearch(handle);
    expect(setSearchQuery(handle, "fournisseur")).toBeUndefined();
    expect(stepSearch(handle, 1)).toBeUndefined();
    expect(searchResults(handle).current).toBe(-1);
  });
});
