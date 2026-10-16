import { describe, expect, it } from "vitest";
import { model } from "../testing/builder";
import { MSG } from "../validation/messages";
import { checkLogicalRename } from "./rename";
import { toLogicalModel } from "./transform";

/** Renommage depuis le MLD / MPD (override O-56). */
describe("renommer une table ou une colonne du MLD", () => {
  const logical = toLogicalModel(
    model()
      .entity("CLIENT", ["id_client*", "nom"])
      .entity("COMMANDE", ["id_commande*", "date"])
      .association("PASSER", ["CLIENT 0,n", "COMMANDE 1,1"])
      .build(),
  );

  it("les colonnes propres portent leur rubrique, les clés étrangères leur patte", () => {
    const commande = logical.tables.find((t) => t.name === "COMMANDE")!;
    expect(commande.columns.find((c) => c.name === "date")!.attributeId).toBeDefined();
    const fk = commande.columns.find((c) => c.foreign)!;
    expect(fk.attributeId).toBeUndefined();
    expect(fk.origin?.linkId).toBeDefined();
  });

  it("refuse le nom d'une autre table, sans tenir compte de la casse", () => {
    expect(checkLogicalRename(logical, "CLIENT", null, "commande")).toBe(MSG.tableNameTaken("commande"));
    expect(checkLogicalRename(logical, "CLIENT", null, "client")).toBeNull();
    expect(checkLogicalRename(logical, "CLIENT", null, "acheteur")).toBeNull();
  });

  it("refuse le nom d'une autre colonne de la même table", () => {
    expect(checkLogicalRename(logical, "COMMANDE", "date", "ID_COMMANDE")).toBe(
      MSG.columnNameTaken("COMMANDE", "ID_COMMANDE"),
    );
    expect(checkLogicalRename(logical, "COMMANDE", "date", "nom")).toBeNull();
    expect(checkLogicalRename(logical, "COMMANDE", "date", "  ")).toBeNull();
  });
});
