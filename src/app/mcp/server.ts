import { TOOLS } from "./tools";

export { TOOLS } from "./tools";

import {
  detectDialect,
  issueMessage,
  type ModelDocument,
  mldPlainText,
  reverseEngineer,
  type SqlDialect,
} from "@core/index";
import { APP_INFO } from "../appInfo";
import { aiWriteRefusal } from "../collab/session";
import { ddlOf, logicalModelOf } from "../derived";
import type { DocumentHandle } from "../document/handle";
import { documentName } from "../fileCommands";
import { modalOpen } from "../modal";
import { newModelDocument } from "../modelDefaults";
import { activeDocument, openInTab, useWorkspaceStore } from "../workspace";
import { applyChanges, type Operation } from "./apply";
import { describeModel } from "./describe";

/**
 * Serveur MCP de ModelIt (override O-47), côté interface : JSON-RPC reçu du point d'écoute local
 * (Rust), réponse renvoyée. Accepte les clients qui commencent par `initialize` (révisions
 * 2025-xx) comme les requêtes sans poignée de main (révision 2026-07-28, sans état).
 */

export const SUPPORTED_VERSIONS = ["2026-07-28", "2025-11-25", "2025-06-18", "2025-03-26"];

interface Request {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

interface Response {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string };
}

/** Ce que l'application doit faire autour d'un appel : rendre compte de l'activité de l'IA. */
export interface McpHooks {
  /** Une modification a été appliquée (message pour la barre d'état). */
  onApplied?: (summary: string) => void;
  /** Un client a échangé avec ModelIt. */
  onActivity?: () => void;
  /** Placement automatique du document actif (exécuté par l'interface). */
  autoLayout?: () => Promise<void> | void;
}

export const text = (value: unknown) => ({
  content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }],
});

const failure = (message: string) => ({ ...text(message), isError: true });

/** ModelIt occupé : boîte de dialogue ouverte, ou glisser-déposer en cours (O-47). */
function busy(): boolean {
  return modalOpen() || activeDocument().store.getState().transactionStart !== null;
}

const WRITE_TOOLS = new Set(["apply_changes", "reverse_engineer", "auto_layout"]);

async function callTool(name: string, args: Record<string, unknown>, hooks: McpHooks) {
  const doc = activeDocument();
  const model = doc.store.getState().doc;
  if (WRITE_TOOLS.has(name) && busy()) {
    return failure("ModelIt is busy (a dialog is open or a drag is in progress): try again in a moment.");
  }
  // Session collaborative rejointe : lecteur, IA interdite par l'hôte (O-05 §8). Un nouvel onglet
  // (rétroconception) n'est pas concerné.
  const refusal = name === "reverse_engineer" ? null : WRITE_TOOLS.has(name) ? aiWriteRefusal(doc.id) : null;
  if (refusal) {
    return failure(refusal);
  }
  return readTool(name, doc, model) ?? (await writeTool(name, args, doc, hooks));
}

/** Outils de lecture ; `undefined` pour un autre outil. */
function readTool(name: string, doc: DocumentHandle, model: ModelDocument) {
  switch (name) {
    case "list_documents": {
      const { documents, activeId } = useWorkspaceStore.getState();
      return text(documents.map((d) => ({ name: documentName(d), active: d.id === activeId })));
    }
    case "get_model":
      return text(describeModel(model, documentName(doc)));
    case "get_mld":
      return text(mldPlainText(logicalModelOf(model)) || "(empty model)");
    case "get_sql": {
      const ddl = ddlOf(model);
      return ddl.ok
        ? text({
            dbms: model.settings.dbms,
            version: model.settings.dbmsVersion,
            sql: ddl.sql,
            losses: ddl.losses.map((l) => l.message),
          })
        : failure(ddl.error);
    }
    case "list_issues":
      return text(
        logicalModelOf(model).issues.map((i) => ({
          severity: i.severity,
          message: issueMessage(i, "conceptual"),
          ...(i.target ? { target: i.target.id } : {}),
        })),
      );
    default:
      return;
  }
}

/** Outils de modification (et outil inconnu). */
async function writeTool(name: string, args: Record<string, unknown>, doc: DocumentHandle, hooks: McpHooks) {
  switch (name) {
    case "apply_changes": {
      const result = applyChanges(doc, (args.operations ?? []) as Operation[]);
      if (!result.ok) {
        return failure(`Nothing was applied. ${result.error}`);
      }
      hooks.onApplied?.(result.summary.join(" ; "));
      return text({
        document: documentName(doc),
        applied: result.summary,
        created: result.created,
        issues: logicalModelOf(doc.store.getState().doc).issues.length,
      });
    }
    case "reverse_engineer":
      return reverseTool(String(args.sql ?? ""), hooks);
    case "auto_layout":
      await hooks.autoLayout?.();
      return text("Layout done.");
    default:
      return failure(`Unknown tool « ${name} ».`);
  }
}

async function reverseTool(sql: string, hooks: McpHooks) {
  const result = reverseEngineer(sql, newModelDocument(), detectDialect(sql) as SqlDialect);
  if (result.report.tables === 0) {
    return failure("No table found in the script.");
  }
  const opened = openInTab((d) => d.store.getState().load(result.doc, null, true));
  await hooks.autoLayout?.();
  hooks.onApplied?.(`reverse engineering: ${result.report.tables} table(s)`);
  return text({ document: documentName(opened), report: result.report });
}

/**
 * Traite un message JSON-RPC ; `null` pour une notification (pas de réponse).
 * `methodHeader` : en-tête `Mcp-Method` (révision 2026-07-28), qui doit correspondre au corps.
 */
export async function handleMcpMessage(
  raw: unknown,
  hooks: McpHooks = {},
  methodHeader?: string,
): Promise<Response | null> {
  const message = raw as Partial<Request> | null;
  if (!isRequest(message)) {
    return { jsonrpc: "2.0", id: null, error: { code: -32_600, message: "Invalid request" } };
  }
  const id = message.id ?? null;
  if (methodHeader && methodHeader !== message.method) {
    return { jsonrpc: "2.0", id, error: { code: -32_600, message: "Mcp-Method header does not match the body" } };
  }
  hooks.onActivity?.();
  if (message.id === undefined) {
    return null; // notification (ex. notifications/initialized)
  }
  return await respond(message, id, hooks);
}

const isRequest = (message: Partial<Request> | null): message is Request =>
  Boolean(message) &&
  typeof message === "object" &&
  !Array.isArray(message) &&
  message!.jsonrpc === "2.0" &&
  typeof message!.method === "string";

/** Réponse à une requête (initialize, ping, tools/list, tools/call). */
async function respond(message: Request, id: Response["id"], hooks: McpHooks): Promise<Response> {
  const ok = (result: unknown): Response => ({ jsonrpc: "2.0", id, result });
  switch (message.method) {
    case "initialize": {
      const requested = String(message.params?.protocolVersion ?? "");
      return ok({
        protocolVersion: SUPPORTED_VERSIONS.includes(requested) ? requested : SUPPORTED_VERSIONS[1],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "ModelIt", version: APP_INFO.version },
        instructions:
          "ModelIt is a Merise data modelling tool (MCD → MLD → SQL). Tools act on the document of the active tab. Read it with get_model before changing it; apply_changes is all-or-nothing and undoable by the user.",
      });
    }
    case "ping":
      return ok({});
    case "tools/list":
      return ok({ tools: TOOLS });
    case "tools/call": {
      const name = String(message.params?.name ?? "");
      const args = (message.params?.arguments ?? {}) as Record<string, unknown>;
      // Une exception dans un outil reste dans le protocole : résultat en erreur, avec son message.
      try {
        return ok(await callTool(name, args, hooks));
      } catch (e) {
        return ok(failure(`${name} failed: ${e instanceof Error ? e.message : String(e)}`));
      }
    }
    default:
      return { jsonrpc: "2.0", id, error: { code: -32_601, message: `Method not found: ${message.method}` } };
  }
}
