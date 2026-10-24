import { DBMS_LIST, REFERENTIAL_ACTIONS, TYPE_KEYS, TYPOLOGIES } from "@core/index";

/** Schémas JSON des opérations d'`apply_changes` (overrides O-47, O-69), décrits pour l'assistant IA. */

const DBMS_IDS = DBMS_LIST.map((d) => d.id);
const str = (description?: string) => ({ type: "string", ...(description ? { description } : {}) });
const bool = (description?: string) => ({ type: "boolean", ...(description ? { description } : {}) });
const strings = (description?: string) => ({
  type: "array",
  items: { type: "string" },
  ...(description ? { description } : {}),
});
const op = (name: string, properties: Record<string, unknown>, required: string[] = [], description?: string) => ({
  type: "object",
  ...(description ? { description } : {}),
  properties: { op: { const: name }, ...properties },
  required: ["op", ...required],
});

const ATTRIBUTE = {
  type: "object",
  properties: {
    id: str("Existing attribute to keep (set_attributes); otherwise matched by name"),
    name: str(),
    type: str("SQL type, e.g. VARCHAR(50), INT, DECIMAL(10,2), DATE, BOOLEAN, SERIAL"),
    identifier: bool("Part of the identifier (primary key)"),
    notNull: bool(),
    unique: bool(),
    comment: str(),
  },
  required: ["name"],
};
const ATTRIBUTES = { type: "array", items: ATTRIBUTE };
const KEYS = {
  type: "array",
  items: {
    type: "object",
    properties: { name: str(), attributes: strings("Attribute names or ids") },
    required: ["attributes"],
  },
};
const ACTION = { enum: [...REFERENTIAL_ACTIONS, ""], description: "Empty string: default behaviour" };
const CLEAR = "Empty string removes the value";

export const OPERATION_SCHEMAS = [
  op("create_entity", { name: str(), attributes: ATTRIBUTES }, ["name"]),
  op(
    "create_association",
    {
      name: str(),
      links: {
        type: "array",
        minItems: 2,
        items: {
          type: "object",
          properties: { entity: str(), cardinality: str(), relativeIdentifier: bool() },
          required: ["entity", "cardinality"],
        },
      },
      attributes: ATTRIBUTES,
    },
    ["name", "links"],
  ),
  op(
    "create_inheritance",
    { parent: str(), children: { ...strings(), minItems: 2 }, constraint: { enum: ["none", "X", "T", "XT"] } },
    ["parent", "children"],
  ),
  op("rename", { target: str(), name: str() }, ["target", "name"]),
  op(
    "update_node",
    {
      target: str(),
      name: str(),
      logicalName: str(`Table name in the LDM/SQL. ${CLEAR}`),
      comment: str(CLEAR),
      fictive: bool("Entities only"),
    },
    ["target"],
    "Change an entity or an association",
  ),
  op(
    "update_inheritance",
    {
      target: str("Inheritance id"),
      parent: str(),
      constraint: { enum: ["none", "X", "T", "XT"] },
      comment: str(),
      addChildren: strings(),
      removeChildren: strings(),
    },
    ["target"],
  ),
  op(
    "set_attributes",
    { target: str(), attributes: ATTRIBUTES },
    ["target", "attributes"],
    "Replace the attribute list: matched attributes keep their id and everything not given; missing ones are deleted",
  ),
  op("add_attributes", { target: str(), attributes: ATTRIBUTES }, ["target", "attributes"]),
  op(
    "update_attribute",
    {
      target: str("Entity or association"),
      attribute: str("Attribute name or id"),
      name: str(),
      logicalName: str(`Column name in the LDM/SQL. ${CLEAR}`),
      type: str("SQL type"),
      identifier: bool(),
      notNull: bool(),
      unique: bool(),
      comment: str(CLEAR),
      complement: str(`SQL appended to the column. ${CLEAR}`),
      default: str(`DEFAULT expression. ${CLEAR}`),
      check: str(`CHECK expression on this column. ${CLEAR}`),
      unsigned: bool(),
      caseSensitive: bool("Quoted name"),
      sqlType: str(`Exact SQL type of the column for the target DBMS (PDM). ${CLEAR}`),
    },
    ["target", "attribute"],
    "Change one attribute without recreating it",
  ),
  op(
    "add_link",
    { association: str(), entity: str(), cardinality: str(), relativeIdentifier: bool() },
    ["association", "entity"],
    "Add a link (leg) to an existing association, e.g. to make it ternary",
  ),
  op("add_auto_identifier", { target: str("Entity") }, ["target"]),
  op(
    "set_link",
    {
      link: str("Link id (required for a reflexive association); an inheritance link id sets relationLabel only"),
      association: str(),
      entity: str(),
      cardinality: str(),
      relativeIdentifier: bool(),
      role: str(CLEAR),
      onDelete: ACTION,
      onUpdate: ACTION,
      constraintName: str(`Foreign key constraint name. ${CLEAR}`),
      relationLabel: str(`Free text on the LDM/PDM line. ${CLEAR}`),
      foreignKeyNames: {
        type: "object",
        additionalProperties: { type: "string" },
        description: "Referenced attribute (name or id) → foreign key column name; empty restores the default",
      },
    },
    [],
  ),
  op(
    "set_physical",
    {
      target: str(),
      caseSensitive: bool("Quoted table name"),
      primaryKeyName: str(CLEAR),
      alternateKeys: KEYS,
      indexes: KEYS,
      checks: {
        type: "array",
        items: { type: "object", properties: { name: str(), expression: str() }, required: ["expression"] },
      },
    },
    ["target"],
    "Table annotations; each list given replaces the previous one",
  ),
  op("delete", { targets: strings() }, ["targets"]),
  op(
    "set_dbms",
    { dbms: { enum: DBMS_IDS }, version: str(), keepCustom: bool("Keep the model's custom DBMS (default true)") },
    ["dbms"],
  ),
  op("set_settings", {
    naming: { type: "object", properties: { typology: { enum: TYPOLOGIES }, stripAccents: bool() } },
    autoIdMask: str("e.g. code <entity>"),
    primaryKey: str("e.g. id_<table>"),
    foreignKey: str("e.g. <table>_id"),
    ddl: { type: "object", description: "Script options, as returned by get_settings" },
  }),
  op("customize_dbms", { name: str() }, [], "Turn the target DBMS into the model's custom DBMS (or rename it)"),
  op("set_custom_type", { type: { enum: TYPE_KEYS }, sql: str("SQL type template; empty restores the base type") }, [
    "type",
    "sql",
  ]),
  op("reset_custom_types", {}),
  op("remove_customization", {}),
];
