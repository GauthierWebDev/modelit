import type { ModelDocument } from "@core/index";
import { model } from "@core/testing/builder";
import { describe, expect, it } from "vitest";
import { createDocumentHandle } from "../document/handle";
import { applyChanges, type Operation } from "./apply";

/** Commandes : un client passe des commandes ; CLIENT.email porte un nom logique et un DEFAULT. */
function commandes() {
  const doc = model()
    .entity("CLIENT", ["id*", "nom", "email"])
    .entity("COMMANDE", ["num*", "date"])
    .association("PASSER", ["CLIENT 0,n", "COMMANDE 1,1"])
    .build();
  const email = doc.entities[0]!.attributes[2]!;
  email.logicalName = "mail";
  email.defaultValue = { expression: "'?'", dialect: "postgresql" };
  return createDocumentHandle(doc);
}

const apply = (handle: ReturnType<typeof commandes>, operations: unknown[]) =>
  applyChanges(handle, operations as Operation[]);
const doc = (handle: ReturnType<typeof commandes>): ModelDocument => handle.store.getState().doc;
const client = (handle: ReturnType<typeof commandes>) => doc(handle).entities.find((e) => e.name === "CLIENT")!;
const attr = (handle: ReturnType<typeof commandes>, name: string) =>
  client(handle).attributes.find((a) => a.name === name)!;

/** Assistants IA à parité avec l'interface (override O-69) : rubriques. */
describe("MCP : rubriques sans perte (O-69)", () => {
  it("set_attributes : rubrique reconnue par son nom gardée (identifiant, nom logique, DEFAULT), absente supprimée", () => {
    const handle = commandes();
    const before = attr(handle, "email");
    const result = apply(handle, [
      {
        op: "set_attributes",
        target: "client",
        attributes: [
          { name: "ID", identifier: true },
          { name: "EMAIL", type: "VARCHAR(200)" },
        ],
      },
    ]);
    expect(result.ok).toBe(true);
    const email = attr(handle, "EMAIL");
    expect(email.id).toBe(before.id);
    expect(email.logicalName).toBe("mail");
    expect(email.defaultValue?.expression).toBe("'?'");
    expect(client(handle).attributes.map((a) => a.name)).toEqual(["ID", "EMAIL"]);
  });

  it("update_attribute : nom logique, DEFAULT, CHECK, type du MPD ; vide retire", () => {
    const handle = commandes();
    const ok = apply(handle, [
      {
        op: "update_attribute",
        target: "CLIENT",
        attribute: "nom",
        logicalName: "last_name",
        check: "nom <> ''",
        sqlType: "VARCHAR(80)",
      },
      { op: "update_attribute", target: "CLIENT", attribute: "email", default: "" },
    ]);
    expect(ok.ok).toBe(true);
    expect(attr(handle, "nom")).toMatchObject({
      logicalName: "last_name",
      check: { expression: "nom <> ''" },
      sourceType: { sql: "VARCHAR(80)" },
    });
    expect(attr(handle, "email").defaultValue).toBeUndefined();
  });

  it("refus validé comme dans l'interface (nom en double) : rien n'est appliqué, même ce qui précédait", () => {
    const handle = commandes();
    const result = apply(handle, [
      { op: "update_node", target: "CLIENT", comment: "acheteurs" },
      { op: "update_attribute", target: "CLIENT", attribute: "nom", name: "email" },
    ]);
    expect(result.ok).toBe(false);
    expect(client(handle).comment).toBeUndefined();
  });

  it("add_auto_identifier : sur une entité seulement", () => {
    const handle = commandes();
    expect(apply(handle, [{ op: "add_auto_identifier", target: "COMMANDE" }]).ok).toBe(true);
    expect(doc(handle).entities[1]!.attributes).toHaveLength(3);
    expect(apply(handle, [{ op: "add_auto_identifier", target: "PASSER" }]).ok).toBe(false);
  });
});

describe("MCP : objets et pattes (O-69)", () => {
  it("update_node : nom de table, commentaire ; fictive refusé pour une association", () => {
    const handle = commandes();
    expect(
      apply(handle, [{ op: "update_node", target: "CLIENT", logicalName: "customer", comment: "acheteurs" }]).ok,
    ).toBe(true);
    expect(client(handle)).toMatchObject({ logicalName: "customer", comment: "acheteurs" });
    expect(apply(handle, [{ op: "update_node", target: "PASSER", fictive: true }]).ok).toBe(false);
  });

  it("set_link : rôle, actions, nom de contrainte, nom de la colonne de clé étrangère ; action inconnue refusée", () => {
    const handle = commandes();
    const ok = apply(handle, [
      {
        op: "set_link",
        association: "PASSER",
        entity: "CLIENT",
        role: "acheteur",
        onDelete: "cascade",
        constraintName: "fk_client",
        foreignKeyNames: { id: "client_ref" },
      },
    ]);
    expect(ok.ok).toBe(true);
    const link = doc(handle).links.find((l) => l.entityId === client(handle).id)!;
    expect(link).toMatchObject({ role: "acheteur", onDelete: "cascade", foreignKeyConstraintName: "fk_client" });
    expect(link.foreignKeyNames).toEqual({ [attr(handle, "id").id]: "client_ref" });
    expect(apply(handle, [{ op: "set_link", link: link.id, onUpdate: "explode" }]).ok).toBe(false);
  });

  it("set_physical : identifiant alternatif et index par noms de rubriques ; rubrique inconnue refusée", () => {
    const handle = commandes();
    const ok = apply(handle, [
      {
        op: "set_physical",
        target: "CLIENT",
        primaryKeyName: "pk_client",
        alternateKeys: [{ name: "uq_mail", attributes: ["email"] }],
        indexes: [{ attributes: ["nom", "email"] }],
      },
    ]);
    expect(ok.ok).toBe(true);
    expect(client(handle).primaryKeyName).toBe("pk_client");
    expect(client(handle).alternateKeys).toEqual([
      { name: "uq_mail", members: [{ attributeId: attr(handle, "email").id }] },
    ]);
    expect(client(handle).indexes?.[0]?.members).toHaveLength(2);
    expect(apply(handle, [{ op: "set_physical", target: "CLIENT", indexes: [{ attributes: ["telephone"] }] }]).ok).toBe(
      false,
    );
  });
});
