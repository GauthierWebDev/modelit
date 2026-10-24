import { model } from "@core/testing/builder";
import { describe, expect, it } from "vitest";
import { createDocumentHandle } from "../document/handle";
import { applyChanges, type Operation } from "./apply";
import { describeModel, describeSettings } from "./describe";

const personnes = () =>
  createDocumentHandle(
    model()
      .entity("PERSONNE", ["id*", "nom"])
      .entity("CLIENT", ["remise"])
      .entity("SALARIE", ["salaire"])
      .entity("FOURNISSEUR", ["siret"])
      .inherit("PERSONNE", ["CLIENT", "SALARIE"])
      .build(),
  );
type Handle = ReturnType<typeof personnes>;
const apply = (handle: Handle, operations: unknown[]) => applyChanges(handle, operations as Operation[]);
const settings = (handle: Handle) => handle.store.getState().doc.settings;

/** Assistants IA à parité avec l'interface (override O-69) : héritages, paramètres, SGBD. */
describe("MCP : héritages et paramètres (O-69)", () => {
  it("update_inheritance : contrainte, commentaire, sous-type ajouté et retiré", () => {
    const handle = personnes();
    const { id } = handle.store.getState().doc.inheritances[0]!;
    const ok = apply(handle, [
      {
        op: "update_inheritance",
        target: id,
        constraint: "XT",
        comment: "rôles",
        addChildren: ["FOURNISSEUR"],
        removeChildren: ["SALARIE"],
      },
    ]);
    expect(ok.ok).toBe(true);
    const { doc } = handle.store.getState();
    expect(doc.inheritances[0]).toMatchObject({ constraint: "XT", comment: "rôles" });
    expect(describeModel(doc, "m").inheritances[0]!.children).toEqual(["CLIENT", "FOURNISSEUR"]);
  });

  it("set_settings : masques validés (alias de toute langue), options du script ; variable ou valeur inconnue refusée", () => {
    const handle = personnes();
    expect(
      apply(handle, [
        { op: "set_settings", primaryKey: "pk_<table>", naming: { typology: "snake" }, ddl: { indexes: false } },
      ]).ok,
    ).toBe(true);
    expect(settings(handle).keys.primary).toBe("pk_<table>");
    expect(settings(handle).naming.typology).toBe("snake");
    expect(settings(handle).ddl.indexes).toBe(false);
    expect(apply(handle, [{ op: "set_settings", foreignKey: "<inconnue>_id" }]).ok).toBe(false);
    expect(apply(handle, [{ op: "set_settings", ddl: { enums: "maybe" } }]).ok).toBe(false);
    expect(apply(handle, [{ op: "set_settings", ddl: { nope: true } }]).ok).toBe(false);
  });

  it("SGBD personnalisé : créé, renommé, type redéfini, gardé par set_dbms, retiré", () => {
    const handle = personnes();
    const ok = apply(handle, [
      { op: "customize_dbms", name: "Maison" },
      { op: "set_custom_type", type: "unicodeVariable", sql: "NVARCHAR(<length>)" },
      { op: "set_dbms", dbms: "mysql" },
    ]);
    expect(ok.ok).toBe(true);
    expect(settings(handle)).toMatchObject({
      dbms: "mysql",
      customDbms: { name: "Maison", types: { unicodeVariable: "NVARCHAR(<length>)" } },
    });
    expect(describeSettings(handle.store.getState().doc).customDbms).toMatchObject({
      name: "Maison",
      basedOn: "mysql",
    });
    expect(apply(handle, [{ op: "set_custom_type", type: "nope", sql: "X" }]).ok).toBe(false);
    expect(apply(handle, [{ op: "remove_customization" }]).ok).toBe(true);
    expect(settings(handle).customDbms).toBeUndefined();
  });
});

describe("MCP : lecture (O-69)", () => {
  it("get_model : identifiants des rubriques et des pattes, noms logiques ; physique seulement en « full »", () => {
    const handle = createDocumentHandle(
      model()
        .entity("CLIENT", ["id*", "email"])
        .entity("COMMANDE", ["num*"])
        .association("PASSER", ["CLIENT 0,n", "COMMANDE 1,1"])
        .build(),
    );
    apply(handle, [
      { op: "update_node", target: "CLIENT", logicalName: "customer" },
      {
        op: "update_attribute",
        target: "CLIENT",
        attribute: "email",
        logicalName: "mail",
        default: "'?'",
        sqlType: "TEXT",
      },
    ]);
    const { doc } = handle.store.getState();
    const conceptual = describeModel(doc, "m");
    const email = conceptual.entities[0]!.attributes[1]!;
    expect(conceptual.entities[0]).toMatchObject({ logicalName: "customer" });
    expect(email).toMatchObject({ id: doc.entities[0]!.attributes[1]!.id, logicalName: "mail", type: "TEXT" });
    expect(email).not.toHaveProperty("default");
    expect(conceptual.associations[0]!.links[0]!.id).toBe(doc.links[0]!.id);
    expect(describeModel(doc, "m", "full").entities[0]!.attributes[1]).toMatchObject({ default: "'?'" });
  });
});
