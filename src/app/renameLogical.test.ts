import { MSG, toLogicalModel } from "@core/index";
import { model } from "@core/testing/builder";
import { describe, expect, it } from "vitest";
import { renameLogical } from "./commands";
import { createDocumentHandle } from "./document/handle";

const setup = () =>
  createDocumentHandle(
    model()
      .entity("Client", ["id_client*", "Nom client"])
      .entity("Commande", ["id_commande*"])
      .association("Passer", ["Client 0,n", "Commande 1,1"])
      .build(),
  );
const logical = (doc: ReturnType<typeof setup>) => toLogicalModel(doc.store.getState().doc);
const table = (doc: ReturnType<typeof setup>, name: string) => logical(doc).tables.find((t) => t.name === name)!;
const rename = (doc: ReturnType<typeof setup>, tableName: string, column: string | null, name: string) => {
  const t = table(doc, tableName);
  return renameLogical(doc, logical(doc), t, column === null ? null : t.columns.find((c) => c.name === column)!, name);
};

/** Renommer depuis le MLD / MPD, traduit dans le MCD (override O-56). */
describe("renommer une table ou une colonne du MLD", () => {
  it("titre : nom logique de l'entité ; vide, le nom dérivé revient", () => {
    const doc = setup();
    expect(rename(doc, "Client", null, "acheteur")).toBeNull();
    const client = doc.store.getState().doc.entities.find((e) => e.name === "Client")!;
    expect(client.logicalName).toBe("acheteur");
    expect(rename(doc, "acheteur", null, "")).toBeNull();
    expect(doc.store.getState().doc.entities.find((e) => e.name === "Client")!.logicalName).toBeUndefined();
  });

  it("colonne propre : nom logique de la rubrique, nom conceptuel inchangé, annulable", () => {
    const doc = setup();
    const before = table(doc, "Client").columns.find((c) => c.attributeId)!.name;
    const column = table(doc, "Client").columns.find((c) => c.name !== before && c.attributeId)!.name;
    expect(rename(doc, "Client", column, "nom_du_client")).toBeNull();
    const attribute = doc.store
      .getState()
      .doc.entities.find((e) => e.name === "Client")!
      .attributes.find((a) => a.name === "Nom client")!;
    expect(attribute.logicalName).toBe("nom_du_client");
    doc.store.getState().undo();
    expect(
      doc.store
        .getState()
        .doc.entities.find((e) => e.name === "Client")!
        .attributes.find((a) => a.name === "Nom client")!.logicalName,
    ).toBeUndefined();
  });

  it("clé étrangère : nom de la clé (O-07)", () => {
    const doc = setup();
    const fk = table(doc, "Commande").columns.find((c) => c.foreign)!;
    expect(rename(doc, "Commande", fk.name, "acheteur_id")).toBeNull();
    expect(table(doc, "Commande").columns.some((c) => c.foreign && c.name === "acheteur_id")).toBe(true);
  });

  it("nom pris : refusé, rien ne change ; nom inchangé : rien", () => {
    const doc = setup();
    expect(rename(doc, "Client", null, "COMMANDE")).toBe(MSG.tableNameTaken("COMMANDE"));
    expect(rename(doc, "Client", null, "Client")).toBeNull();
    expect(doc.store.getState().past).toEqual([]);
  });
});
