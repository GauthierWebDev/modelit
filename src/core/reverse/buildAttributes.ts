import type { DataType } from "../model/datatype";
import type { Attribute } from "../model/document";
import { createAttribute, createEntity } from "../model/factory";
import type { ValueDomain } from "../model/physical";
import { logicalName } from "../naming/typology";
import { tokenize } from "../sql/tokenize";
import { sqlTypeToDataType } from "../sql/types";
import { type Build, key, plainKey } from "./buildState";
import { inferComputedType } from "./computedType";
import type { ParsedColumn, ParsedTable } from "./parse";

/** 4. Entités et rubriques : colonnes hors clés étrangères. */
export function createEntities(b: Build, entityTables: ParsedTable[]) {
  const { doc } = b;
  const { naming } = doc.settings;
  entityTables.forEach((table, index) => {
    const entity = createEntity(table.name);
    doc.layout.positions[entity.id] = { x: (index % 5) * 280, y: Math.floor(index / 5) * 220 };
    if (logicalName(entity, naming) !== table.name) {
      entity.logicalName = table.name;
    }
    entity.comment = table.comment;
    const fkColumns = new Set(b.fks.get(table)!.flatMap((fk) => fk.columns.map(key)));
    const attributes = new Map<string, Attribute>();
    for (const column of table.columns) {
      if (fkColumns.has(key(column.name))) {
        continue;
      }
      const attribute = toAttribute(b, column, table);
      attributes.set(key(column.name), attribute);
      entity.attributes.push(attribute);
    }
    b.entities.set(table, entity);
    b.attributeOf.set(table, attributes);
    doc.entities.push(entity);
  });
}

/** Rubrique issue d'une colonne : type conceptuel, propriétés et annotations physiques (O-29). */
export function toAttribute(b: Build, column: ParsedColumn, table: ParsedTable): Attribute {
  const { schema, dialect } = b;
  const keyIndex = table.primaryKey.findIndex((c) => key(c) === key(column.name));
  const domain = valueDomain(column.type, schema.enumTypes);
  const type = columnType(b, column, table, domain);
  // UNIQUE sur la seule colonne, sans préfixe : propriété de la rubrique (le nom ou la méthode
  // éventuels sont gardés par un identifiant alternatif). Un UNIQUE sur préfixe n'en est pas un.
  const singleUnique = table.uniques.some(
    (u) => u.columns.length === 1 && key(u.columns[0]!) === key(column.name) && plainKey(u),
  );
  const attribute = createAttribute(column.name, {
    type,
    identifier: keyIndex >= 0,
    keyOrder: keyIndex >= 0 && table.primaryKey.length > 1 ? keyIndex + 1 : undefined,
    notNull: column.notNull && keyIndex < 0,
    // UNIQUE sur la seule colonne : propriété de la rubrique (le nom éventuel est gardé par un identifiant alternatif).
    unique: column.unique || singleUnique,
    comment: column.comment,
    caseSensitive: column.quoted || undefined,
    sourceType: column.type ? { sql: column.type, dialect } : undefined,
    defaultValue:
      column.default !== undefined && !/^null$/i.test(column.default)
        ? { expression: column.default, dialect }
        : undefined,
  });
  annotateAttribute(b, attribute, column, domain);
  return attribute;
}

/** Type conceptuel d'une colonne. */
function columnType(
  b: Build,
  column: ParsedColumn,
  table: ParsedTable,
  domain: ValueDomain | undefined,
): DataType | undefined {
  const { schema, dialect } = b;
  let type = sqlTypeToDataType(column.type, column.autoIncrement, dialect);
  // Colonne calculée sans type déclaré (SQL Server) : type déduit de l'expression, si possible (O-41).
  if (!type && column.generated) {
    const typeOfColumn = (name: string) => {
      const other = table.columns.find((c) => c.name.toLowerCase() === name.toLowerCase());
      return other && other !== column ? sqlTypeToDataType(other.type, false, dialect) : undefined;
    };
    type = inferComputedType(column.generated.expression, typeOfColumn, dialect);
  }
  // NUMBER sans précision alimenté par une séquence : entier 64 bits (O-39).
  if (column.sequence && type?.kind === "decimal" && type.precision === undefined) {
    type = { kind: "integer", bits: 64 };
  }
  // RAW(16) DEFAULT SYS_GUID() (Oracle) : identifiant universel → UUID (approximation signalée) (O-39).
  if (
    dialect === "oracle" &&
    /^raw\s*\(\s*16\s*\)$/i.test(column.type.trim()) &&
    /^sys_guid\s*\(\s*\)$/i.test(column.default?.trim() ?? "")
  ) {
    type = { kind: "free", sql: "UUID" };
  }
  type = domainText(domain) ?? type;
  // Collation effective : celle de la colonne, sinon de la table, sinon de la base (O-37).
  const collation = column.collation ?? table.collation ?? schema.defaultCollation;
  if (type?.kind === "text" && type.encoding !== "binary" && collation) {
    type.collation = collation;
  }
  return type;
}

/** ENUM / SET : texte, dont les valeurs permises forment le domaine de la rubrique (O-35). */
function domainText(domain: ValueDomain | undefined): DataType | undefined {
  if (domain?.kind === "enum") {
    return {
      kind: "text",
      encoding: "unicode",
      length: "variable",
      size: Math.max(1, ...domain.values.map((v) => v.length)),
    };
  }
  if (domain?.kind === "set") {
    return { kind: "text", encoding: "unicode", length: "large" };
  }
  return undefined;
}

/** Annotations physiques de la rubrique : non-signé, domaine, colonne calculée, séquence… */
function annotateAttribute(b: Build, attribute: Attribute, column: ParsedColumn, domain: ValueDomain | undefined) {
  const { dialect } = b;
  // UNSIGNED (MySQL), TINYINT (SQL Server : 0 à 255) (O-41).
  if (/\bunsigned\b/i.test(column.type) || (dialect === "sqlserver" && /^\s*tinyint\b/i.test(column.type))) {
    attribute.unsigned = true;
  }
  if (domain) {
    attribute.domain = domain;
  }
  if (column.generated) {
    attribute.generated = { ...column.generated, dialect };
  }
  if (column.onUpdate) {
    attribute.onUpdate = { expression: column.onUpdate, dialect };
  }
  if (column.sequence) {
    attribute.sequence = column.sequence;
  }
  if (column.identity) {
    attribute.identity = column.identity;
  }
  if (column.sqlServerOptions?.length) {
    attribute.sqlServerOptions = column.sqlServerOptions;
  }
  if (logicalName(attribute, b.doc.settings.naming) !== column.name) {
    attribute.logicalName = column.name;
  }
}

/** Domaine de valeurs d'un type ENUM(…) / SET(…) (MySQL) ou d'un type énuméré PostgreSQL. */
function valueDomain(type: string, enumTypes: Map<string, string[]>): ValueDomain | undefined {
  const match = /^\s*(enum|set)\s*\(/i.exec(type);
  if (match) {
    const values = tokenize(type)
      .filter((t) => t.type === "string")
      .map((t) => t.value);
    return { kind: match[1]!.toLowerCase() as "enum" | "set", values };
  }
  const named = enumTypes.get(type.trim().replace(/^"|"$/g, "").toLowerCase());
  return named ? { kind: "enum", values: named } : undefined;
}
