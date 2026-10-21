import { collationClass, defaultCollationClass } from "../ddl/collation";
import { sqliteAffinity } from "../ddl/dialects";
import {
  asciiDomain,
  type Condition,
  excludesEmptyString,
  impliesNonNegative,
  likeToRegex,
  type Operand,
  parseCondition,
  parseDefault,
  valueBounds,
} from "../ddl/expressions";
import type { DataType } from "../model/datatype";
import type { ConstraintState, ReferentialAction, SequenceDefinition, SqlDialect } from "../model/physical";
import { type NamedExpression, type ParsedColumn, type ParsedKey, type ParsedTable, parseSql } from "../reverse/parse";
import { tokenize } from "../reverse/tokenize";
import { integerRange, sqlTypeToDataType } from "../reverse/types";
import { byCodeUnit } from "./order";

/**
 * Catalogue normalisé d'un script LDD (overrides O-29, O-35) : ce qu'une base créée par ce script
 * contiendrait, indépendamment de la façon de l'écrire (contrainte en ligne ou de table, casse
 * des mots-clés, espaces, parenthèses, dialecte…). Sert aux tests d'aller-retour et au contrôle
 * du rapport de pertes : toute différence entre la source et la cible doit y figurer.
 *
 * Équivalences reconnues des deux côtés (O-35) : ENUM ≡ texte + CHECK (col IN …) ≡ type énuméré ;
 * SET ≡ text[] + CHECK (col <@ ARRAY[…]) ; entiers et décimaux comparés par leur plage (UNSIGNED,
 * CHECK (col >= 0)) ; collation binaire (`*_bin`, `C`) ; préfixe `col(n)` ≡ `left(col, n)` ;
 * FULLTEXT ≡ GIN (to_tsvector) ; DEFAULT NULL ≡ pas de défaut ; 0 / 1 ≡ FALSE / TRUE d'un booléen.
 */

export interface CatalogColumn {
  name: string;
  type: string;
  /** Type conceptuel (JSON), lu selon le dialecte : sert aux comparaisons inter-dialectes. */
  concept: string;
  autoIncrement: boolean;
  notNull: boolean;
  default?: string;
  /** Domaine énuméré : `enum:a|b` ou `set:a|b`. */
  domain?: string;
  /** Plage de valeurs d'un nombre (entiers : bornes ; décimaux : « ≥ 0 » ou non). */
  range?: string;
  /**
   * Classe de comparaison de la collation effective (colonne, sinon table, sinon base) :
   * binary, sensitive, ci, ai_ci, ou le nom d'une collation particulière.
   */
  collation?: string;
  /** Classe appliquée sans collation déclarée, selon le SGBD. */
  defaultCollation?: string;
  /** Affinité SQLite du type déclaré (SQLite ne connaît que ces affinités). */
  affinity: string;
  /** Colonne calculée : `stored` ou `virtual`. */
  generated?: string;
  onUpdate?: string;
  identityStart?: number;
  /** Pas du compteur, s'il diffère de 1 (O-41). */
  identityIncrement?: number;
  comment?: string;
  // O-39
  /** Identité GENERATED ALWAYS / BY DEFAULT ON NULL (absente : BY DEFAULT, auto-incrément). */
  identity?: string;
  /** Séquence qui fournit la valeur par défaut (`nom`, ou `nom/on null`, `nom/always` par déclencheur). */
  sequence?: string;
  /** Chaîne vide : vaut NULL (Oracle, colonne facultative), refusée (NOT NULL Oracle, CHECK), ou valeur. */
  emptyString?: "null" | "rejected" | "value";
  /** Longueur d'un texte : en octets, en caractères, ou selon NLS_LENGTH_SEMANTICS (Oracle). */
  lengthSemantics?: "byte" | "char" | "nls";
}

export interface CatalogKey {
  name?: string;
  columns: string[];
  prefixes?: (number | null)[];
  method?: string;
  kind?: string;
  // O-39
  expression?: string;
  where?: string;
  /** NULL égaux entre eux : `not distinct` ; `oracle` : sauf ligne entièrement NULL (ignorée). */
  nulls?: string;
  state?: string;
}

export interface CatalogForeignKey extends CatalogKey {
  table: string;
  referencedColumns: string[];
  onDelete: ReferentialAction;
  onUpdate: ReferentialAction;
}

export interface CatalogCheck {
  name?: string;
  expression: string;
  state?: string;
}

export interface CatalogTable {
  name: string;
  columns: CatalogColumn[];
  primaryKey: CatalogKey;
  foreignKeys: CatalogForeignKey[];
  uniques: CatalogKey[];
  checks: CatalogCheck[];
  indexes: CatalogKey[];
  comment?: string;
  triggers: string[];
  // O-39
  primaryKeyState?: string;
  storage?: string[];
  partition?: string;
  /** Séquences utilisées par les colonnes de la table. */
  sequences?: string[];
  /** Schéma, hors schéma par défaut (dbo, public) (O-42). */
  schema?: string;
}

export type Catalog = CatalogTable[];

/** État d'une contrainte en texte stable (`undefined` : active, validée, immédiate). */
const stateText = (s?: ConstraintState) => {
  // Le dialecte ne sert qu'au vocabulaire du rapport (O-42).
  const entries = Object.entries(s ?? {}).filter(([k]) => k !== "dialect");
  return entries.length > 0 ? JSON.stringify(Object.fromEntries(entries.sort())) : undefined;
};

/** Nom effectif après repli de casse des identifiants non quotés. */
function effective(name: string, quoted: boolean, dialect: SqlDialect) {
  if (quoted) {
    return name;
  }
  if (dialect === "postgresql") {
    return name.toLowerCase();
  }
  if (dialect === "oracle" || dialect === "db2") {
    return name.toUpperCase();
  }
  return name;
}

const compact = (text: string) =>
  text
    .replace(/\s+/g, " ")
    .replace(/\s*([(),])\s*/g, "$1")
    .trim();

function canonicalOperand(o: Operand): unknown {
  if (o.kind === "length") {
    return { kind: "length", arg: canonicalOperand(o.arg) };
  }
  // Booléen ≡ 0 / 1 (BIT SQL Server, TINYINT(1) MySQL comparés à 0 / 1) (O-41).
  if (o.kind === "boolean") {
    return { kind: "number", value: o.value ? "1" : "0" };
  }
  return o.kind === "column" ? { kind: "column", name: o.name.toLowerCase() } : o;
}

/** Contexte d'une forme canonique : LIKE SQL Server à classes lu comme expression rationnelle (O-42). */
interface CanonicalContext {
  dialect?: SqlDialect;
  /** Colonne sous collation insensible à la casse (déclarée ou par défaut du SGBD). */
  insensitive?: (column: string) => boolean;
}

function canonicalCondition(c: Condition, context: CanonicalContext = {}): unknown {
  const recurse = (x: Condition) => canonicalCondition(x, context);
  switch (c.kind) {
    case "and":
    case "or":
      return { kind: c.kind, items: c.items.map(recurse) };
    case "not":
      return { kind: "not", item: recurse(c.item) };
    case "regex":
      return {
        kind: "regex",
        operand: canonicalOperand(c.operand),
        pattern: c.pattern,
        negated: c.negated,
        insensitive: c.insensitive,
      };
    case "isJson":
      return { kind: "isJson", operand: canonicalOperand(c.operand), negated: c.negated };
    case "compare":
      return { ...c, left: canonicalOperand(c.left), right: canonicalOperand(c.right) };
    case "in":
      return { ...c, operand: canonicalOperand(c.operand), values: c.values.map(canonicalOperand) };
    case "between":
      return {
        ...c,
        operand: canonicalOperand(c.operand),
        low: canonicalOperand(c.low),
        high: canonicalOperand(c.high),
      };
    case "isNull":
      return { ...c, operand: canonicalOperand(c.operand) };
    case "like": {
      // SQL Server : [A-Z] / [^A-Z] sont des classes ≡ expression rationnelle ancrée (O-42).
      const regex =
        context.dialect === "sqlserver" && c.pattern.kind === "string" ? likeToRegex(c.pattern.value) : null;
      if (regex) {
        const column = c.operand.kind === "column" ? c.operand.name : "";
        return {
          kind: "regex",
          operand: canonicalOperand(c.operand),
          pattern: regex,
          negated: c.negated,
          insensitive: Boolean(context.insensitive?.(column)),
        };
      }
      return { ...c, operand: canonicalOperand(c.operand), pattern: canonicalOperand(c.pattern) };
    }
  }
}

/** Forme canonique d'une condition CHECK (structurée si possible, sinon texte compacté). */
export function canonicalCheck(expression: string, context: CanonicalContext = {}): string {
  const condition = parseCondition(expression);
  return condition ? JSON.stringify(canonicalCondition(condition, context)) : compact(expression).toLowerCase();
}

/** Forme canonique d'une valeur par défaut ; `undefined` pour DEFAULT NULL (aucun défaut). */
export function canonicalDefault(expression: string, concept?: DataType): string | undefined {
  const value = parseDefault(expression);
  if (value?.kind === "null") {
    return undefined;
  }
  // Dans une colonne sans fuseau, l'horodatage courant y est converti en heure locale (O-39).
  if (
    value?.kind === "date" &&
    (value.fn === "localtimestamp" || value.fn === "localtimestamp_seconds") &&
    !(concept?.kind === "datetime" && concept.withTimeZone)
  ) {
    return JSON.stringify({ kind: "date", fn: "current_timestamp" });
  }
  if (value?.kind === "number" && concept?.kind === "boolean" && (value.value === "0" || value.value === "1")) {
    return JSON.stringify({ kind: "boolean", value: value.value === "1" });
  }
  // ARRAY['a', 'b']::text[] (SET en tableau) ≡ 'a,b'
  const array = /^ARRAY\s*\[(.*)\]\s*(::\s*text\s*\[\s*\])?$/i.exec(expression.trim());
  if (array) {
    return JSON.stringify({
      kind: "string",
      value: tokenize(array[1]!)
        .filter((t) => t.type === "string")
        .map((t) => t.value)
        .join(","),
    });
  }
  return value ? JSON.stringify(value) : compact(expression);
}

const byText = <T>(list: T[]) => [...list].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));

/** Domaine d'une colonne d'après son type (ENUM / SET MySQL, type énuméré PostgreSQL). */
function typeDomain(column: ParsedColumn, enumTypes: Map<string, string[]>): string | undefined {
  const match = /^\s*(enum|set)\s*\(/i.exec(column.type);
  if (match) {
    return `${match[1]!.toLowerCase()}:${tokenize(column.type)
      .filter((t) => t.type === "string")
      .map((t) => t.value)
      .join("|")}`;
  }
  const named = enumTypes.get(column.type.trim().replace(/^"|"$/g, "").toLowerCase());
  return named ? `enum:${named.join("|")}` : undefined;
}

/**
 * CHECK anonyme qui ne fait qu'exprimer le domaine ou la positivité d'une colonne (forme émise
 * pour ENUM, SET, UNSIGNED) : `col IN (…)`, `col <@ ARRAY[…]`, `col >= 0`.
 */
function domainCheck(
  check: NamedExpression,
): { column: string; domain?: string; nonNegative?: boolean; nonEmpty?: boolean } | null {
  if (check.name) {
    return null;
  }
  const set = /^\s*"?([\w$]+)"?\s*<@\s*ARRAY\s*\[(.*)\]\s*(::\s*text\s*\[\s*\])?\s*$/is.exec(check.expression);
  if (set) {
    return {
      column: set[1]!,
      domain: `set:${tokenize(set[2]!)
        .filter((t) => t.type === "string")
        .map((t) => t.value)
        .join("|")}`,
    };
  }
  const condition = parseCondition(check.expression);
  if (
    condition?.kind === "in" &&
    !condition.negated &&
    condition.operand.kind === "column" &&
    condition.values.every((v) => v.kind === "string")
  ) {
    return {
      column: condition.operand.name,
      domain: `enum:${condition.values.map((v) => (v as { value: string }).value).join("|")}`,
    };
  }
  if (
    condition?.kind === "compare" &&
    condition.op === ">=" &&
    condition.left.kind === "column" &&
    condition.right.kind === "number" &&
    Number(condition.right.value) === 0
  ) {
    return { column: condition.left.name, nonNegative: true };
  }
  // col <> '' : chaîne vide refusée (forme émise pour un texte Oracle NOT NULL) (O-39).
  if (
    condition?.kind === "compare" &&
    condition.op === "<>" &&
    condition.left.kind === "column" &&
    condition.right.kind === "string" &&
    condition.right.value === ""
  ) {
    return { column: condition.left.name, nonEmpty: true };
  }
  return null;
}

/** Plage d'un type numérique : bornes d'un entier, positivité d'un décimal. */
function rangeOf(
  concept: DataType | undefined,
  unsigned: boolean,
  nonNegative: boolean,
  bounds?: [bigint | null, bigint | null],
  digits?: [bigint, bigint],
): string | undefined {
  if (!concept) {
    return undefined;
  }
  const bits =
    concept.kind === "integer" ? concept.bits : concept.kind === "counter" ? (concept.bits ?? 32) : undefined;
  if (bits !== undefined) {
    // Oracle NUMBER(p) : plage décimale ±(10^p − 1) (O-39).
    let max = digits ? digits[1] : unsigned ? 2n ** BigInt(bits) - 1n : 2n ** BigInt(bits - 1) - 1n;
    let min = unsigned || nonNegative ? 0n : digits ? digits[0] : -(2n ** BigInt(bits - 1));
    // Bornes explicites (CHECK … BETWEEN, YEAR) : intersection avec la plage du type.
    if (bounds) {
      if (bounds[0] !== null && bounds[0] > min) {
        min = bounds[0];
      }
      if (bounds[1] !== null && bounds[1] < max) {
        max = bounds[1];
      }
    }
    return `[${min}, ${max}]`;
  }
  if (concept.kind === "decimal" || concept.kind === "real" || concept.kind === "money") {
    return unsigned || nonNegative ? "≥ 0" : "ℝ";
  }
  return undefined;
}

/** Type conceptuel, à la collation, au jeu de caractères et à la largeur des entiers près (comparée par la plage). */
function conceptOf(t: DataType | undefined, domain: string | undefined): string {
  if (domain) {
    return JSON.stringify({ kind: "domain" });
  }
  if (!t) {
    return "null";
  }
  if (t.kind === "text") {
    return JSON.stringify({ ...t, collation: undefined, encoding: t.encoding === "binary" ? "binary" : "char" });
  }
  // Entiers, et décimaux d'échelle nulle (NUMBER(20), NUMERIC(20)) : comparés par leur plage (O-39).
  if (
    t.kind === "integer" ||
    t.kind === "counter" ||
    (t.kind === "decimal" && t.scale === 0 && t.precision !== undefined)
  ) {
    return JSON.stringify({ kind: "integer" });
  }
  // MONEY ≡ DECIMAL(19,4) (O-42).
  if (t.kind === "money") {
    return JSON.stringify({ kind: "decimal", precision: 19, scale: 4 });
  }
  if (t.kind === "free" && /^jsonb?$/i.test(t.sql.trim())) {
    return JSON.stringify({ kind: "free", sql: "json" });
  }
  // UNIQUEIDENTIFIER (SQL Server) ≡ UUID (O-41).
  if (t.kind === "free" && /^(uuid|uniqueidentifier)$/i.test(t.sql.trim())) {
    return JSON.stringify({ kind: "free", sql: "uuid" });
  }
  return JSON.stringify(t);
}

/** Classe de collation effective d'une colonne de texte, et celle que le SGBD applique par défaut. */
function collationOf(
  c: ParsedColumn,
  table: ParsedTable,
  database: { collation?: string; collations: Map<string, Record<string, string>> },
  concept: DataType | undefined,
  domain: string | undefined,
  dialect: SqlDialect,
): { collation?: string; defaultCollation?: string } {
  const textual = Boolean(domain) || (concept?.kind === "text" && concept.encoding !== "binary");
  if (!textual) {
    return {};
  }
  const name = c.collation ?? table.collation ?? database.collation;
  const klass = name ? collationClass(name, database.collations) : undefined;
  return {
    ...(klass ? { collation: klass === "other" ? name!.toLowerCase() : klass } : {}),
    ...(defaultCollationClass(dialect) ? { defaultCollation: defaultCollationClass(dialect) } : {}),
  };
}

const keyOf = (key: ParsedKey, columnName: (n: string) => string): CatalogKey => ({
  name: key.name,
  columns: key.columns.map(columnName),
  ...(key.prefixes ? { prefixes: key.prefixes } : {}),
  ...(key.method && key.method !== "btree" ? { method: key.method } : {}),
  ...(key.kind ? { kind: key.kind } : {}),
});

function tableCatalog(
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

/** Schéma hors schéma par défaut : dbo (SQL Server) et public (PostgreSQL) se valent (O-42). */
const schemaName = (schema?: string) =>
  schema && !["dbo", "public"].includes(schema.toLowerCase()) ? schema.toLowerCase() : undefined;

/** Expression sans ses parenthèses englobantes : ((lower(email))) ≡ lower(email) (MySQL). */
function unwrap(text: string): string {
  while (text.startsWith("(") && text.endsWith(")")) {
    let depth = 0;
    const inner = [...text.slice(1, -1)].every((ch) => {
      depth += ch === "(" ? 1 : ch === ")" ? -1 : 0;
      return depth >= 0;
    });
    if (!inner || depth !== 0) {
      break;
    }
    text = text.slice(1, -1);
  }
  return text;
}

/** Séquences utilisées par les colonnes d'une table, en texte stable (O-39). */
function sequencesOf(table: ParsedTable, sequences: Map<string, SequenceDefinition>): string[] {
  return table.columns
    .map((c) => c.sequence && sequences.get(c.sequence.name.toLowerCase()))
    .filter((s): s is SequenceDefinition => Boolean(s))
    .map(({ name, start, increment, min, max, cache, cycle, type, schema }) =>
      JSON.stringify({
        name: name.toLowerCase(),
        schema: schemaName(schema),
        start,
        increment,
        min,
        max,
        cache,
        cycle: cycle ?? false,
        type: type && ({ int: "integer" } as Record<string, string>)[type] ? "integer" : type,
      }),
    );
}

/** Longueur d'un texte en octets, en caractères, ou selon NLS_LENGTH_SEMANTICS (Oracle) (O-39). */
function lengthSemanticsOf(type: string, dialect: SqlDialect): "byte" | "char" | "nls" {
  if (dialect !== "oracle") {
    return "char";
  }
  if (/\bbyte\s*\)/i.test(type)) {
    return "byte";
  }
  if (/\bchar\s*\)/i.test(type) || /^\s*n(var)?char/i.test(type)) {
    return "char";
  }
  return "nls";
}

export function catalogOf(sql: string, dialect: SqlDialect): Catalog {
  const schema = parseSql(sql, dialect);
  const tables = new Map(schema.tables.map((t) => [t.name.toLowerCase(), t]));
  const database = { collation: schema.defaultCollation, collations: schema.collations };
  const catalog = schema.tables
    .map((t) => tableCatalog(t, tables, dialect, schema.enumTypes, database, schema.sequences))
    .sort((a, b) => a.name.localeCompare(b.name));
  propagateForeignRanges(catalog);
  return catalog;
}

/**
 * Une colonne de clé étrangère ne prend que des valeurs de la colonne référencée : elle en hérite
 * la borne basse (ex. FK vers un identifiant non négatif) (O-37).
 */
function propagateForeignRanges(catalog: Catalog) {
  const parse = (range?: string) =>
    range?.startsWith("[")
      ? range
          .slice(1, -1)
          .split(", ")
          .map((x) => BigInt(x))
      : null;
  for (let changed = true, pass = 0; changed && pass < 10; pass += 1) {
    changed = false;
    for (const table of catalog) {
      for (const fk of table.foreignKeys) {
        const target = catalog.find((t) => t.name.toLowerCase() === fk.table.toLowerCase());
        fk.columns.forEach((name, i) => {
          const column = table.columns.find((c) => c.name.toLowerCase() === name.toLowerCase());
          const referenced = target?.columns.find(
            (c) => c.name.toLowerCase() === fk.referencedColumns[i]?.toLowerCase(),
          );
          const own = parse(column?.range);
          const ref = parse(referenced?.range);
          if (!(column && own && ref) || own[0]! >= ref[0]!) {
            return;
          }
          column.range = `[${ref[0]}, ${own[1]}]`;
          changed = true;
        });
      }
    }
  }
}

/** Colonnes référencées par une colonne de clé étrangère, de proche en proche (O-40). */
function referencesOf(catalog: Catalog, table: CatalogTable, column: string): { table: string; column: string }[] {
  const result: { table: string; column: string }[] = [];
  const queue: { table: CatalogTable; column: string }[] = [{ table, column }];
  const seen = new Set([`${table.name}.${column}`.toLowerCase()]);
  while (queue.length > 0) {
    const { table: t, column: c } = queue.shift()!;
    for (const fk of t.foreignKeys) {
      const index = fk.columns.findIndex((x) => x.toLowerCase() === c.toLowerCase());
      const next = index >= 0 ? catalog.find((x) => x.name.toLowerCase() === fk.table.toLowerCase()) : undefined;
      if (!next) {
        continue;
      }
      const referenced = fk.referencedColumns[index]!;
      const key = `${next.name}.${referenced}`.toLowerCase();
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      result.push({ table: next.name, column: referenced });
      queue.push({ table: next, column: referenced });
    }
  }
  return result;
}

/** Plage cible acceptable : même borne basse, borne haute au moins aussi grande (type élargi). */
function rangeCovers(source?: string, target?: string): boolean {
  if (source === target) {
    return true;
  }
  if (!(source?.startsWith("[") && target?.startsWith("["))) {
    return false;
  }
  const [smin, smax] = source
    .slice(1, -1)
    .split(", ")
    .map((x) => BigInt(x));
  const [tmin, tmax] = target
    .slice(1, -1)
    .split(", ")
    .map((x) => BigInt(x));
  return smin === tmin && tmax! >= smax!;
}

// ---------------------------------------------------------------------------------------------
// Différences

export type DifferenceCategory =
  | "table"
  | "column"
  | "columnOrder"
  | "type"
  | "autoIncrement"
  | "notNull"
  | "default"
  | "primaryKey"
  | "foreignKey"
  | "action"
  | "unique"
  | "check"
  | "index"
  | "name"
  | "domain"
  | "range"
  | "collation"
  | "generated"
  | "onUpdate"
  | "comment"
  | "trigger"
  // O-39
  | "state"
  | "physical"
  | "sequence"
  | "emptyString";

export interface Difference {
  category: DifferenceCategory;
  table: string;
  column?: string;
  detail: string;
  /**
   * Colonne de clé étrangère : colonnes référencées, de proche en proche. Un écart de type ou de
   * plage y découle de la clé référencée, dont l'entrée du rapport le justifie (O-40).
   */
  references?: { table: string; column: string }[];
}

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const sameList = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => same(x, b[i]!));
const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.some((y) => same(x, y)));
const sameKey = (a: CatalogKey, b: CatalogKey) =>
  sameSet(a.columns, b.columns) &&
  JSON.stringify(a.prefixes ?? null) === JSON.stringify(b.prefixes ?? null) &&
  (a.kind ?? "") === (b.kind ?? "") &&
  (a.expression ?? "") === (b.expression ?? "") &&
  (a.where ?? "") === (b.where ?? "");

/**
 * Différences entre deux catalogues. `crossDialect` : les types sont comparés selon leur type
 * conceptuel, les noms sans tenir compte de la casse (le repli de casse diffère d'un SGBD à l'autre).
 */
export function diffCatalogs(
  source: Catalog,
  target: Catalog,
  crossDialect = false,
  targetDialect?: SqlDialect,
): Difference[] {
  const diffs: Difference[] = [];
  // SQLite : seule l'affinité du type compte (ni longueur, ni plage, ni booléen).
  const affinityOnly = targetDialect === "sqlite";
  const name = (a: string, b: string) => (crossDialect ? same(a, b) : a === b);
  for (const s of source) {
    const t = target.find((x) => name(x.name, s.name));
    if (!t) {
      diffs.push({ category: "table", table: s.name, detail: "absente" });
      continue;
    }
    const push = (category: DifferenceCategory, detail: string, column?: string) => {
      const references = column && (category === "type" || category === "range") ? referencesOf(source, s, column) : [];
      diffs.push({ category, table: s.name, column, detail, ...(references.length > 0 ? { references } : {}) });
    };
    const tColumns = t.columns.filter((c) => s.columns.some((x) => name(x.name, c.name)));
    if (
      !sameList(
        s.columns.map((c) => c.name),
        tColumns.map((c) => c.name),
      )
    ) {
      push("columnOrder", "ordre des colonnes");
    }
    for (const c of s.columns) {
      const d = t.columns.find((x) => name(x.name, c.name));
      if (!d) {
        push("column", "absente", c.name);
        continue;
      }
      // Colonne calculée sans type déclaré (SQL Server) : son type découle de l'expression (O-41).
      const typeless = Boolean(c.generated) && c.concept === "null";
      const typeOk =
        typeless ||
        (affinityOnly
          ? c.affinity === d.affinity || Boolean(c.domain && d.domain)
          : crossDialect
            ? c.concept === d.concept
            : c.type === d.type);
      if (!typeOk) {
        push("type", `${c.type} → ${d.type}`, c.name);
      }
      if (c.autoIncrement !== d.autoIncrement && !(crossDialect && /serial|identity/i.test(d.type))) {
        push("autoIncrement", `${c.autoIncrement} → ${d.autoIncrement}`, c.name);
      }
      if (c.notNull !== d.notNull) {
        push("notNull", `${c.notNull} → ${d.notNull}`, c.name);
      }
      if (c.default !== d.default) {
        push("default", `${c.default} → ${d.default}`, c.name);
      }
      if (c.domain !== d.domain) {
        push("domain", `${c.domain} → ${d.domain}`, c.name);
      }
      if (crossDialect && !affinityOnly && !typeless && !rangeCovers(c.range, d.range)) {
        push("range", `${c.range} → ${d.range}`, c.name);
      }
      // Collation : comparée quand la source en a une effective (sinon : celle de l'installation, inconnue).
      if (c.collation && c.collation !== (d.collation ?? d.defaultCollation)) {
        push("collation", `${c.collation} → ${d.collation ?? d.defaultCollation}`, c.name);
      }
      if (c.generated !== d.generated) {
        push("generated", `${c.generated} → ${d.generated}`, c.name);
      }
      if (c.onUpdate !== d.onUpdate) {
        push("onUpdate", `${c.onUpdate} → ${d.onUpdate}`, c.name);
      }
      if (c.identityStart !== d.identityStart) {
        push("autoIncrement", `début ${c.identityStart} → ${d.identityStart}`, c.name);
      }
      if (c.identityIncrement !== d.identityIncrement) {
        push("autoIncrement", `pas ${c.identityIncrement} → ${d.identityIncrement}`, c.name);
      }
      if ((c.comment ?? "") !== (d.comment ?? "")) {
        push("comment", `${c.comment} → ${d.comment}`, c.name);
      }
      if (c.identity !== d.identity) {
        push("autoIncrement", `identité ${c.identity ?? "by default"} → ${d.identity ?? "by default"}`, c.name);
      }
      if (c.sequence !== d.sequence) {
        push("sequence", `séquence ${c.sequence} → ${d.sequence}`, c.name);
      }
      if (c.emptyString && d.emptyString && c.emptyString !== d.emptyString) {
        push("emptyString", `'' ${c.emptyString} → ${d.emptyString}`, c.name);
      }
      if (c.lengthSemantics && d.lengthSemantics && c.lengthSemantics !== d.lengthSemantics) {
        push("type", `longueur ${c.lengthSemantics} → ${d.lengthSemantics}`, c.name);
      }
    }
    if (s.primaryKeyState !== t.primaryKeyState) {
      push("state", `PK ${s.primaryKeyState} → ${t.primaryKeyState}`);
    }
    if (s.schema !== t.schema) {
      push("name", `schéma ${s.schema} → ${t.schema}`);
    }
    if (JSON.stringify(s.storage ?? []) !== JSON.stringify(t.storage ?? [])) {
      push("physical", `stockage ${s.storage} → ${t.storage}`);
    }
    if ((s.partition ?? "") !== (t.partition ?? "")) {
      push("physical", `partitionnement ${s.partition} → ${t.partition}`);
    }
    if (JSON.stringify(s.sequences ?? []) !== JSON.stringify(t.sequences ?? [])) {
      push("sequence", `séquences ${s.sequences} → ${t.sequences}`);
    }
    for (const c of t.columns) {
      if (!s.columns.some((x) => name(x.name, c.name))) {
        push("column", "en trop", c.name);
      }
    }
    if ((s.comment ?? "") !== (t.comment ?? "")) {
      push("comment", "commentaire de table");
    }
    for (const trigger of s.triggers) {
      if (!t.triggers.includes(trigger)) {
        push("trigger", `déclencheur ${trigger} absent`);
      }
    }
    if (!sameList(s.primaryKey.columns, t.primaryKey.columns)) {
      push("primaryKey", `${s.primaryKey.columns} → ${t.primaryKey.columns}`);
    } else if (s.primaryKey.name && !name(s.primaryKey.name, t.primaryKey.name ?? "")) {
      push("name", `PK ${s.primaryKey.name} → ${t.primaryKey.name}`);
    }

    for (const fk of s.foreignKeys) {
      const match = t.foreignKeys.find(
        (x) =>
          sameList(x.columns, fk.columns) &&
          same(x.table, fk.table) &&
          sameList(x.referencedColumns, fk.referencedColumns),
      );
      if (!match) {
        push("foreignKey", `FK (${fk.columns}) → ${fk.table}(${fk.referencedColumns}) absente`);
        continue;
      }
      const columns = fk.columns.join(", ");
      if (match.onDelete !== fk.onDelete) {
        push("action", `ON DELETE ${fk.onDelete} → ${match.onDelete}`, columns);
      }
      if (match.onUpdate !== fk.onUpdate) {
        push("action", `ON UPDATE ${fk.onUpdate} → ${match.onUpdate}`, columns);
      }
      if (fk.name && !name(fk.name, match.name ?? "")) {
        push("name", `FK ${fk.name} → ${match.name}`);
      }
      if (fk.state !== match.state) {
        push("state", `FK ${fk.name ?? columns} ${fk.state} → ${match.state}`);
      }
    }
    if (t.foreignKeys.length !== s.foreignKeys.length) {
      push("foreignKey", `${s.foreignKeys.length} → ${t.foreignKeys.length} clés étrangères`);
    }

    for (const u of s.uniques) {
      const match = t.uniques.find((x) => sameKey(x, u));
      if (match) {
        if (u.name && !name(u.name, match.name ?? "")) {
          push("name", `UNIQUE ${u.name} → ${match.name}`);
        }
        if ((u.method ?? "") !== (match.method ?? "")) {
          push("index", `méthode ${u.method} → ${match.method}`);
        }
        if (u.nulls !== match.nulls) {
          push("unique", `UNIQUE ${u.name ?? u.columns} NULL ${u.nulls} → ${match.nulls}`);
        }
        if (u.state !== match.state) {
          push("state", `UNIQUE ${u.name ?? u.columns} ${u.state} → ${match.state}`);
        }
      } else {
        push("unique", `UNIQUE (${u.columns}) absent`);
      }
    }
    for (const u of t.uniques) {
      if (!s.uniques.some((x) => sameKey(x, u))) {
        push("unique", `UNIQUE (${u.columns}) en trop`);
      }
    }

    for (const c of s.checks) {
      const match = t.checks.find((x) => x.expression === c.expression);
      if (match) {
        if (c.name && !name(c.name, match.name ?? "")) {
          push("name", `CHECK ${c.name} → ${match.name}`);
        }
        if (c.state !== match.state) {
          push("state", `CHECK ${c.name ?? c.expression} ${c.state} → ${match.state}`);
        }
      } else {
        push("check", `CHECK ${c.expression} absent ou modifié`);
      }
    }
    for (const c of t.checks) {
      if (!s.checks.some((x) => x.expression === c.expression)) {
        push("check", `CHECK ${c.expression} en trop`);
      }
    }

    for (const i of s.indexes) {
      const match = t.indexes.find((x) => sameKey(x, i) && sameList(x.columns, i.columns));
      if (match) {
        if (i.name && !name(i.name, match.name ?? "")) {
          push("name", `index ${i.name} → ${match.name}`);
        }
        if ((i.method ?? "") !== (match.method ?? "")) {
          push("index", `méthode ${i.method} → ${match.method}`);
        }
      } else {
        push("index", `index (${i.columns}) absent`);
      }
    }
    if (t.indexes.length !== s.indexes.length) {
      push("index", `${s.indexes.length} → ${t.indexes.length} index`);
    }
  }
  for (const t of target) {
    if (!source.some((s) => name(s.name, t.name))) {
      diffs.push({ category: "table", table: t.name, detail: "en trop" });
    }
  }
  return diffs;
}
