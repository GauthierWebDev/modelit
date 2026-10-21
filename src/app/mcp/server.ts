import { DBMS_LIST, detectDialect, issueMessage, mldPlainText, reverseEngineer, type SqlDialect } from "@core/index";
import { APP_INFO } from "../appInfo";
import { aiWriteRefusal } from "../collab/session";
import { ddlOf, logicalModelOf } from "../derived";
import { useDialogStore } from "../dialogStore";
import { documentName } from "../fileCommands";
import { newModelDocument } from "../modelDefaults";
import { useUiStore } from "../uiStore";
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

const DBMS_IDS = DBMS_LIST.map((d) => d.id);

const ATTRIBUTE_SCHEMA = {
  type: "object",
  properties: {
    name: { type: "string" },
    type: { type: "string", description: "SQL type, e.g. VARCHAR(50), INT, DECIMAL(10,2), DATE, BOOLEAN, SERIAL" },
    identifier: { type: "boolean", description: "Part of the identifier (primary key)" },
    notNull: { type: "boolean" },
    unique: { type: "boolean" },
    comment: { type: "string" },
  },
  required: ["name"],
};

export const TOOLS = [
  {
    name: "list_documents",
    description:
      "List the documents open in ModelIt (one per tab) and tell which one is active. Tools act on the active tab.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "get_model",
    description:
      "Get the conceptual data model (Merise MCD) of the active tab: entities with their attributes (SQL type in the target DBMS), associations with their links and cardinalities, inheritances. Objects can be referred to by id or by name.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "get_mld",
    description:
      "Get the logical data model (MLD, relational schema) derived from the active tab, as text: table = (columns); underlined primary keys are noted _x_, foreign keys #x.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "get_sql",
    description:
      "Get the SQL DDL script generated for the target DBMS of the active tab, with the list of constructs the DBMS cannot express (losses).",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "list_issues",
    description: "List the problems (errors and warnings) detected in the active tab's model.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "apply_changes",
    description:
      "Apply a list of changes to the active tab's model, in order. Validated like the user interface; all or nothing; one undo step for the user. Refer to entities and associations by name or id. Cardinalities are 'min,max' with max a number or n (e.g. 0,1 / 1,1 / 0,n / 1,n).",
    inputSchema: {
      type: "object",
      properties: {
        operations: {
          type: "array",
          items: {
            oneOf: [
              {
                type: "object",
                properties: {
                  op: { const: "create_entity" },
                  name: { type: "string" },
                  attributes: { type: "array", items: ATTRIBUTE_SCHEMA },
                },
                required: ["op", "name"],
              },
              {
                type: "object",
                properties: {
                  op: { const: "create_association" },
                  name: { type: "string" },
                  links: {
                    type: "array",
                    minItems: 2,
                    items: {
                      type: "object",
                      properties: {
                        entity: { type: "string" },
                        cardinality: { type: "string" },
                        relativeIdentifier: { type: "boolean" },
                      },
                      required: ["entity", "cardinality"],
                    },
                  },
                  attributes: { type: "array", items: ATTRIBUTE_SCHEMA },
                },
                required: ["op", "name", "links"],
              },
              {
                type: "object",
                properties: {
                  op: { const: "create_inheritance" },
                  parent: { type: "string" },
                  children: { type: "array", items: { type: "string" }, minItems: 2 },
                  constraint: { enum: ["none", "X", "T", "XT"] },
                },
                required: ["op", "parent", "children"],
              },
              {
                type: "object",
                properties: { op: { const: "rename" }, target: { type: "string" }, name: { type: "string" } },
                required: ["op", "target", "name"],
              },
              {
                type: "object",
                properties: {
                  op: { const: "set_attributes" },
                  target: { type: "string" },
                  attributes: { type: "array", items: ATTRIBUTE_SCHEMA },
                },
                required: ["op", "target", "attributes"],
              },
              {
                type: "object",
                properties: {
                  op: { const: "add_attributes" },
                  target: { type: "string" },
                  attributes: { type: "array", items: ATTRIBUTE_SCHEMA },
                },
                required: ["op", "target", "attributes"],
              },
              {
                type: "object",
                properties: {
                  op: { const: "set_link" },
                  association: { type: "string" },
                  entity: { type: "string" },
                  cardinality: { type: "string" },
                  relativeIdentifier: { type: "boolean" },
                },
                required: ["op", "association", "entity"],
              },
              {
                type: "object",
                properties: { op: { const: "delete" }, targets: { type: "array", items: { type: "string" } } },
                required: ["op", "targets"],
              },
              {
                type: "object",
                properties: { op: { const: "set_dbms" }, dbms: { enum: DBMS_IDS }, version: { type: "string" } },
                required: ["op", "dbms"],
              },
            ],
          },
        },
      },
      required: ["operations"],
    },
  },
  {
    name: "reverse_engineer",
    description:
      "Rebuild a conceptual model from a SQL DDL script (any DBMS, dialect detected automatically). The result opens in a new tab, which becomes active.",
    inputSchema: { type: "object", properties: { sql: { type: "string" } }, required: ["sql"] },
  },
  {
    name: "auto_layout",
    description: "Arrange the diagram of the active tab automatically (no crossing lines).",
    inputSchema: { type: "object", properties: {} },
  },
];

const text = (value: unknown) => ({
  content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }],
});
const failure = (message: string) => ({ ...text(message), isError: true });

/** ModelIt occupé : boîte de dialogue ouverte, ou glisser-déposer en cours (O-47). */
function busy(): boolean {
  const ui = useUiStore.getState();
  return (
    useDialogStore.getState().queue.length > 0 ||
    ui.exportOpen ||
    ui.optionsOpen ||
    ui.modelSettingsOpen ||
    ui.reverseOpen ||
    ui.shareOpen ||
    ui.about !== null ||
    activeDocument().store.getState().transactionStart !== null
  );
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
    case "reverse_engineer": {
      const sql = String(args.sql ?? "");
      const result = reverseEngineer(sql, newModelDocument(), detectDialect(sql) as SqlDialect);
      if (result.report.tables === 0) {
        return failure("No table found in the script.");
      }
      const opened = openInTab((d) => d.store.getState().load(result.doc, null, true));
      await hooks.autoLayout?.();
      hooks.onApplied?.(`reverse engineering: ${result.report.tables} table(s)`);
      return text({ document: documentName(opened), report: result.report });
    }
    case "auto_layout":
      await hooks.autoLayout?.();
      return text("Layout done.");
    default:
      return failure(`Unknown tool « ${name} ».`);
  }
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
  if (
    !message ||
    typeof message !== "object" ||
    Array.isArray(message) ||
    message.jsonrpc !== "2.0" ||
    typeof message.method !== "string"
  ) {
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
