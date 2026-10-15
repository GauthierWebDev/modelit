import { create } from "zustand";

/** État du point d'écoute MCP et activité des assistants IA (override O-47). */
export const useMcpStore = create<{
  status: "off" | "on" | "error";
  error: string | null;
  /** Dernier échange avec un client (ms) ; 0 = aucun. */
  lastActivity: number;
}>(() => ({ status: "off", error: null, lastActivity: 0 }));

/** « IA connectée » : un client a échangé depuis moins de 5 minutes. */
export const ACTIVE_FOR = 5 * 60_000;

/** Jeton d'accès : 32 octets aléatoires, en hexadécimal. */
export function newToken(): string {
  return [...crypto.getRandomValues(new Uint8Array(32))].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Commande Claude Code qui ajoute ModelIt comme serveur MCP. */
export const claudeCodeCommand = (port: number, token: string) =>
  `claude mcp add --transport http modelit http://127.0.0.1:${port}/mcp --header "Authorization: Bearer ${token}"`;
