import { invoke, isTauri } from "@tauri-apps/api/core";

/**
 * Point d'écoute MCP local (override O-47), implémenté en Rust (`src-tauri/src/mcp.rs`) : démarrage,
 * arrêt, et requêtes JSON-RPC reçues à traiter. Indisponible dans un navigateur.
 */

export const mcpAvailable = () => isTauri();

export const startMcp = (port: number, token: string) => invoke<void>("mcp_start", { port, token });

export const stopMcp = () => invoke<void>("mcp_stop");

/**
 * Demande à l'instance de ModelIt qui écoute sur `port` de le libérer (même jeton).
 * `false` : personne n'écoutait.
 */
export const releaseOtherMcp = (port: number, token: string) => invoke<boolean>("mcp_release_others", { port, token });

/** Une autre instance a repris le port : l'écoute de celle-ci est arrêtée. */
export async function onMcpReleased(handler: () => void): Promise<() => void> {
  const { listen } = await import("@tauri-apps/api/event");
  return listen("mcp://released", handler);
}

export interface McpRequest {
  id: number;
  body: string;
  /** En-tête `Mcp-Method` (révision 2026-07-28), s'il est présent. */
  method: string | null;
}

/** Requêtes reçues ; `respond` renvoie la réponse JSON (ou `null` pour une notification). */
export async function onMcpRequest(handler: (request: McpRequest, respond: (body: string | null) => void) => void): Promise<() => void> {
  const { listen } = await import("@tauri-apps/api/event");
  return listen<McpRequest>("mcp://request", (e) => {
    const request = e.payload;
    handler(request, (body) => void invoke("mcp_reply", { id: request.id, body }));
  });
}
