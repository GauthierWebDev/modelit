import { collationClass, defaultCollationClass } from "../ddl/collation";
import { sqliteAffinity } from "../ddl/dialects";
import {
  asciiDomain,
  type Condition,
  excludesEmptyString,
  impliesNonNegative,
  parseCondition,
  valueBounds,
} from "../ddl/expressions";
import type { SequenceDefinition, SqlDialect } from "../model/physical";
import type { NamedExpression, ParsedKey, ParsedTable } from "../reverse/parse";
import { integerRange, sqlTypeToDataType } from "../reverse/types";
import type { CatalogColumn, CatalogTable } from "./catalog";
import {
  type CanonicalContext,
  canonicalCheck,
  canonicalCondition,
  canonicalDefault,
  compact,
} from "./catalogCanonical";
import {
  byText,
  collationOf,
  conceptOf,
  domainCheck,
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

export function tableCatalog(
  table: ParsedTable,
  tables: Map<string, ParsedTable>,
  dialect: SqlDialect,
  enumTypes: Map<string, string[]>,
  database: { collation?: string; collations: Map<string, Record<string, string>> },
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
  // SQLite : seule INTEGER PRIMARY KEY interdit NULL ; ailleurs, toute colonne de clé primaire.
  const rowid =
    dialect === "sqlite" &&
    table.primaryKey.length === 1 &&
    /^integer$/i.test(table.columns.find((c) => c.name === table.primaryKey[0])?.type ?? "");

  // CHECK de domaine / positivité : propriétés des colonnes, pas des contraintes.
  const allChecks: NamedExpression[] = [...table.checks, ...table.columns.filter((c) => c.check).map((c) => c.check!)];
  // Une contrainte désactivée (Oracle DISABLE) ne contraint pas les valeurs (O-39).
  const activeChecks = allChecks.filter((c) => !c.state?.disabled);
  const domains = new Map<string, string>();
  const nonNegative = new Set<string>();
  const checks: (NamedExpression & { canonical?: boolean })[] = [];
  // Bornes d'une colonne : YEAR (MySQL : 1901–2155), BETWEEN à bornes numériques (O-38).
  const bounds = new Map<string, [bigint | null, bigint | null]>();
  const bound = (column: string, lo: bigint | null, hi: bigint | null) => {
    const k = column.toLowerCase();
    const old = bounds.get(k);
    const max = (a: bigint | null, b: bigint | null) => (a === null ? b : b === null ? a : a > b ? a : b);
    const min = (a: bigint | null, b: bigint | null) => (a === null ? b : b === null ? a : a < b ? a : b);
    bounds.set(k, old ? [max(lo, old[0]), min(hi, old[1])] : [lo, hi]);
  };
  // Tout CHECK actif borne les valeurs des colonnes qu'il contraint (ex. est_cadre IN (0, 1)) (O-39).
  const nonEmpty = new Set<string>();
  const ascii = new Set<string>();
  for (const check of activeChecks) {
    const condition = parseCondition(check.expression);
    if (!condition) {
      continue;
    }
    for (const column of table.columns) {
      const b = valueBounds(condition, column.name);
      if (b !== "none" && (b.lo !== null || b.hi !== null)) {
        bound(column.name, b.lo, b.hi);
      }
      if (excludesEmptyString(condition, column.name)) {
        nonEmpty.add(column.name.toLowerCase());
      }
      if (asciiDomain(condition, column.name)) {
        ascii.add(column.name.toLowerCase());
      }
    }
  }
  if (dialect === "mysql" || dialect === "mariadb") {
    for (const c of table.columns) {
      if (/^year\b/i.test(c.type)) {
        bound(c.name, 1901n, 2155n);
      }
    }
  }
  const numericBetween = (c: Condition) =>
    c.kind === "between" &&
    !c.negated &&
    c.operand.kind === "column" &&
    c.low.kind === "number" &&
    c.high.kind === "number" &&
    /^-?\d+$/.test(c.low.value) &&
    /^-?\d+$/.test(c.high.value)
      ? { column: c.operand.name, lo: BigInt(c.low.value), hi: BigInt(c.high.value) }
      : null;
  for (const check of allChecks) {
    const condition = parseCondition(check.expression);
    // Tout CHECK qui exclut les négatifs d'une colonne (ex. niveau BETWEEN 1 AND 3) borne sa plage.
    if (condition && !check.state?.disabled) {
      for (const column of table.columns) {
        if (impliesNonNegative(condition, column.name)) {
          nonNegative.add(column.name.toLowerCase());
        }
      }
    }
    const special = check.state ? null : domainCheck(check);
    if (special?.domain) {
      domains.set(special.column.toLowerCase(), special.domain);
      continue;
    }
    if (special?.nonNegative) {
      nonNegative.add(special.column.toLowerCase());
      continue;
    }
    if (special?.nonEmpty) {
      continue;
    }
    // BETWEEN anonyme seul, ou conjoint d'un AND (ex. ck_annee fusionné avec la plage de YEAR) : une plage.
    const alone = !check.name && condition ? numericBetween(condition) : null;
    if (alone) {
      bound(alone.column, alone.lo, alone.hi);
      continue;
    }
    if (condition?.kind === "and") {
      const rest = condition.items.filter((item) => {
        const b = numericBetween(item);
        if (b) {
          bound(b.column, b.lo, b.hi);
        }
        return !b;
      });
      if (rest.length !== condition.items.length) {
        checks.push({
          name: check.name,
          expression: JSON.stringify(canonicalCondition(rest.length === 1 ? rest[0]! : { kind: "and", items: rest })),
          canonical: true,
        });
        continue;
      }
    }
    checks.push(check);
  }

  const columns = table.columns.map((c): CatalogColumn => {
    const inPk = table.primaryKey.some((p) => p.toLowerCase() === c.name.toLowerCase());
    // UNSIGNED (MySQL) ; TINYINT SQL Server : 0 à 255 (O-41).
    const unsigned = /\bunsigned\b/i.test(c.type) || (dialect === "sqlserver" && /^\s*tinyint\b/i.test(c.type));
    const domain = typeDomain(c, enumTypes) ?? domains.get(c.name.toLowerCase());
    const concept = domain ? undefined : sqlTypeToDataType(c.type, c.autoIncrement, dialect);
    const defaultValue = c.default === undefined ? undefined : canonicalDefault(c.default, concept);
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
    const range = rangeOf(
      integral ? { kind: "integer", bits: 64 } : concept,
      unsigned,
      nonNegative.has(c.name.toLowerCase()),
      bounds.get(c.name.toLowerCase()),
      digits,
    );
    const textual = !domain && concept?.kind === "text" && concept.encoding !== "binary";
    // Chaîne vide (O-39) : Oracle la lit comme NULL — refusée par NOT NULL, sinon NULL.
    const emptyString = textual
      ? dialect === "oracle"
        ? c.notNull || inPk
          ? "rejected"
          : "null"
        : nonEmpty.has(c.name.toLowerCase())
          ? "rejected"
          : "value"
      : undefined;
    // Valeurs toutes ASCII (CHECK IN) : un octet par caractère, octets et caractères se confondent (O-40).
    const lengthSemantics =
      !textual || concept?.kind !== "text" || concept.length === "large"
        ? undefined
        : ascii.has(c.name.toLowerCase())
          ? "char"
          : lengthSemanticsOf(c.type, dialect);
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
      ...(c.generated ? { generated: c.generated.stored ? "stored" : "virtual" } : {}),
      ...(c.onUpdate ? { onUpdate: c.onUpdate.toUpperCase() } : {}),
      ...(c.identityStart === undefined ? {} : { identityStart: c.identityStart }),
      ...(c.identityIncrement === undefined ? {} : { identityIncrement: c.identityIncrement }),
      ...(c.comment ? { comment: c.comment } : {}),
      ...(c.identity ? { identity: c.identity } : {}),
      ...(c.sequence
        ? { sequence: `${c.sequence.name.toLowerCase()}${c.sequence.trigger ? `/${c.sequence.trigger}` : ""}` }
        : {}),
      ...(emptyString ? { emptyString } : {}),
      ...(lengthSemantics ? { lengthSemantics } : {}),
    };
  });
  // NULL dans une clé composée Oracle : égaux entre eux, sauf ligne entièrement NULL (O-39).
  const nullable = (n: string) =>
    !(
      table.primaryKey.some((p) => p.toLowerCase() === n.toLowerCase()) ||
      table.columns.find((c) => c.name.toLowerCase() === n.toLowerCase())?.notNull
    );
  // SQL Server : un seul NULL admis par UNIQUE (NULL égaux entre eux, ligne entièrement NULL comprise).
  const nullsOf = (u: ParsedKey) =>
    u.nullsNotDistinct || (dialect === "sqlserver" && !u.where && !u.nullsDistinct && u.columns.some(nullable))
      ? "not distinct"
      : dialect === "oracle" && u.columns.length > 1 && !u.expression && u.columns.some(nullable)
        ? u.columns.every(nullable)
          ? "oracle"
          : "not distinct"
        : undefined;
  const uniques = [
    ...table.uniques.map((u) => ({
      ...keyOf(u, columnName),
      ...(u.expression ? { expression: unwrap(compact(u.expression).toLowerCase()) } : {}),
      ...(u.where ? { where: canonicalCheck(u.where, context) } : {}),
      ...(nullsOf(u) ? { nulls: nullsOf(u) } : {}),
      ...(stateText(u.state) ? { state: stateText(u.state) } : {}),
    })),
    ...table.columns
      .filter((c) => c.unique)
      .map((c) => ({
        name: c.uniqueName,
        columns: [columnName(c.name)],
        ...(nullsOf({ columns: [c.name] }) ? { nulls: nullsOf({ columns: [c.name] }) } : {}),
      })),
  ];
  const foreignKeys = table.foreignKeys.map((fk) => {
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
  return {
    name: effective(table.name, table.quoted, dialect),
    columns,
    primaryKey: { name: table.primaryKeyName, columns: pk },
    foreignKeys: byText(foreignKeys),
    uniques: byText(uniques),
    checks: byText(
      checks.map((c) => ({
        name: c.name,
        expression: c.canonical ? c.expression : canonicalCheck(c.expression, context),
        ...(stateText(c.state) ? { state: stateText(c.state) } : {}),
      })),
    ),
    indexes: byText(table.indexes.map((i) => keyOf(i, columnName))),
    ...(table.comment ? { comment: table.comment } : {}),
    triggers: table.triggers.map((t) => t.name.toLowerCase()).sort(byCodeUnit),
    ...(stateText(table.primaryKeyState) ? { primaryKeyState: stateText(table.primaryKeyState) } : {}),
    ...(table.storage.length > 0 ? { storage: [...table.storage].sort() } : {}),
    ...(table.partition ? { partition: compact(table.partition).toLowerCase() } : {}),
    ...(sequencesOf(table, sequences).length > 0 ? { sequences: sequencesOf(table, sequences) } : {}),
    ...(schemaName(table.schema) ? { schema: schemaName(table.schema) } : {}),
  };
}
