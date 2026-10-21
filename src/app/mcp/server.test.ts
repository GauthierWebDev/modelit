import { mldPlainText } from "@core/index";
import { beforeEach, describe, expect, it } from "vitest";
import { logicalModelOf } from "../derived";
import { selectUndoLabel } from "../document/documentStore";
import { activeDocument, resetWorkspace, useWorkspaceStore } from "../workspace";
import { handleMcpMessage, TOOLS } from "./server";

let nextId = 1;
const call = (method: string, params?: Record<string, unknown>) => {
  const id = nextId;
  nextId += 1;
  return handleMcpMessage({ jsonrpc: "2.0", id, method, ...(params ? { params } : {}) });
};
const tool = async (name: string, args: Record<string, unknown> = {}) => {
  const response = await call("tools/call", { name, arguments: args });
  return response!.result as { content: { text: string }[]; isError?: boolean };
};
const json = (r: { content: { text: string }[] }) => JSON.parse(r.content[0]!.text);

const ORDERS = [
  {
    op: "create_entity",
    name: "CLIENT",
    attributes: [
      { name: "id_client", type: "INT", identifier: true },
      { name: "nom", type: "VARCHAR(50)" },
    ],
  },
  {
    op: "create_entity",
    name: "COMMANDE",
    attributes: [
      { name: "num", type: "INT", identifier: true },
      { name: "date_cmd", type: "DATE" },
    ],
  },
  {
    op: "create_association",
    name: "PASSER",
    links: [
      { entity: "CLIENT", cardinality: "0,n" },
      { entity: "COMMANDE", cardinality: "1,1" },
    ],
  },
];

/** Assistants IA par MCP (override O-47). */
describe("serveur MCP", () => {
  beforeEach(resetWorkspace);

  it("initialize : version négociée, outils annoncés", async () => {
    const init = await call("initialize", {
      protocolVersion: "2025-11-25",
      capabilities: {},
      clientInfo: { name: "test", version: "1" },
    });
    expect(init!.result).toMatchObject({
      protocolVersion: "2025-11-25",
      serverInfo: { name: "ModelIt" },
      capabilities: { tools: {} },
    });
    const unknown = await call("initialize", { protocolVersion: "1999-01-01" });
    expect((unknown!.result as { protocolVersion: string }).protocolVersion).toBe("2025-11-25");
  });

  it("sans poignée de main (2026-07-28) : tools/list répond directement", async () => {
    const list = await call("tools/list");
    expect((list!.result as { tools: { name: string }[] }).tools.map((t) => t.name)).toEqual(TOOLS.map((t) => t.name));
  });

  it("notification : pas de réponse ; méthode inconnue : erreur JSON-RPC ; en-tête Mcp-Method incohérent : refusé", async () => {
    expect(await handleMcpMessage({ jsonrpc: "2.0", method: "notifications/initialized" })).toBeNull();
    expect((await call("resources/list"))!.error?.code).toBe(-32601);
    const mismatch = await handleMcpMessage({ jsonrpc: "2.0", id: 1, method: "tools/list" }, {}, "tools/call");
    expect(mismatch!.error?.code).toBe(-32600);
  });

  it("apply_changes : crée le modèle en une seule entrée d'annulation", async () => {
    const applied: string[] = [];
    const response = await handleMcpMessage(
      {
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "apply_changes", arguments: { operations: ORDERS } },
      },
      { onApplied: (s) => applied.push(s) },
    );
    const result = response!.result as { content: { text: string }[]; isError?: boolean };
    expect(result.isError).toBeUndefined();
    expect(json(result).applied).toHaveLength(3);
    expect(applied).toHaveLength(1);

    const state = activeDocument().store.getState();
    expect(state.past).toHaveLength(1);
    expect(selectUndoLabel(state)).toBe("history.ai");
    expect(mldPlainText(logicalModelOf(state.doc))).toContain("COMMANDE = (_num_, date_cmd, #CLIENT_id);");
    // Positions attribuées : rien n'est empilé à l'origine.
    expect(new Set(Object.values(state.doc.layout.positions).map((p) => `${p.x},${p.y}`)).size).toBe(3);

    activeDocument().store.getState().undo();
    expect(activeDocument().store.getState().doc.entities).toEqual([]);
  });

  it("apply_changes : tout ou rien", async () => {
    await tool("apply_changes", { operations: ORDERS });
    const before = activeDocument().store.getState().doc;
    const result = await tool("apply_changes", {
      operations: [
        { op: "create_entity", name: "PRODUIT" },
        { op: "create_entity", name: "CLIENT" }, // nom déjà pris
      ],
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toMatch(/Nothing was applied\. operation 2 \(create_entity\)/);
    expect(activeDocument().store.getState().doc).toBe(before);
  });

  it("get_model : rubriques typées dans le SGBD cible, pattes et cardinalités", async () => {
    await tool("apply_changes", { operations: ORDERS });
    const model = json(await tool("get_model"));
    expect(model.entities.map((e: { name: string }) => e.name)).toEqual(["CLIENT", "COMMANDE"]);
    expect(model.entities[0].attributes[0]).toMatchObject({ name: "id_client", identifier: true });
    expect(model.associations[0].links).toEqual([
      { entity: "CLIENT", cardinality: "0,n" },
      { entity: "COMMANDE", cardinality: "1,1" },
    ]);
  });

  it("modifier, supprimer, changer de SGBD", async () => {
    await tool("apply_changes", { operations: ORDERS });
    const result = await tool("apply_changes", {
      operations: [
        { op: "rename", target: "PASSER", name: "COMMANDER" },
        { op: "add_attributes", target: "CLIENT", attributes: [{ name: "email", type: "VARCHAR(120)", unique: true }] },
        { op: "set_link", association: "COMMANDER", entity: "CLIENT", cardinality: "1,n" },
        { op: "set_dbms", dbms: "mysql" },
      ],
    });
    expect(result.isError).toBeUndefined();
    const model = json(await tool("get_model"));
    expect(model.dbms).toBe("mysql");
    expect(model.associations[0]).toMatchObject({
      name: "COMMANDER",
      links: [
        { entity: "CLIENT", cardinality: "1,n" },
        { entity: "COMMANDE", cardinality: "1,1" },
      ],
    });
    expect(model.entities[0].attributes.map((a: { name: string }) => a.name)).toEqual(["id_client", "nom", "email"]);
    // Comme dans l'interface : supprimer une entité retire ses pattes, pas l'association.
    await tool("apply_changes", { operations: [{ op: "delete", targets: ["COMMANDE"] }] });
    const after = json(await tool("get_model"));
    expect(after.entities.map((e: { name: string }) => e.name)).toEqual(["CLIENT"]);
    expect(after.associations[0].links).toEqual([{ entity: "CLIENT", cardinality: "1,n" }]);
  });

  it("occupé (glisser-déposer en cours) : modification refusée, lecture permise", async () => {
    activeDocument().store.getState().begin();
    expect((await tool("apply_changes", { operations: ORDERS })).isError).toBe(true);
    expect((await tool("get_mld")).isError).toBeUndefined();
    activeDocument().store.getState().cancel();
  });

  it("reverse_engineer : nouvel onglet actif", async () => {
    await tool("apply_changes", { operations: [{ op: "create_entity", name: "X" }] });
    const result = await tool("reverse_engineer", {
      sql: "CREATE TABLE produit (id INT PRIMARY KEY, nom VARCHAR(40));",
    });
    expect(result.isError).toBeUndefined();
    expect(useWorkspaceStore.getState().documents).toHaveLength(2);
    expect(
      activeDocument()
        .store.getState()
        .doc.entities.map((e) => e.name),
    ).toEqual(["produit"]);
  });

  it("exception dans un outil : résultat en erreur, même identifiant, vrai message", async () => {
    const response = await handleMcpMessage(
      { jsonrpc: "2.0", id: 42, method: "tools/call", params: { name: "auto_layout", arguments: {} } },
      { autoLayout: () => Promise.reject(new Error("layout worker failed")) },
    );
    expect(response!.id).toBe(42);
    const result = response!.result as { content: { text: string }[]; isError?: boolean };
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toBe("auto_layout failed: layout worker failed");
  });
});
