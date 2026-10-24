import { OPERATION_SCHEMAS } from "./toolOperations";

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
      'Get the conceptual data model (Merise MCD) of the active tab: entities and associations with ids, logical (table) names, attributes (ids, logical names, SQL type as in the PDM), links (ids, cardinalities, roles, foreign key names), inheritances. detail "full" adds physical annotations (DEFAULT, CHECK, keys, indexes, referential actions). Objects can be referred to by id or by name.',
    inputSchema: { type: "object", properties: { detail: { enum: ["conceptual", "full"] } } },
  },
  {
    name: "get_settings",
    description:
      "Get the model settings of the active tab: target DBMS and version, naming (typology, accents), key name patterns, SQL script options, custom DBMS (name and redefined types).",
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
          items: { oneOf: OPERATION_SCHEMAS },
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
