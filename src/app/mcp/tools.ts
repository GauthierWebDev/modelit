import { DBMS_LIST } from "@core/index";

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
