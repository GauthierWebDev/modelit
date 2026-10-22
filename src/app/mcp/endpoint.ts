import { unplugged } from "../unplugged";

/**
 * Port du point d'écoute MCP local (override O-47), défini par l'application (`bridge.ts`) ; implémenté
 * par la plateforme (`platform/mcp.ts` : écoute en Rust, `src-tauri/src/mcp.rs`) et branché au démarrage
 * (`src/bootstrap.ts`). Les tests branchent un faux.
 */

export interface McpRequest {
  id: number;
  body: string;
  /** En-tête `Mcp-Method` (révision 2026-07-28), s'il est présent. */
  method: string | null;
}

/** Réponse JSON à une requête, ou `null` pour une notification. */
export type McpRespond = (body: string | null) => void;

export interface McpEndpoint {
  /** Faux dans un navigateur. */
  available: () => boolean;
  start: (port: number, token: string) => Promise<void>;
  stop: () => Promise<void>;
  /** Demande à l'instance qui écoute sur `port` de le libérer (même jeton) ; `false` : personne n'écoutait. */
  releaseOthers: (port: number, token: string) => Promise<boolean>;
  /** Requêtes reçues ; renvoie la désinscription. */
  onRequest: (handler: (request: McpRequest, respond: McpRespond) => void) => Promise<() => void>;
  /** Une autre instance a repris le port : l'écoute de celle-ci est arrêtée. */
  onReleased: (handler: () => void) => Promise<() => void>;
}

let current: McpEndpoint = unplugged<McpEndpoint>("McpEndpoint");

export function setMcpEndpoint(adapter: McpEndpoint) {
  current = adapter;
}

export const mcpEndpoint = (): McpEndpoint => current;
