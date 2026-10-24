import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { usePreferencesStore } from "../preferencesStore";
import { useMcpStore } from "./activity";
import { startMcpBridge, takeOverMcp } from "./bridge";
import { type McpEndpoint, type McpRequest, type McpRespond, setMcpEndpoint } from "./endpoint";

/** Faux point d'écoute : appels retenus, requêtes et libération du port déclenchables par le test. */
const calls: string[] = [];
let request: ((request: McpRequest, respond: McpRespond) => void) | null = null;
let released: (() => void) | null = null;
let startFails = false;
const endpoint: McpEndpoint = {
  available: () => true,
  start: (port, token) => {
    calls.push(`start ${port} ${token}`);
    return startFails ? Promise.reject(new Error("port occupé")) : Promise.resolve();
  },
  stop: () => {
    calls.push("stop");
    return Promise.resolve();
  },
  releaseOthers: (port) => {
    calls.push(`release ${port}`);
    return Promise.resolve(true);
  },
  onRequest: (handler) => {
    request = handler;
    return Promise.resolve(() => undefined);
  },
  onReleased: (handler) => {
    released = handler;
    return Promise.resolve(() => undefined);
  },
};

/** Réponse JSON renvoyée au client pour le corps `body`. */
function ask(body: string): Promise<unknown> {
  return new Promise((resolve) =>
    request!({ id: 1, body, method: null }, (answer) => resolve(answer && JSON.parse(answer))),
  );
}

const TOKEN = "0123456789abcdef0123";

beforeAll(() => {
  setMcpEndpoint(endpoint);
  usePreferencesStore.setState({ mcp: { enabled: false, port: 47_321, token: TOKEN } });
  startMcpBridge({ autoLayout: () => Promise.resolve("placed") });
});

beforeEach(() => {
  calls.length = 0;
  startFails = false;
});

/** Assistants IA (O-47) : écoute selon les options, requêtes JSON-RPC transmises au serveur MCP. */
describe("pont MCP : écoute selon les options", () => {
  it("activé avec un jeton : écoute sur le port ; désactivé : arrêtée", async () => {
    usePreferencesStore.setState({ mcp: { enabled: true, port: 47_321, token: TOKEN } });
    await vi.waitFor(() => expect(useMcpStore.getState().status).toBe("on"));
    expect(calls).toEqual([`start 47321 ${TOKEN}`]);
    usePreferencesStore.setState({ mcp: { enabled: false, port: 47_321, token: TOKEN } });
    await vi.waitFor(() => expect(useMcpStore.getState().status).toBe("off"));
    expect(calls.at(-1)).toBe("stop");
  });

  it("port changé : écoute relancée sur le nouveau ; échec signalé", async () => {
    startFails = true;
    usePreferencesStore.setState({ mcp: { enabled: true, port: 50_000, token: TOKEN } });
    await vi.waitFor(() => expect(useMcpStore.getState().status).toBe("error"));
    expect(calls).toEqual([`start 50000 ${TOKEN}`]);
    expect(useMcpStore.getState().error).toMatch(/port occupé/);
  });

  it("port repris par une autre instance, puis « Fermer les autres sessions » : écoute reprise ici", async () => {
    released!();
    expect(useMcpStore.getState().status).toBe("released");
    await takeOverMcp();
    expect(calls).toEqual(["release 50000", `start 50000 ${TOKEN}`]);
    expect(useMcpStore.getState().status).toBe("on");
  });
});

describe("pont MCP : requêtes", () => {
  it("message JSON-RPC : réponse du serveur MCP", async () => {
    expect(await ask(JSON.stringify({ jsonrpc: "2.0", id: 7, method: "ping" }))).toMatchObject({
      jsonrpc: "2.0",
      id: 7,
    });
  });

  it("corps illisible : erreur JSON-RPC -32700", async () => {
    expect(await ask("pas du json")).toEqual({
      jsonrpc: "2.0",
      id: null,
      error: { code: -32_700, message: "Parse error" },
    });
  });
});
