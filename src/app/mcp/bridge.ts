import { t } from "@/i18n";
import { type McpPreferences, usePreferencesStore } from "../preferencesStore";
import { useUiStore } from "../uiStore";
import { useMcpStore } from "./activity";
import { type McpRequest, type McpRespond, mcpEndpoint } from "./endpoint";
import { handleMcpMessage } from "./server";

/**
 * Assistants IA par MCP (override O-47), fenêtre principale : démarre ou arrête le point d'écoute local
 * selon les options, et lui transmet les requêtes au serveur MCP. Branché par `src/bootstrap.ts`.
 */

export interface McpBridgeHooks {
  /** Placement automatique du document actif (outil `auto_layout`, rétroconception). */
  autoLayout: () => Promise<void>;
}

/**
 * Libère le port tenu par d'autres instances de ModelIt, puis écoute ici
 * (« Fermer toutes les autres sessions MCP », O-47).
 */
export async function takeOverMcp() {
  const { port, token } = usePreferencesStore.getState().mcp;
  try {
    await mcpEndpoint().releaseOthers(port, token);
    await mcpEndpoint().start(port, token);
    useMcpStore.setState({ status: "on", error: null });
  } catch (e) {
    useMcpStore.setState({ status: "error", error: String(e) });
  }
}

/** Démarre l'écoute selon les options, puis la suit ; sans point d'écoute (navigateur), rien. */
export function startMcpBridge(hooks: McpBridgeHooks) {
  if (!mcpEndpoint().available()) {
    return;
  }
  void mcpEndpoint().onRequest((request, respond) => answer(request, respond, hooks));
  void mcpEndpoint().onReleased(() => useMcpStore.setState({ status: "released", error: null }));
  applyOptions(usePreferencesStore.getState().mcp);
  usePreferencesStore.subscribe((state, previous) => {
    const [now, before] = [state.mcp, previous.mcp];
    if (now.enabled !== before.enabled || now.port !== before.port || now.token !== before.token) {
      applyOptions(now);
    }
  });
}

function applyOptions({ enabled, port, token }: McpPreferences) {
  if (!(enabled && token)) {
    void mcpEndpoint()
      .stop()
      .then(() => useMcpStore.setState({ status: "off", error: null }));
    return;
  }
  mcpEndpoint()
    .start(port, token)
    .then(() => useMcpStore.setState({ status: "on", error: null }))
    .catch((e: unknown) => useMcpStore.setState({ status: "error", error: String(e) }));
}

const rpcError = (id: unknown, code: number, message: string) =>
  JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } });

/** Requête reçue par le point d'écoute : message JSON-RPC traité par le serveur MCP, réponse renvoyée. */
function answer(request: McpRequest, respond: McpRespond, hooks: McpBridgeHooks) {
  let message: unknown;
  try {
    message = JSON.parse(request.body);
  } catch {
    return respond(rpcError(null, -32_700, "Parse error"));
  }
  void handleMcpMessage(
    message,
    {
      onActivity: () => useMcpStore.setState({ lastActivity: Date.now() }),
      onApplied: (summary) => useUiStore.getState().notify({ kind: "info", text: t("mcp.applied", { summary }) }),
      autoLayout: hooks.autoLayout,
    },
    request.method ?? undefined,
  )
    .then((response) => respond(response ? JSON.stringify(response) : null))
    .catch((e: unknown) => {
      const id = (message as { id?: unknown } | null)?.id ?? null;
      respond(rpcError(id, -32_603, e instanceof Error ? e.message : String(e)));
    });
}
