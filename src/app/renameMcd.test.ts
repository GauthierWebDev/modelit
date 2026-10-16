import { MSG } from "@core/index";
import { model } from "@core/testing/builder";
import { describe, expect, it } from "vitest";
import { renameAttribute } from "./commands";
import { createDocumentHandle } from "./document/handle";

/** Renommer une rubrique sur place dans le MCD (override O-58). */
describe("renommer une rubrique", () => {
  const setup = () => createDocumentHandle(model().entity("Client", ["code client*", "nom"]).build());
  const client = (doc: ReturnType<typeof setup>) => doc.store.getState().doc.entities[0]!;

  it("change le nom conceptuel, annulable", () => {
    const doc = setup();
    const id = client(doc).attributes[1]!.id;
    expect(renameAttribute(doc, client(doc).id, id, "  nom complet ")).toBeNull();
    expect(client(doc).attributes[1]!.name).toBe("nom complet");
    doc.store.getState().undo();
    expect(client(doc).attributes[1]!.name).toBe("nom");
  });

  it("refuse un nom vide ou déjà porté ; nom inchangé : rien", () => {
    const doc = setup();
    const [first, second] = client(doc).attributes;
    expect(renameAttribute(doc, client(doc).id, second!.id, " ")).toBe(MSG.emptyName);
    expect(renameAttribute(doc, client(doc).id, second!.id, first!.name)).toBe(MSG.duplicateAttributes);
    expect(renameAttribute(doc, client(doc).id, second!.id, "nom")).toBeNull();
    expect(doc.store.getState().past).toEqual([]);
  });
});
