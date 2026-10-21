import { useEffect } from "react";
import { useMcpStore } from "@/app/mcp/activity";
import { handleMcpMessage } from "@/app/mcp/server";
import { usePreferencesStore } from "@/app/preferencesStore";
import { useUiStore } from "@/app/uiStore";
import { activeDocument } from "@/app/workspace";
import { t } from "@/i18n";
import { mcpAvailable, onMcpReleased, onMcpRequest, releaseOtherMcp, startMcp, stopMcp } from "@/platform/mcp";
import { autoLayoutTables } from "@/ui/canvas/autoLayout";

/**
 * Libère le port tenu par d'autres instances de ModelIt, puis écoute ici
 * (« Fermer toutes les autres sessions MCP », O-47).
 */
export async function takeOverMcp() {
  const { port, token } = usePreferencesStore.getState().mcp;
  try {
    await releaseOtherMcp(port, token);
    await startMcp(port, token);
    useMcpStore.setState({ status: "on", error: null });
  } catch (e) {
    useMcpStore.setState({ status: "error", error: String(e) });
  }
}

/**
 * Assistants IA par MCP (override O-47), fenêtre principale : démarre ou arrête le point d'écoute
 * local selon les options, et lui transmet les requêtes au serveur MCP.
 */
export function McpBridge() {
  const { enabled, port, token } = usePreferencesStore((s) => s.mcp);

  useEffect(() => {
    if (!mcpAvailable()) {
      return;
    }
    let off: (() => void) | undefined;
    let disposed = false;
    void onMcpRequest((request, respond) => {
      let message: unknown;
      try {
        message = JSON.parse(request.body);
      } catch {
        return respond(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32_700, message: "Parse error" } }));
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
        .catch((e: unknown) => {
          const id = (message as { id?: unknown } | null)?.id ?? null;
          respond(
            JSON.stringify({
              jsonrpc: "2.0",
              id,
              error: { code: -32_603, message: e instanceof Error ? e.message : String(e) },
            }),
          );
        });
    }).then((f) => {
      if (disposed) {
        f();
      } else {
        off = f;
      }
    });
    let offReleased: (() => void) | undefined;
    void onMcpReleased(() => useMcpStore.setState({ status: "released", error: null })).then((f) => {
      if (disposed) {
        f();
      } else {
        offReleased = f;
      }
    });
    return () => {
      disposed = true;
      off?.();
      offReleased?.();
    };
  }, []);

  useEffect(() => {
    if (!mcpAvailable()) {
      return;
    }
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
