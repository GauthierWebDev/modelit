import { generateDdl, toLogicalModel } from "@core/index";
import { model } from "@core/testing/builder";
import { describe, expect, it } from "vitest";
import { setAttributes } from "./commands";
import { createDocumentHandle } from "./document/handle";

const setup = () => createDocumentHandle(model().entity("Client", ["id_client*", "Nom client"]).build());
const client = (doc: ReturnType<typeof setup>) => doc.store.getState().doc.entities.find((e) => e.name === "Client")!;
const columns = (doc: ReturnType<typeof setup>) =>
  toLogicalModel(doc.store.getState().doc)
    .tables.find((t) => t.name === "Client")!
    .columns.map((c) => c.name);
/** Saisie du champ « Nom logique » du détail d'une rubrique : vide = nom dérivé. */
const setLogicalName = (doc: ReturnType<typeof setup>, name: string, value: string) => {
  const owner = client(doc);
  const attributes = owner.attributes.map((a) =>
    a.name === name ? { ...a, logicalName: value.trim() || undefined } : a,
  );
  return setAttributes(doc, owner.id, attributes);
};

/** Nom conceptuel (MCD) et nom logique (MLD, MPD, SQL) d'une rubrique (CDC §5 : boîte Rubrique). */
describe("nom logique d'une rubrique", () => {
  it("saisi : utilisé par le MLD et le SQL, le nom conceptuel reste celui du MCD", () => {
    const doc = setup();
    expect(setLogicalName(doc, "Nom client", "  nom_du_client  ")).toBeNull();
    const attribute = client(doc).attributes.find((a) => a.name === "Nom client")!;
    expect(attribute.logicalName).toBe("nom_du_client");
    expect(columns(doc)).toContain("nom_du_client");
    const ddl = generateDdl(toLogicalModel(doc.store.getState().doc), { dbms: "postgresql", version: "18" });
    expect(ddl.ok && ddl.sql).toMatch(/\bnom_du_client\b/);
  });

  it("vidé : le nom dérivé du nom conceptuel revient", () => {
    const doc = setup();
    const derived = columns(doc);
    setLogicalName(doc, "Nom client", "nom_du_client");
    expect(setLogicalName(doc, "Nom client", "   ")).toBeNull();
    expect(client(doc).attributes.find((a) => a.name === "Nom client")!.logicalName).toBeUndefined();
    expect(columns(doc)).toEqual(derived);
  });
});
