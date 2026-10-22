import { collationClass, defaultCollationClass } from "../ddl/collation";
import { sqliteAffinity } from "../ddl/dialects";
import type { DataType } from "../model/datatype";
import type { SequenceDefinition, SqlDialect } from "../model/physical";
import type { ParsedColumn, ParsedKey, ParsedTable } from "../reverse/parse";
import { integerRange, sqlTypeToDataType } from "../sql/types";
import type { CatalogColumn, CatalogForeignKey, CatalogKey, CatalogTable } from "./catalog";
import { type CanonicalContext, canonicalCheck, canonicalDefault, compact } from "./catalogCanonical";
import { type CheckFacts, checkFacts } from "./catalogChecks";
import {
  byText,
  collationOf,
  conceptOf,
  effective,
  keyOf,
  lengthSemanticsOf,
  rangeOf,
  schemaName,
  sequencesOf,
  stateText,
  typeDomain,
  unwrap,
} from "./catalogColumns";
import { byCodeUnit } from "./order";

interface Database {
  collation?: string;
  collations: Map<string, Record<string, string>>;
}

/** Ce que le catalogue d'une colonne doit savoir de sa table. */
interface ColumnScope {
  table: ParsedTable;
  dialect: SqlDialect;
  enumTypes: Map<string, string[]>;
  database: Database;
  facts: CheckFacts;
  /** SQLite : seule INTEGER PRIMARY KEY interdit NULL ; ailleurs, toute colonne de clé primaire. */
  rowid: boolean;
}

export function tableCatalog(
  table: ParsedTable,
  tables: Map<string, ParsedTable>,
  dialect: SqlDialect,
  enumTypes: Map<string, string[]>,
  database: Database,
  sequences: Map<string, SequenceDefinition>,
): CatalogTable {
  const columnName = (name: string) => {
    const column = table.columns.find((c) => c.name.toLowerCase() === name.toLowerCase());
    return effective(column?.name ?? name, column?.quoted ?? false, dialect);
  };
  const pk = table.primaryKey.map(columnName);
  // Collation effective insensible à la casse (déclarée, de table, de base ou par défaut du SGBD) (O-42).
  const context: CanonicalContext = {
    dialect,
    insensitive: (name) => {
      const column = table.columns.find((c) => c.name.toLowerCase() === name.toLowerCase());
      const declared = column?.collation ?? table.collation ?? database.collation;
      const klass = declared ? collationClass(declared, database.collations) : defaultCollationClass(dialect);
      return klass === "ci" || klass === "ai_ci";
    },
  };
  const rowid =
    dialect === "sqlite" &&
    table.primaryKey.length === 1 &&
    /^integer$/i.test(table.columns.find((c) => c.name === table.primaryKey[0])?.type ?? "");
  const facts = checkFacts(table, dialect);
  const scope: ColumnScope = { table, dialect, enumTypes, database, facts, rowid };
  const columns = table.columns.map((c) => columnCatalog(c, scope));
  return {
    name: effective(table.name, table.quoted, dialect),
    columns,
    primaryKey: { name: table.primaryKeyName, columns: pk },
    foreignKeys: byText(foreignKeysOf(table, tables, dialect, columnName)),
    uniques: byText(uniquesOf(table, dialect, columnName, context)),
    checks: byText(
      facts.checks.map((c) => ({
        name: c.name,
        expression: c.canonical ? c.expression : canonicalCheck(c.expression, context),
        ...(stateText(c.state) ? { state: stateText(c.state) } : {}),
      })),
    ),
    indexes: byText(table.indexes.map((i) => keyOf(i, columnName))),
    ...tableExtras(table, sequences),
  };
}

/** Commentaire, déclencheurs, état de la clé primaire, stockage, partitionnement, séquences, schéma. */
function tableExtras(
  table: ParsedTable,
  sequences: Map<string, SequenceDefinition>,
): Omit<CatalogTable, "name" | "columns" | "primaryKey" | "foreignKeys" | "uniques" | "checks" | "indexes"> {
  return {
    ...(table.comment ? { comment: table.comment } : {}),
    triggers: table.triggers.map((t) => t.name.toLowerCase()).sort(byCodeUnit),
    ...(stateText(table.primaryKeyState) ? { primaryKeyState: stateText(table.primaryKeyState) } : {}),
    ...(table.storage.length > 0 ? { storage: [...table.storage].sort() } : {}),
    ...(table.partition ? { partition: compact(table.partition).toLowerCase() } : {}),
    ...(sequencesOf(table, sequences).length > 0 ? { sequences: sequencesOf(table, sequences) } : {}),
    ...(schemaName(table.schema) ? { schema: schemaName(table.schema) } : {}),
  };
}

function columnCatalog(c: ParsedColumn, scope: ColumnScope): CatalogColumn {
  const { table, dialect, enumTypes, database, facts, rowid } = scope;
  const inPk = table.primaryKey.some((p) => p.toLowerCase() === c.name.toLowerCase());
  const domain = typeDomain(c, enumTypes) ?? facts.domains.get(c.name.toLowerCase());
  const concept = domain ? undefined : sqlTypeToDataType(c.type, c.autoIncrement, dialect);
  const defaultValue = c.default === undefined ? undefined : canonicalDefault(c.default, concept);
  const range = columnRange(c, concept, scope);
  const textual = !domain && concept?.kind === "text" && concept.encoding !== "binary";
  const emptyString = textual ? emptyStringOf(c, inPk, scope) : undefined;
  const lengthSemantics = textual ? lengthSemanticsFor(c, concept, scope) : undefined;
  return {
    name: effective(c.name, c.quoted, dialect),
    type: compact(c.type).toUpperCase(),
    concept: conceptOf(concept, domain),
    autoIncrement: c.autoIncrement,
    notNull: c.notNull || (inPk && (dialect !== "sqlite" || rowid)),
    ...(defaultValue === undefined ? {} : { default: defaultValue }),
    ...(domain ? { domain } : {}),
    ...(range ? { range } : {}),
    affinity: sqliteAffinity(c.type),
    ...collationOf(c, table, database, concept, domain, dialect),
    ...columnExtras(c),
    ...(emptyString ? { emptyString } : {}),
    ...(lengthSemantics ? { lengthSemantics } : {}),
  };
}

/** Plage de valeurs : type, UNSIGNED, positivité, bornes des CHECK, chiffres d'un NUMBER (O-39). */
function columnRange(c: ParsedColumn, concept: DataType | undefined, scope: ColumnScope) {
  const { dialect, facts } = scope;
  // UNSIGNED (MySQL) ; TINYINT SQL Server : 0 à 255 (O-41).
  const unsigned = /\bunsigned\b/i.test(c.type) || (dialect === "sqlserver" && /^\s*tinyint\b/i.test(c.type));
  // Entier à plage décimale : NUMBER(p) Oracle, et tout décimal d'échelle nulle (NUMERIC(20)) (O-39).
  const integral = concept?.kind === "decimal" && concept.scale === 0 && concept.precision !== undefined;
  const digits =
    dialect === "oracle" && /^\s*number\s*\(/i.test(c.type)
      ? integerRange(c.type, dialect)
      : integral
        ? ([
            -(10n ** BigInt((concept as { precision: number }).precision) - 1n),
            10n ** BigInt((concept as { precision: number }).precision) - 1n,
          ] as [bigint, bigint])
        : undefined;
  return rangeOf(
    integral ? { kind: "integer", bits: 64 } : concept,
    unsigned,
    facts.nonNegative.has(c.name.toLowerCase()),
    facts.bounds.get(c.name.toLowerCase()),
    digits,
  );
}

/** Valeurs toutes ASCII (CHECK IN) : un octet par caractère, octets et caractères se confondent (O-40). */
function lengthSemanticsFor(c: ParsedColumn, concept: DataType | undefined, scope: ColumnScope) {
  if (concept?.kind !== "text" || concept.length === "large") {
    return;
  }
  return scope.facts.ascii.has(c.name.toLowerCase()) ? "char" : lengthSemanticsOf(c.type, scope.dialect);
}

/** Chaîne vide (O-39) : Oracle la lit comme NULL — refusée par NOT NULL, sinon NULL. */
function emptyStringOf(c: ParsedColumn, inPk: boolean, scope: ColumnScope) {
  if (scope.dialect === "oracle") {
    return c.notNull || inPk ? "rejected" : "null";
  }
  return scope.facts.nonEmpty.has(c.name.toLowerCase()) ? "rejected" : "value";
}

/** Colonne calculée, ON UPDATE, compteur, commentaire, identité, séquence. */
function columnExtras(c: ParsedColumn): Partial<CatalogColumn> {
  return {
    ...(c.generated ? { generated: c.generated.stored ? "stored" : "virtual" } : {}),
    ...(c.onUpdate ? { onUpdate: c.onUpdate.toUpperCase() } : {}),
    ...(c.identityStart === undefined ? {} : { identityStart: c.identityStart }),
    ...(c.identityIncrement === undefined ? {} : { identityIncrement: c.identityIncrement }),
    ...(c.comment ? { comment: c.comment } : {}),
    ...(c.identity ? { identity: c.identity } : {}),
    ...(c.sequence
      ? { sequence: `${c.sequence.name.toLowerCase()}${c.sequence.trigger ? `/${c.sequence.trigger}` : ""}` }
      : {}),
  };
}

/** NULL dans une clé composée Oracle : égaux entre eux, sauf ligne entièrement NULL (O-39). */
function nullable(table: ParsedTable, n: string) {
  return !(
    table.primaryKey.some((p) => p.toLowerCase() === n.toLowerCase()) ||
    table.columns.find((c) => c.name.toLowerCase() === n.toLowerCase())?.notNull
  );
}

/** SQL Server : un seul NULL admis par UNIQUE (NULL égaux entre eux, ligne entièrement NULL comprise). */
function nullsOf(table: ParsedTable, dialect: SqlDialect, u: ParsedKey) {
  const isNullable = (n: string) => nullable(table, n);
  return u.nullsNotDistinct || (dialect === "sqlserver" && !u.where && !u.nullsDistinct && u.columns.some(isNullable))
    ? "not distinct"
    : dialect === "oracle" && u.columns.length > 1 && !u.expression && u.columns.some(isNullable)
      ? u.columns.every(isNullable)
        ? "oracle"
        : "not distinct"
      : undefined;
}

function uniquesOf(
  table: ParsedTable,
  dialect: SqlDialect,
  columnName: (n: string) => string,
  context: CanonicalContext,
): CatalogKey[] {
  const nulls = (u: ParsedKey) => nullsOf(table, dialect, u);
  return [
    ...table.uniques.map((u) => ({
      ...keyOf(u, columnName),
      ...(u.expression ? { expression: unwrap(compact(u.expression).toLowerCase()) } : {}),
      ...(u.where ? { where: canonicalCheck(u.where, context) } : {}),
      ...(nulls(u) ? { nulls: nulls(u) } : {}),
      ...(stateText(u.state) ? { state: stateText(u.state) } : {}),
    })),
    ...table.columns
      .filter((c) => c.unique)
      .map((c) => ({
        name: c.uniqueName,
        columns: [columnName(c.name)],
        ...(nulls({ columns: [c.name] }) ? { nulls: nulls({ columns: [c.name] }) } : {}),
      })),
  ];
}

function foreignKeysOf(
  table: ParsedTable,
  tables: Map<string, ParsedTable>,
  dialect: SqlDialect,
  columnName: (n: string) => string,
): CatalogForeignKey[] {
  return table.foreignKeys.map((fk) => {
    const target = tables.get(fk.table.toLowerCase());
    const referenced = fk.referencedColumns.length > 0 ? fk.referencedColumns : (target?.primaryKey ?? []);
    const refName = (n: string) => {
      const column = target?.columns.find((c) => c.name.toLowerCase() === n.toLowerCase());
      return effective(column?.name ?? n, column?.quoted ?? false, dialect);
    };
    return {
      name: fk.name,
      columns: fk.columns.map(columnName),
      table: target ? effective(target.name, target.quoted, dialect) : fk.table,
      referencedColumns: referenced.map(refName),
      onDelete: fk.onDelete ?? "no action",
      onUpdate: fk.onUpdate ?? "no action",
      ...(stateText(fk.state) ? { state: stateText(fk.state) } : {}),
    };
  });
}
