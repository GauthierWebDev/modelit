import { useEffect } from "react";
import { useMcpStore } from "@/app/mcp/activity";
import { handleMcpMessage } from "@/app/mcp/server";
import { usePreferencesStore } from "@/app/preferencesStore";
import { useUiStore } from "@/app/uiStore";
import { activeDocument } from "@/app/workspace";
import { t } from "@/i18n";
import { mcpAvailable, onMcpRequest, startMcp, stopMcp } from "@/platform/mcp";
import { autoLayoutTables } from "@/ui/canvas/autoLayout";

/**
 * Assistants IA par MCP (override O-47), fenêtre principale : démarre ou arrête le point d'écoute
 * local selon les options, et lui transmet les requêtes au serveur MCP.
 */
export function McpBridge() {
  const { enabled, port, token } = usePreferencesStore((s) => s.mcp);

  useEffect(() => {
    if (!mcpAvailable()) return;
    let off: (() => void) | undefined;
    let disposed = false;
    void onMcpRequest((request, respond) => {
      let message: unknown;
      try {
        message = JSON.parse(request.body);
      } catch {
        return respond(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }));
      }
      void handleMcpMessage(
        message,
        {
          onActivity: () => useMcpStore.setState({ lastActivity: Date.now() }),
          onApplied: (summary) => useUiStore.getState().notify({ kind: "info", text: t("mcp.applied", { summary }) }),
          autoLayout: () => autoLayoutTables(activeDocument()),
        },
        request.method ?? undefined,
      )
        .then((response) => respond(response ? JSON.stringify(response) : null))
        .catch((e) => respond(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32603, message: String(e) } })));
    }).then((f) => (disposed ? f() : (off = f)));
    return () => {
      disposed = true;
      off?.();
    };
  }, []);

  useEffect(() => {
    if (!mcpAvailable()) return;
    if (!enabled || !token) {
      void stopMcp().then(() => useMcpStore.setState({ status: "off", error: null }));
      return;
    }
    startMcp(port, token)
      .then(() => useMcpStore.setState({ status: "on", error: null }))
      .catch((e) => useMcpStore.setState({ status: "error", error: String(e) }));
  }, [enabled, port, token]);

  return null;
}
