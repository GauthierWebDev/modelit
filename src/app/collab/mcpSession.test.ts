import { emptyDocument } from "@core/index";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { selectUndoLabel } from "../document/documentStore";
import { handleMcpMessage } from "../mcp/server";
import { activeDocument, resetWorkspace } from "../workspace";
import { type HostSession, startHost } from "./host";
import { buildLink } from "./link";
import { memoryNetwork } from "./memoryNetwork";
import { joinFromLink, leaveSession, setCollabTransport, shareActiveTab, stopSharing, useCollabStore } from "./session";

let nextId = 1;
const tool = async (name: string, args: Record<string, unknown> = {}) => {
  const response = await handleMcpMessage({
    jsonrpc: "2.0",
    id: nextId++,
    method: "tools/call",
    params: { name, arguments: args },
  });
  return response!.result as { content: { text: string }[]; isError?: boolean };
};
const CREATE = {
  operations: [
    { op: "create_entity", name: "CLIENT", attributes: [{ name: "id_client", type: "INT", identifier: true }] },
  ],
};
const EDIT = "e".repeat(32);
const READ = "f".repeat(32);

/** Assistants IA en session (O-05 §8) : MCP local à chaque participant, réglé par l'hôte. */
describe("MCP en session", () => {
  let net: ReturnType<typeof memoryNetwork>;
  let host: HostSession | null;

  beforeEach(() => {
    resetWorkspace();
    useCollabStore.setState({ mode: "idle", tabId: null, guest: null, error: null });
    net = memoryNetwork();
    host = null;
    setCollabTransport({
      startHost: async () => ({ addr: "{}", link: net.hostLink, stop: async () => undefined }),
      connect: async () => net.connect("moi"),
    });
  });
  afterEach(async () => {
    await leaveSession();
    await stopSharing();
    host?.stop();
  });

  async function join(secret: string, aiAllowed: boolean) {
    host = startHost({
      link: net.hostLink,
      doc: emptyDocument(),
      secrets: { editor: EDIT, reader: READ },
      me: { id: "alice", name: "Alice", color: "#000" },
      aiAllowed,
    });
    await joinFromLink(buildLink("{}", secret));
    await net.settle();
    expect(useCollabStore.getState().mode).toBe("guest");
  }

  it("IA interdite par l'hôte : modification refusée, lecture permise", async () => {
    await join(EDIT, false);
    const refused = await tool("apply_changes", CREATE);
    expect(refused.isError).toBe(true);
    expect(refused.content[0]!.text).toContain("disabled by the session host");
    expect((await tool("auto_layout")).isError).toBe(true);
    expect((await tool("get_model")).isError).toBeUndefined();
    expect(host!.store.getState().doc.entities).toHaveLength(0);
  });

  it("IA autorisée en cours de session : la modification part chez l'hôte, annulable « IA » chez l'invité", async () => {
    await join(EDIT, false);
    host!.setAiAllowed(true);
    await net.settle();
    expect((await tool("apply_changes", CREATE)).isError).toBeUndefined();
    await net.settle();
    expect(host!.store.getState().doc.entities.map((e) => e.name)).toEqual(["CLIENT"]);
    expect(selectUndoLabel(activeDocument().store.getState())).toBe("history.ai");
    expect(host!.store.getState().past).toHaveLength(0);
  });

  it("lecteur : son assistant ne peut que lire", async () => {
    await join(READ, true);
    const refused = await tool("apply_changes", CREATE);
    expect(refused.content[0]!.text).toContain("read-only session");
    expect((await tool("get_sql")).isError).toBeUndefined();
  });

  it("l'hôte suit ses propres options, quel que soit le réglage des invités", async () => {
    await shareActiveTab({ aiAllowed: false });
    expect((await tool("apply_changes", CREATE)).isError).toBeUndefined();
    expect(activeDocument().store.getState().doc.entities).toHaveLength(1);
  });

  it("la rétroconception ouvre un nouvel onglet : permise même si l'IA est interdite", async () => {
    await join(READ, false);
    const result = await tool("reverse_engineer", { sql: "CREATE TABLE client (id INT PRIMARY KEY);" });
    expect(result.isError).toBeUndefined();
  });
}, 30_000);
