import { DBMS_LIST, type Dbms } from "../dbms/dbms";
import { sqlType } from "../dbms/typeMapping";
import { GENERIC_VERSION, isAtLeast } from "../dbms/versions";
import { hasErrors, type LogicalColumn, type LogicalForeignKey, type LogicalKey, type LogicalModel, type LogicalTable } from "../mld/logical";
import type { DataType } from "../model/datatype";
import type { CheckConstraint, ConstraintState, SequenceDefinition, SqlDialect } from "../model/physical";
import type { DdlOptions } from "../model/settings";
import { integerRange, sqlTypeToDataType } from "../reverse/types";
import { MSG } from "../validation/messages";
import {
  enforcesCheck,
  fitName,
  maxIdentifierLength,
  quoteIdentifier,
  referentialAction,
  sqliteAffinity,
  supportsAlterForeignKey,
  type Target,
} from "./dialects";
import { collationClass, translateCollation } from "./collation";
import {
  asciiDomain,
  excludesEmptyString,
  impliesNonNegative,
  likeToRegex,
  type Condition,
  type Operand,
  parseCondition,
  parseDefault,
  referencedColumns,
  renderCondition,
  renderOperand,
  typeConflict,
  valueBounds,
  type TypeFamily,
} from "./expressions";
import { translateGenerated } from "./generatedExpression";
import { groupLosses, formatLossGroup, LossReport, type Loss, type LossCategory } from "./losses";

export { formatLossGroup, groupLosses, type Loss, type LossCategory, type LossGroup } from "./losses";

/**
 * Script LDD (override O-29).
 *
 *  - Tables triées selon leurs clés étrangères ; une clé étrangère qui ferme un cycle (hors
 *    réflexive) est ajoutée en fin de script par ALTER TABLE (ou toutes, en option).
 *  - Annotations physiques réappliquées quand la cible le permet : types et défauts d'origine,
 *    CHECK, identifiants alternatifs (UNIQUE), index, noms de contraintes, actions référentielles,
 *    identifiants entre guillemets (casse significative, caractères spéciaux, mots réservés).
 *  - Tout ce que la cible ne sait pas exprimer est abandonné ou dégradé, jamais en silence :
 *    rapport de pertes en tête de script et sous forme structurée (`losses`).
 */

export type DdlResult = { ok: true; sql: string; losses: Loss[] } | { ok: false; error: string };

export interface SqlTarget extends Target {}

const INDENT = "   ";
const DEFAULT_OPTIONS: Pick<
  DdlOptions,
  "foreignKeysInAlter" | "indexes" | "constraintNaming" | "unsigned" | "enums" | "sets" | "collations" | "oracleDates" | "emptyStrings" | "strictRanges" | "spatial" | "sqlServerCollation" | "dboSchema"
> = {
  foreignKeysInAlter: false,
  indexes: true,
  constraintNaming: "none",
  unsigned: "widen",
  enums: "check",
  sets: "array",
  collations: "icu",
  oracleDates: "timestamp",
  emptyStrings: "check",
  strictRanges: false,
  spatial: "postgis",
  sqlServerCollation: "ci_as",
  dboSchema: "public",
};

/** Même dialecte : l'expression ou le type d'origine peut être réémis tel quel. */
export function sameDialect(source: SqlDialect | undefined, target: Dbms) {
  if (!source) return false;
  const family = (d: SqlDialect) => (d === "mariadb" ? "mysql" : d);
  return family(source) === family(target);
}

/**
 * Type affiché dans le MPD (O-59) : celui que le script émet le plus souvent — type de la colonne pour
 * ce dialecte (« type d'origine »), sinon type redéfini du SGBD personnalisé, sinon type du SGBD.
 * Les conversions fines du script (domaines, non-signés…) n'y figurent pas.
 */
export function displayedSqlType(column: Pick<LogicalColumn, "type" | "sourceType">, target: Target): string | null {
  if (column.sourceType && sameDialect(column.sourceType.dialect, target.dbms) && column.type?.kind !== "counter") return column.sourceType.sql;
  return column.type ? sqlType(column.type, target.dbms, target.version, target.custom?.types) : null;
}

/**
 * Deux types équivalents pour le catalogue : ni la collation ni le jeu de caractères (ASCII ou
 * Unicode, propriété de la base plus que de la colonne) ne sont une perte de structure.
 */
function sameType(a: DataType | undefined, b: DataType | undefined) {
  // MONEY ≡ DECIMAL(19,4) (O-42).
  const strip = (t: DataType | undefined) =>
    t && t.kind === "text"
      ? { ...t, collation: undefined, encoding: t.encoding === "binary" ? "binary" : "char" }
      : t?.kind === "money"
        ? { kind: "decimal", precision: 19, scale: 4 }
        : t;
  return JSON.stringify(strip(a)) === JSON.stringify(strip(b));
}

/**
 * Tables triées selon les dépendances, de façon stable : à chaque étape, la première table (dans
 * l'ordre du modèle) dont toutes les tables référencées sont déjà créées. En cas de cycle, la
 * première table restante est créée quand même et ses références en avant sont différées
 * (ALTER TABLE en fin de script) — c'est ce qu'un script écrit à la main fait d'ordinaire.
 */
export function planOrder(tables: LogicalTable[], allInAlter: boolean): { order: LogicalTable[]; deferred: Set<LogicalForeignKey> } {
  const byName = new Map(tables.map((t) => [t.name.toLowerCase(), t]));
  const order: LogicalTable[] = [];
  const created = new Set<LogicalTable>();
  const deferred = new Set<LogicalForeignKey>(allInAlter ? tables.flatMap((t) => t.foreignKeys) : []);
  const pending = (table: LogicalTable) =>
    table.foreignKeys.filter((fk) => {
      const referenced = byName.get(fk.referencedTable.toLowerCase());
      return referenced && referenced !== table && !created.has(referenced);
    });
  while (order.length < tables.length) {
    const remaining = tables.filter((t) => !created.has(t));
    const next = remaining.find((t) => pending(t).length === 0) ?? remaining[0]!;
    pending(next).forEach((fk) => deferred.add(fk));
    created.add(next);
    order.push(next);
  }
  return { order, deferred };
}

/** Compatibilité : ordre des tables seul. */
export const orderByDependencies = (tables: LogicalTable[]) => planOrder(tables, false).order;

class Generator {
  readonly report = new LossReport();
  /** Instructions avant les tables (types énumérés) et après (index sur expression, commentaires, déclencheurs). */
  private readonly preamble: string[] = [];
  private readonly epilogue: string[] = [];
  /** Options de fin de CREATE TABLE (MySQL : AUTO_INCREMENT = n). */
  private readonly tableOptions = new Map<LogicalTable, string>();
  private readonly usedNames = new Set<string>();
  private readonly maxName: number;
  private readonly naming: DdlOptions["constraintNaming"];

  constructor(
    readonly target: Target,
    private readonly options: typeof DEFAULT_OPTIONS,
  ) {
    this.maxName = maxIdentifierLength(target);
    this.naming = options.constraintNaming;
  }

  loss(category: LossCategory, table: string, message: string, column?: string, priority?: "P0") {
    this.report.add(category, table, message, column, priority);
  }

  q(name: string, caseSensitive = false) {
    return quoteIdentifier(this.target, name, caseSensitive);
  }

  columnRef(table: LogicalTable, name: string) {
    const column = table.columns.find((c) => c.name === name);
    return this.q(name, column?.caseSensitive);
  }

  tableRef(tables: LogicalTable[], name: string) {
    const table = tables.find((t) => t.name === name);
    return table ? this.tableName(table) : this.q(name);
  }

  /** Schéma de la cible pour un schéma source (dbo → public, selon l'option) ; `undefined` : schéma par défaut (O-42). */
  schemaOf(schema: string | undefined): string | undefined {
    if (!schema) return undefined;
    const { dbms } = this.target;
    if (!["postgresql", "sqlserver", "db2"].includes(dbms)) return undefined;
    if (schema.toLowerCase() === "dbo") return dbms === "sqlserver" || this.options.dboSchema === "dbo" ? "dbo" : undefined;
    if (dbms === "postgresql" && schema.toLowerCase() === "public") return undefined;
    return schema;
  }

  /** Nom de table qualifié par son schéma, s'il y en a un (ref.aeroport) (O-42). */
  tableName(table: LogicalTable): string {
    const schema = this.schemaOf(table.schema);
    return `${schema ? `${this.q(schema)}.` : ""}${this.q(table.name, table.caseSensitive)}`;
  }

  /** Nom de contrainte : explicite (raccourci si besoin), ou généré selon l'option, ou aucun. */
  constraintName(table: LogicalTable, explicit: string | undefined, kind: "PK" | "FK" | "AK" | "CK" | "IX", parts: string[], required = false): string | undefined {
    let name = explicit;
    if (!name && (this.naming !== "none" || required)) {
      const base = [table.name, ...parts].join("_");
      name = this.naming === "suffix" ? `${base}_${kind}` : `${kind}_${base}`;
      if (kind === "IX" && this.naming === "none") name = `idx_${base}`;
      let unique = name;
      for (let i = 2; this.usedNames.has(unique.toLowerCase()); i++) unique = `${name}_${i}`;
      name = unique;
    }
    if (!name) return undefined;
    const fitted = fitName(name, this.maxName);
    if (fitted !== name && explicit) this.loss("name", table.name, MSG.lossName(name, fitted, this.maxName));
    this.usedNames.add(fitted.toLowerCase());
    return fitted;
  }

  // -------------------------------------------------------------------------------------------
  // Colonnes

  /**
   * Type de la colonne pour la cible, et CHECK qu'il implique (domaine ENUM / SET, non-signé).
   * Chaque écart avec la source est signalé une fois, avec ce qui est réellement émis (O-35).
   */
  typeOf(table: LogicalTable, column: LogicalColumn, inlinePrimaryKey: boolean): { sql: string | null; checks: string[] } {
    const { dbms, version } = this.target;
    const checks: string[] = [];
    const mysql = dbms === "mysql" || dbms === "mariadb";
    const ref = () => this.columnRef(table, column.name);
    const source = column.sourceType;
    const same = Boolean(source && sameDialect(source.dialect, dbms));
    const type = column.type && column.type.kind === "text" ? { ...column.type, collation: undefined } : column.type;
    const collate = this.collationClause(table, column, same ? source?.dialect : column.sourceType?.dialect);

    // Type d'origine, réémis tel quel vers le même dialecte (UNSIGNED, ENUM, SET, YEAR compris).
    if (same && type?.kind !== "counter") return { sql: source!.sql + collate, checks };
    if (!type) return { sql: null, checks };

    // Domaine énuméré (O-35) : le domaine Merise, exprimé selon la cible.
    const domain = column.domain;
    if (domain) {
      const list = domain.values.map((v) => `'${v.replaceAll("'", "''")}'`).join(", ");
      if (mysql) return { sql: `${domain.kind.toUpperCase()}(${list})${collate}`, checks };
      if (domain.kind === "enum") {
        if (dbms === "postgresql" && this.options.enums === "type") return { sql: this.enumType(table, column, list), checks };
        checks.push(`${ref()} IN (${list})`);
        // MySQL ramène une valeur saisie dans une autre casse (ACTIF) à la valeur de l'ENUM (actif) (O-38).
        const klass = column.type?.kind === "text" && column.type.collation ? collationClass(column.type.collation) : undefined;
        if (klass === "ci" || klass === "ai_ci") {
          const insensitive = collate.trim() !== "" && this.options.collations !== "deterministic";
          this.loss("domain", table.name, MSG.lossEnumCase(insensitive), column.name);
        }
      } else if (dbms === "postgresql" && this.options.sets === "array") {
        checks.push(`${ref()} <@ ARRAY[${list}]::text[]`);
        // MySQL ordonne les membres d'un SET et en retire les doublons ; un tableau les garde (O-38).
        this.loss("domain", table.name, MSG.lossSetArray(), column.name);
        return { sql: `TEXT[]${collate}`, checks };
      } else {
        this.loss("domain", table.name, MSG.lossSet(domain.values.join(", ")), column.name);
      }
    }

    // Non signé (O-35) : MySQL l'exprime ; ailleurs, type élargi ou CHECK (>= 0), selon l'option.
    let effective: DataType = type;
    if (column.unsigned && !mysql) {
      if (type.kind === "decimal" || type.kind === "real" || type.kind === "money") checks.push(`${ref()} >= 0`);
      else if ((type.kind === "integer" || type.kind === "counter") && this.options.unsigned === "check") {
        checks.push(`${ref()} >= 0`);
        // Clé étrangère : sa plage découle de la clé référencée, qui seule porte l'entrée (O-40).
        if (!column.foreign) this.loss("unsigned", table.name, MSG.lossUnsignedCheck(source?.sql ?? describe(type)), column.name);
      } else if (type.kind === "integer" || type.kind === "counter") {
        // Type élargi : plage couverte. Les négatifs restent interdits par un CHECK (>= 0), sauf
        // sur une clé étrangère (bornée par la colonne référencée) ou si un CHECK les exclut déjà (O-37).
        // TINYINT SQL Server : 0 à 255, toujours rétabli par un CHECK, même si un autre CHECK existe (O-42).
        if (!column.foreign && source?.dialect === "sqlserver" && /^\s*tinyint\b/i.test(source.sql)) checks.push(`${ref()} BETWEEN 0 AND 255`);
        else if (!column.foreign && !this.alreadyNonNegative(table, column)) checks.push(`${ref()} >= 0`);
        const bits = type.kind === "integer" ? type.bits : (type.bits ?? 32);
        effective =
          bits >= 64
            ? type.kind === "counter"
              ? { kind: "counter", bits: 64 }
              : { kind: "decimal", precision: 20, scale: 0 }
            : type.kind === "counter"
              ? { kind: "counter", bits: 64 }
              : { kind: "integer", bits: (bits * 2) as 16 | 32 | 64 };
      }
    }

    // Oracle DATE (date et heure à la seconde) : TIMESTAMP(0), ou DATE en option — heure perdue (O-39).
    if (source?.dialect === "oracle" && /^date$/i.test(source.sql.trim()) && effective.kind === "datetime" && this.options.oracleDates === "date") {
      const sql = sqlType({ kind: "date" }, dbms, version, this.target.custom?.types) ?? "DATE";
      this.loss("type", table.name, MSG.lossOracleDate(sql), column.name);
      return { sql, checks };
    }

    if (effective.kind === "counter") {
      let sql = sqlType(effective, dbms, version, this.target.custom?.types) ?? "INTEGER";
      // Oracle vers Oracle : le type d'origine du compteur (NUMBER(10)) est conservé (O-39).
      if (same && dbms === "oracle" && /^NUMBER\(\d+\)/.test(sql) && /^number\s*(\(\s*\d+\s*\))?$/i.test(source!.sql.trim())) sql = sql.replace(/^NUMBER\(\d+\)/, source!.sql.trim());
      // Sans IDENTITY / SERIAL… (SQLite hors clé primaire simple, Oracle avant 12c) : simple entier.
      const native = /identity|serial|auto_?increment|counter/i.test(sql) || inlinePrimaryKey;
      if (!native) this.loss("autoIncrement", table.name, MSG.lossAutoIncrement(), column.name);
      if (dbms === "access" && effective.bits === 64) this.loss("type", table.name, MSG.lossType("BIGINT AUTOINCREMENT", "COUNTER"), column.name);
      sql = this.identityStart(table, column, sql);
      if (mysql && column.unsigned) sql = sql.replace(/^(\w+)/, "$1 UNSIGNED");
      // GENERATED ALWAYS / BY DEFAULT ON NULL (O-39). MySQL : un NULL reçoit déjà une valeur.
      if (column.identity === "always") {
        // SQL Server : IDENTITY refuse déjà une valeur fournie (O-42).
        if (/BY DEFAULT AS IDENTITY/i.test(sql)) sql = sql.replace(/BY DEFAULT AS IDENTITY/i, "ALWAYS AS IDENTITY");
        else if (dbms !== "sqlserver") this.loss("autoIncrement", table.name, MSG.lossIdentityAlways(), column.name);
      } else if (dbms === "sqlserver" && /IDENTITY/i.test(sql) && source && !same) {
        // Vers SQL Server : IDENTITY refuse une valeur fournie, que la source acceptait (O-42).
        this.loss("autoIncrement", table.name, MSG.lossSqlServerIdentity(), column.name);
      } else if (column.identity === "on null" && !mysql) {
        if (dbms === "oracle" && /BY DEFAULT AS IDENTITY/i.test(sql)) sql = sql.replace(/BY DEFAULT AS IDENTITY/i, "BY DEFAULT ON NULL AS IDENTITY");
        else this.loss("autoIncrement", table.name, MSG.lossIdentityOnNull(), column.name);
      }
      if (/^\s*number\b/i.test(source?.sql ?? "") || /^NUMBER\(/i.test(sql)) this.integerLosses(table, column, sql, checks);
      return { sql, checks };
    }

    // Décimal (O-39) : sans précision (Oracle NUMBER, NUMERIC), échelle négative (NUMBER(12,-3)).
    if (effective.kind === "decimal") {
      if (effective.precision === undefined && dbms === "db2") return { sql: "DECFLOAT(34)", checks };
      if (effective.precision === undefined && !["postgresql", "oracle", "sqlite"].includes(dbms)) {
        const bounded = sqlType({ kind: "decimal", precision: mysql ? 65 : 38, scale: mysql ? 30 : 10 }, dbms, version, this.target.custom?.types) ?? "DECIMAL(38,10)";
        this.loss("type", table.name, MSG.lossDecimalUnbounded(source?.sql ?? "NUMERIC", bounded), column.name);
        return { sql: bounded, checks };
      }
      if (effective.scale < 0 && !(dbms === "oracle" || (dbms === "postgresql" && isAtLeast("postgresql", version, "15")))) {
        const widened = sqlType({ kind: "decimal", precision: (effective.precision ?? 38) - effective.scale, scale: 0 }, dbms, version, this.target.custom?.types) ?? "NUMERIC";
        this.loss("type", table.name, MSG.lossNegativeScale(source?.sql ?? describe(effective), widened), column.name);
        return { sql: widened, checks };
      }
    }

    // Type libre venu d'un autre dialecte : équivalents connus, sinon texte.
    if (effective.kind === "free" && source) {
      const fallback = freeTypeFallback(effective.sql, this.target);
      if (fallback.loss) this.loss("type", table.name, fallback.loss, column.name);
      else if (fallback.lossy) this.loss("type", table.name, MSG.lossType(effective.sql, fallback.sql), column.name);
      // RAW(16) DEFAULT SYS_GUID() lu comme UUID (O-39) : approximation.
      if (source.dialect === "oracle" && /^raw\b/i.test(source.sql.trim()) && /^(uuid|uniqueidentifier)$/i.test(fallback.sql)) this.loss("type", table.name, MSG.lossRawUuid(), column.name);
      return { sql: fallback.sql + collate, checks };
    }
    // Texte long (LOB) là où la cible ne sait pas le comparer : borné, avec perte.
    const bound = effective.kind === "text" && effective.length === "large" && effective.encoding !== "binary" ? boundedTextSize(this.target, usage(table, column.name)) : undefined;
    if (effective.kind === "text" && bound !== undefined) {
      const bounded = sqlType({ ...effective, length: "variable", size: bound }, dbms, version, this.target.custom?.types)!;
      if (!column.foreign) this.loss("type", table.name, MSG.lossType(source?.sql ?? sqlType(effective, dbms, version, this.target.custom?.types) ?? "TEXT", bounded), column.name);
      return { sql: bounded + collate, checks };
    }
    let sql = sqlType(effective, dbms, version, this.target.custom?.types);
    // PostgreSQL : binaire borné → BYTEA, jamais BIT / BIT VARYING (des bits, pas des octets) (O-39).
    if (dbms === "postgresql" && effective.kind === "text" && effective.encoding === "binary" && effective.length !== "large") {
      if (!column.foreign) this.loss("type", table.name, MSG.lossType(source?.sql ?? describe(effective), "BYTEA"), column.name);
      return { sql: "BYTEA", checks };
    }
    if (sql === null) {
      this.loss("type", table.name, MSG.lossType(source?.sql ?? effective.kind, "—"), column.name);
      return { sql: null, checks };
    }
    // Entiers à plage décimale (Oracle NUMBER(p), NUMBER) : comparés par leur plage (O-39).
    const digits = effective.kind === "integer" && (/^\s*number\b/i.test(source?.sql ?? "") || /^NUMBER\(/i.test(sql));
    if (effective !== type) {
      // Élargi pour couvrir la plage, négatifs exclus (CHECK ou clé étrangère) : rien de perdu.
    } else if (dbms === "sqlite") {
      // SQLite ne connaît que des affinités (TEXT, INTEGER, NUMERIC…) : seul un changement d'affinité compte.
      if (source && !domain && sqliteAffinity(source.sql) !== sqliteAffinity(sql)) this.loss("type", table.name, MSG.lossType(source.sql, sql), column.name);
    } else if (digits) {
      this.integerLosses(table, column, sql, checks);
    } else if (column.foreign && (effective.kind === "integer" || effective.kind === "text")) {
      // Clé étrangère : plage et longueur découlent de la clé référencée, qui seule porte l'entrée (O-40).
    } else if (effective.kind !== "free" && !domain && !sameType(sqlTypeToDataType(sql, false, dbms), effective)) {
      this.loss("type", table.name, MSG.lossType(source?.sql ?? describe(effective), sql), column.name);
    }
    if (mysql && column.unsigned && (effective.kind === "integer" || effective.kind === "decimal")) sql += " UNSIGNED";
    // TINYINT(1) lu comme booléen : MySQL y accepte d'autres valeurs que 0 / 1 (−128 à 127) (O-38).
    if (source && /^tinyint\s*\(\s*1\s*\)/i.test(source.sql) && effective.kind === "boolean" && !mysql) {
      this.loss("type", table.name, MSG.lossTinyintBoolean(sql), column.name);
    }
    // TIMESTAMP MySQL : stocké en UTC (comme TIMESTAMPTZ), mais sur la plage 1970–2038.
    if (source && /^timestamp\b/i.test(source.sql) && (source.dialect === "mysql" || source.dialect === "mariadb") && !mysql) {
      this.loss("type", table.name, MSG.lossMysqlTimestamp(sql), column.name);
    }
    if (source?.dialect === "oracle" && effective.kind === "text" && effective.encoding !== "binary" && dbms !== "oracle") this.oracleText(table, column, source.sql, checks);
    // Types spatiaux vers PostgreSQL (O-42) : CREATE EXTENSION postgis en tête (option par défaut), ou
    // repli sans extension — BYTEA (WKB) ou TEXT (WKT) —, signalé ; le script s'exécute sans PostGIS.
    if ((effective.kind === "geography" || effective.kind === "geometry") && dbms === "postgresql") {
      if (this.options.spatial === "postgis") {
        const extension = "CREATE EXTENSION IF NOT EXISTS postgis;";
        if (!this.preamble.includes(extension)) this.preamble.unshift(extension);
      } else {
        const fallback = this.options.spatial === "wkb" ? "BYTEA" : "TEXT";
        this.loss("type", table.name, MSG.lossSpatialFallback(sql, fallback), column.name);
        return { sql: fallback, checks };
      }
    }
    // SQL Server (O-42) : DATETIMEOFFSET perd son décalage ; DATETIME arrondissait au 1/300 s.
    if (source?.dialect === "sqlserver" && dbms !== "sqlserver") {
      if (/^datetimeoffset\b/i.test(source.sql.trim())) this.loss("type", table.name, MSG.lossDatetimeOffset(sql), column.name);
      if (/^datetime$/i.test(source.sql.trim())) this.loss("type", table.name, MSG.lossSqlServerDatetime(sql), column.name);
    }
    // Vers Oracle (O-39) : longueur en caractères, comme à la source ; la chaîne vide y vaut NULL.
    if (dbms === "oracle" && source && source.dialect !== "oracle" && effective.kind === "text" && effective.encoding !== "binary") {
      sql = sql.replace(/^(VARCHAR2|CHAR)\((\d+)\)$/, "$1($2 CHAR)");
      const rejected = [column.check, ...table.checks].some((check) => {
        const condition = check && !check.state?.disabled ? parseCondition(check.expression) : null;
        return Boolean(condition && excludesEmptyString(condition, column.name));
      });
      const notNull = column.notNull || table.primaryKey.includes(column.name);
      if (!rejected || !notNull) this.loss("domain", table.name, MSG.lossToOracleEmptyString(notNull), column.name);
    }
    return { sql: sql + collate, checks };
  }

  /**
   * Texte Oracle vers un autre SGBD (O-39) : longueur en octets (BYTE, ou selon NLS_LENGTH_SEMANTICS),
   * et chaîne vide qui vaut NULL — refusée par NOT NULL (CHECK (col <> '') en option), NULL sinon.
   */
  private oracleText(table: LogicalTable, column: LogicalColumn, sourceSql: string, checks: string[]) {
    const conditions = [column.check, ...table.checks]
      .filter((c): c is CheckConstraint => Boolean(c) && !c!.state?.disabled)
      .map((c) => parseCondition(c.expression))
      .filter((c) => c !== null);
    // Octets ou caractères : sans objet sur une clé étrangère (découle de la clé référencée) ou quand
    // un CHECK IN n'admet que des valeurs ASCII (un octet par caractère) (O-40).
    const lengthMatters = !column.foreign && !conditions.some((c) => asciiDomain(c, column.name));
    if (lengthMatters && /^(var)?char2?\s*\(\s*\d+\s+byte\s*\)/i.test(sourceSql.trim())) this.loss("type", table.name, MSG.lossByteSemantics(), column.name);
    else if (lengthMatters && /^(varchar2?|char|character)\s*\(\s*\d+\s*\)$/i.test(sourceSql.trim())) this.loss("type", table.name, MSG.lossNlsSemantics(), column.name);
    const notNull = column.notNull || table.primaryKey.includes(column.name);
    const rejected = conditions.some((c) => excludesEmptyString(c, column.name));
    // Facultative : Oracle acceptait '' (devenue NULL) ; ici, stockée telle quelle, ou rejetée par un CHECK existant.
    if (!notNull) this.loss("domain", table.name, rejected ? MSG.lossEmptyStringRejected() : MSG.lossEmptyStringNull(), column.name);
    else if (rejected) return;
    else if (this.options.emptyStrings === "check") checks.push(`${this.columnRef(table, column.name)} <> ''`);
    else this.loss("domain", table.name, MSG.lossEmptyStringNotNull(), column.name);
  }

  /**
   * Entier issu d'un NUMBER Oracle (O-39) : NUMBER sans précision devenu entier (séquence, identité,
   * clé qui la référence) ; plage élargie (NUMBER(4) → SMALLINT) sauf si un CHECK la borne.
   */
  private integerLosses(table: LogicalTable, column: LogicalColumn, sql: string, checks: string[]) {
    const source = column.sourceType;
    // Clé étrangère : type et plage découlent de la clé référencée, qui seule porte l'entrée (O-40).
    if (!source || column.foreign) return;
    const emitted = sql.replace(/\s+(GENERATED|IDENTITY|AUTO_INCREMENT)\b.*$/i, "").trim();
    if (source.dialect === "oracle" && /^number$/i.test(source.sql.trim())) {
      const why = column.sequence ? "sequence" : column.type?.kind === "counter" ? "identity" : "reference";
      this.loss("type", table.name, MSG.lossNumberInteger(source.sql, emitted, why), column.name);
      return;
    }
    const from = integerRange(source.sql, source.dialect);
    const to = integerRange(emitted, this.target.dbms);
    if (!from || !to || (to[0] >= from[0] && to[1] <= from[1])) return;
    const bounds = this.checkBounds(table, column);
    if (bounds === "none") return;
    const lo = bounds.lo !== null && bounds.lo > to[0] ? bounds.lo : to[0];
    const hi = bounds.hi !== null && bounds.hi < to[1] ? bounds.hi : to[1];
    if (lo >= from[0] && hi <= from[1]) return;
    // Fidélité stricte (option) : la plage d'origine est rétablie par un CHECK (O-40).
    if (this.options.strictRanges) {
      checks.push(`${this.columnRef(table, column.name)} BETWEEN ${from[0]} AND ${from[1]}`);
      return;
    }
    this.loss("type", table.name, MSG.lossRangeWidened(source.sql, emitted), column.name);
  }

  /** Bornes que les CHECK actifs de la colonne et de la table imposent à ses valeurs. */
  private checkBounds(table: LogicalTable, column: LogicalColumn) {
    const conditions = [column.check, ...table.checks]
      .filter((c): c is CheckConstraint => Boolean(c) && !c!.state?.disabled)
      .map((c) => parseCondition(c.expression))
      .filter((c) => c !== null);
    return valueBounds({ kind: "and", items: conditions }, column.name);
  }

  /** Un CHECK de la colonne (ou de la table, ne portant que sur elle) exclut-il déjà les négatifs ? */
  private alreadyNonNegative(table: LogicalTable, column: LogicalColumn): boolean {
    // Une contrainte désactivée ne protège rien (O-42).
    const checks = [column.check, ...table.checks].filter((c): c is CheckConstraint => Boolean(c) && !c!.state?.disabled);
    return checks.some((check) => {
      const condition = parseCondition(check.expression);
      return Boolean(condition && impliesNonNegative(condition, column.name));
    });
  }

  /** Clause COLLATE pour la cible (vide si sans objet) ; une collation intransposable est signalée. */
  private collationClause(table: LogicalTable, column: LogicalColumn, source: SqlDialect | undefined): string {
    const name = column.type?.kind === "text" ? column.type.collation ?? this.assumedCollation(column) : undefined;
    if (!name) return "";
    const result = translateCollation(name, source, this.target, this.options.collations !== "deterministic");
    if (result.kind === "dropped") {
      this.loss("collation", table.name, MSG.lossCollation(name), column.name);
      return "";
    }
    if (result.preamble && !this.preamble.includes(result.preamble)) this.preamble.unshift(result.preamble);
    if (result.approximation) this.loss("collation", table.name, MSG.lossCollationApprox(name, result.approximation), column.name);
    if (column.domain && this.target.dbms === "postgresql" && this.options.enums === "type" && column.domain.kind === "enum" && result.sql) {
      this.loss("collation", table.name, MSG.lossCollationEnumType(name), column.name);
    }
    return result.sql ? ` ${result.sql}` : "";
  }

  /**
   * Collation supposée d'un texte SQL Server sans collation déclarée (celle de la base, absente du
   * script) : CI_AS par défaut (option) ; l'hypothèse est rappelée une fois au rapport (O-42).
   */
  private assumedCollation(column: LogicalColumn): string | undefined {
    const source = column.sourceType;
    if (source?.dialect !== "sqlserver" || this.target.dbms === "sqlserver") return undefined;
    if (column.type?.kind !== "text" || column.type.encoding === "binary") return undefined;
    const name = { ci_as: "Latin1_General_CI_AS", ci_ai: "Latin1_General_CI_AI", cs_as: "Latin1_General_CS_AS" }[this.options.sqlServerCollation];
    if (!this.report.has(MSG.lossSqlServerCollation(name))) this.loss("collation", "", MSG.lossSqlServerCollation(name));
    return name;
  }

  /** Collations insensibles émises comme collations ICU non déterministes (PostgreSQL) ? */
  icuCollations(): boolean {
    return this.target.dbms === "postgresql" && this.options.collations !== "deterministic";
  }

  /** Classe de collation effective d'une colonne (déclarée ou supposée) (O-42). */
  effectiveCollationClass(column: LogicalColumn) {
    const name = column.type?.kind === "text" ? column.type.collation ?? this.assumedCollation(column) : undefined;
    return name ? collationClass(name) : undefined;
  }

  /** Type énuméré PostgreSQL (option « type ») : déclaré avant les tables. */
  private enumType(table: LogicalTable, column: LogicalColumn, list: string): string {
    const name = fitName(`${table.name}_${column.name}`.toLowerCase(), this.maxName);
    this.preamble.push(`CREATE TYPE ${this.q(name)} AS ENUM (${list});`);
    return this.q(name);
  }

  /** Première valeur du compteur (AUTO_INCREMENT = n, START WITH n). */
  private identityStart(table: LogicalTable, column: LogicalColumn, sql: string): string {
    const start = table.identityStart;
    // Pas du compteur : IDENTITY(100, 10), INCREMENT BY 10 (O-41).
    const step = table.identityStep;
    if ((start === undefined && step === undefined) || !table.primaryKey.includes(column.name)) return sql;
    const { dbms } = this.target;
    if (/AS IDENTITY$/i.test(sql)) {
      return `${sql} (${[start !== undefined ? `START WITH ${start}` : "", step !== undefined ? `INCREMENT BY ${step}` : ""].filter(Boolean).join(" ")})`;
    }
    if (dbms === "sqlserver" && /IDENTITY$/i.test(sql)) return `${sql}(${start ?? 1}, ${step ?? 1})`;
    if (dbms === "access" && /^COUNTER$/i.test(sql)) return `COUNTER(${start ?? 1}, ${step ?? 1})`;
    if (step !== undefined) this.loss("autoIncrement", table.name, MSG.lossIdentityStep(step), column.name);
    if (start === undefined) return sql;
    if (dbms === "mysql" || dbms === "mariadb") {
      this.tableOptions.set(table, ` AUTO_INCREMENT=${start}`);
      return sql;
    }
    this.loss("autoIncrement", table.name, MSG.lossIdentityStart(start), column.name);
    return sql;
  }

  defaultClause(table: LogicalTable, column: LogicalColumn, type: string | null): string | null {
    if (column.sequence) return this.sequenceDefault(table, column);
    const value = column.defaultValue;
    if (!value) return null;
    if (sameDialect(value.dialect, this.target.dbms)) return `DEFAULT ${value.expression}`;
    const parsed = parseDefault(value.expression);
    let rendered = parsed && renderOperand(parsed, this.target);
    // SYSDATE dans une colonne devenue DATE (option) : date du jour (O-39).
    if (parsed?.kind === "date" && (parsed.fn === "localtimestamp" || parsed.fn === "localtimestamp_seconds") && /^DATE\b/i.test(type ?? "")) rendered = renderOperand({ kind: "date", fn: "current_date" }, this.target);
    // SYS_GUID() → identifiant aléatoire de la cible : approximation signalée (O-39).
    // SYS_GUID() (Oracle), NEWSEQUENTIALID() (SQL Server, croissant) → UUID aléatoire : approximation (O-39, O-41).
    // NEWSEQUENTIALID() → uuidv7() (croissant) à partir de PostgreSQL 18 : rien de perdu (O-42).
    const uuidSource = /^\(*\s*(sys_guid|newsequentialid)\s*\(/i.exec(value.expression)?.[1];
    if (parsed?.kind === "function" && parsed.fn.startsWith("uuid") && uuidSource && rendered && !/^\(*\s*(sys_guid|newsequentialid|uuidv7)/i.test(rendered)) {
      this.loss("default", table.name, MSG.lossUuidDefault(`${uuidSource.toUpperCase()}()`, rendered), column.name);
    }
    // Booléen (TINYINT(1) MySQL) : 0 / 1 → FALSE / TRUE (O-35).
    if (parsed?.kind === "number" && column.type?.kind === "boolean" && (parsed.value === "0" || parsed.value === "1")) {
      rendered = renderOperand({ kind: "boolean", value: parsed.value === "1" }, this.target);
    }
    // SET en tableau PostgreSQL : 'a,b' → ARRAY['a', 'b']::text[].
    if (parsed?.kind === "string" && column.domain?.kind === "set" && type?.startsWith("TEXT[]")) {
      rendered = `ARRAY[${parsed.value.split(",").filter(Boolean).map((v) => `'${v.replaceAll("'", "''")}'`).join(", ")}]::text[]`;
    }
    // MySQL : pas de défaut littéral sur TEXT / BLOB / JSON / GEOMETRY ; expression entre parenthèses depuis 8.0.13.
    if (rendered && (this.target.dbms === "mysql" || this.target.dbms === "mariadb") && /^(\w*text|\w*blob|json|geometry)\b/i.test(type ?? "")) {
      rendered = this.target.dbms === "mysql" && this.target.version === "5.7" ? null : rendered.startsWith("(") ? rendered : `(${rendered})`;
    }
    if (rendered) return `DEFAULT ${rendered}`;
    // Colonne NOT NULL : un INSERT sans valeur échouera — entrée P0 explicite (O-42).
    const required = column.notNull || table.primaryKey.includes(column.name);
    this.loss("default", table.name, required ? MSG.lossDefaultNotNull(value.expression) : MSG.lossDefault(value.expression), column.name, required ? "P0" : undefined);
    return null;
  }

  /**
   * Valeur tirée d'une séquence (O-39) : DEFAULT nextval('s') (PostgreSQL), s.NEXTVAL (Oracle),
   * NEXT VALUE FOR s (SQL Server), NEXTVAL(s) (MariaDB) ; la séquence est créée en tête de script.
   * Un déclencheur d'origine (remplaçait un NULL explicite, ou toute valeur) est signalé.
   */
  private sequenceDefault(table: LogicalTable, column: LogicalColumn): string | null {
    const { dbms, version } = this.target;
    const sequence = column.sequence!;
    const definition = table.sequences?.find((s) => s.name.toLowerCase() === sequence.name.toLowerCase()) ?? { name: sequence.name };
    const name = this.sequenceName(definition);
    const syntax: Partial<Record<Dbms, string>> = {
      postgresql: `nextval('${name.replaceAll("'", "''")}')`,
      oracle: isAtLeast("oracle", version, "12c") ? `${name}.NEXTVAL` : undefined,
      sqlserver: isAtLeast("sqlserver", version, "2012") ? `NEXT VALUE FOR ${name}` : undefined,
      mariadb: isAtLeast("mariadb", version, "10.3") ? `NEXTVAL(${name})` : undefined,
    };
    const expression = syntax[dbms];
    if (!expression) {
      const required = column.notNull || table.primaryKey.includes(column.name);
      this.loss("default", table.name, MSG.lossSequence(sequence.name), column.name, required ? "P0" : undefined);
      return null;
    }
    this.declareSequence(definition, table);
    // PostgreSQL : la séquence appartient à la colonne qu'elle seule alimente (supprimée avec elle) (O-40).
    // OWNED BY : séquence et table dans le même schéma (exigence de PostgreSQL) (O-42).
    const sameSchema = (this.schemaOf(definition.schema) ?? "").toLowerCase() === (this.schemaOf(table.schema) ?? "").toLowerCase();
    if (dbms === "postgresql" && sameSchema && this.sequenceUsers.get(sequence.name.toLowerCase()) === 1) {
      this.epilogue.push(`ALTER SEQUENCE ${name} OWNED BY ${this.tableName(table)}.${this.q(column.name, column.caseSensitive)};`);
    }
    if (sequence.trigger) this.loss("default", table.name, MSG.lossSequenceTrigger(sequence.trigger), column.name);
    return `DEFAULT ${expression}`;
  }

  /** Nom de séquence qualifié par son schéma (ref.seq_client) (O-42). */
  private sequenceName(s: SequenceDefinition): string {
    const schema = this.schemaOf(s.schema);
    return `${schema ? `${this.q(schema)}.` : ""}${this.q(s.name)}`;
  }

  private readonly sequences = new Set<string>();
  /** Nombre de colonnes alimentées par chaque séquence. */
  private readonly sequenceUsers = new Map<string, number>();

  /** CREATE SEQUENCE en tête de script, une fois par séquence. */
  private declareSequence(s: SequenceDefinition, table: LogicalTable) {
    if (this.sequences.has(s.name.toLowerCase())) return;
    this.sequences.add(s.name.toLowerCase());
    const { dbms } = this.target;
    const oracle = dbms === "oracle";
    const parts = [`CREATE SEQUENCE ${this.sequenceName(s)}`];
    this.declareSchema(s.schema, table);
    // Type des valeurs (AS INT) : PostgreSQL et SQL Server ; ailleurs, type par défaut (signalé) (O-41).
    if (s.type) {
      const type = { int: "INTEGER", integer: "INTEGER", bigint: "BIGINT", smallint: "SMALLINT", tinyint: "TINYINT" }[s.type];
      if (type && dbms === "postgresql" && type !== "TINYINT") parts.push(`AS ${type}`);
      else if (type && dbms === "sqlserver") parts.push(`AS ${type === "INTEGER" ? "INT" : type}`);
      else this.loss("default", table.name, MSG.lossSequenceType(s.type.toUpperCase()));
    }
    if (s.start !== undefined) parts.push(`START WITH ${s.start}`);
    if (s.increment !== undefined) parts.push(`INCREMENT BY ${s.increment}`);
    if (s.min !== undefined) parts.push(`MINVALUE ${s.min}`);
    if (s.max !== undefined) parts.push(`MAXVALUE ${s.max}`);
    if (s.cache !== undefined) parts.push(oracle && s.cache <= 1 ? "NOCACHE" : dbms === "sqlserver" && s.cache <= 1 ? "NO CACHE" : `CACHE ${Math.max(1, s.cache)}`);
    if (s.cycle !== undefined) parts.push(s.cycle ? "CYCLE" : oracle ? "NOCYCLE" : "NO CYCLE");
    this.preamble.push(`${parts.join(" ")};`);
  }

  /** Colonne calculée : clause pour la cible, ou `null` (colonne ordinaire, perte signalée). */
  generatedClause(table: LogicalTable, column: LogicalColumn): { expression: string; stored: boolean } | null {
    const generated = column.generated!;
    const { dbms, version } = this.target;
    const expression = sameDialect(generated.dialect, dbms)
      ? generated.expression
      : translateGenerated(generated.expression, generated.dialect, {
          target: this.target,
          columnType: (name) => table.columns.find((c) => c.name.toLowerCase() === name.toLowerCase())?.type,
          caseSensitive: (name) => Boolean(table.columns.find((c) => c.name === name)?.caseSensitive),
        });
    const supported = ["postgresql", "mysql", "mariadb", "sqlite", "oracle", "sqlserver", "db2"].includes(dbms);
    if (expression === null || !supported) {
      this.loss("generated", table.name, MSG.lossGenerated(generated.expression), column.name);
      return null;
    }
    let stored = generated.stored;
    const virtualOk = dbms === "postgresql" ? isAtLeast("postgresql", version, "18") : dbms !== "db2";
    const storedOk = dbms !== "oracle";
    if (!stored && !virtualOk) {
      stored = true;
      this.loss("generated", table.name, MSG.lossGeneratedMode("VIRTUAL", "STORED"), column.name);
    } else if (stored && !storedOk) {
      stored = false;
      this.loss("generated", table.name, MSG.lossGeneratedMode("STORED", "VIRTUAL"), column.name);
    }
    return { expression, stored };
  }

  /** CHECK écrit pour la cible, ou `null` (non traduisible ou incompatible : commentaire + perte). */
  check(table: LogicalTable, check: CheckConstraint, column?: string): string | null {
    let expression: string | null = null;
    if (sameDialect(check.dialect, this.target.dbms) || check.dialect === "generic") {
      expression = check.dialect === "generic" ? renderStructured(this, table, check.expression) ?? check.expression : check.expression;
    } else {
      expression = renderStructured(this, table, check.expression, check.dialect);
    }
    if (expression === null) {
      this.loss("check", table.name, MSG.lossCheck(check.expression), column);
      return null;
    }
    // Typage strict (PostgreSQL, DB2) : un CHECK qui compare des familles de types différentes
    // après conversion (ex. YEAR devenu texte) ferait échouer le script (O-35).
    if (this.target.dbms === "postgresql" || this.target.dbms === "db2") {
      const condition = parseCondition(check.expression);
      const conflict = condition && typeConflict(condition, (name) => familyOf(table, name, this.target));
      if (conflict) {
        this.loss("check", table.name, MSG.lossCheckTypes(check.expression, conflict), column);
        return null;
      }
    }
    if (!enforcesCheck(this.target)) this.loss("check", table.name, MSG.lossCheckNotEnforced(expression), column);
    return expression;
  }

  // -------------------------------------------------------------------------------------------
  // Clés étrangères

  actions(table: LogicalTable, fk: LogicalForeignKey, sqlServerGraph: CascadeGraph | null): string {
    const parts: string[] = [];
    for (const event of ["delete", "update"] as const) {
      let action = event === "delete" ? fk.onDelete : fk.onUpdate;
      if (!action) continue;
      // SQL Server refuse les chemins de cascade multiples ou cycliques.
      if (sqlServerGraph && ["cascade", "set null", "set default"].includes(action)) {
        if (!sqlServerGraph.accept(event, fk.referencedTable, table.name)) {
          this.loss("action", table.name, MSG.lossCascadePath(event.toUpperCase(), action.toUpperCase()), fk.columns.join(", "));
          action = "no action";
        }
      }
      const result = referentialAction(this.target, event, action);
      if (result.kind === "emit") parts.push(result.sql);
      else if (result.kind === "degraded") {
        if (result.sql) parts.push(result.sql);
        this.loss("action", table.name, MSG.lossAction(`ON ${event.toUpperCase()} ${action.toUpperCase()}`, result.fallback.toUpperCase()), fk.columns.join(", "));
      }
    }
    return parts.length ? ` ${parts.join(" ")}` : "";
  }

  foreignKey(tables: LogicalTable[], table: LogicalTable, fk: LogicalForeignKey, graph: CascadeGraph | null): string {
    const name = this.constraintName(table, fk.name, "FK", [fk.referencedTable]);
    const referenced = tables.find((t) => t.name === fk.referencedTable);
    const columns = fk.columns.map((c) => this.columnRef(table, c)).join(", ");
    const refColumns = fk.referencedColumns.map((c) => (referenced ? this.columnRef(referenced, c) : this.q(c))).join(", ");
    const constraint = name ? `CONSTRAINT ${this.q(name)} ` : "";
    const state = this.stateClause(table, "foreign", fk.name ?? `FOREIGN KEY(${fk.columns.join(", ")})`, fk.state);
    return `${constraint}FOREIGN KEY(${columns}) REFERENCES ${this.tableRef(tables, fk.referencedTable)}(${refColumns})${this.actions(table, fk, graph)}${state}`;
  }

  // -------------------------------------------------------------------------------------------
  // États des contraintes (O-39)

  /** Contraintes ajoutées sans valider les lignes existantes (NOT VALID / ENABLE NOVALIDATE), après les tables. */
  private readonly notValidated: string[] = [];

  /**
   * DEFERRABLE [INITIALLY …] pour la cible, ou rien (signalé si la source l'avait). PostgreSQL et
   * SQLite ne diffèrent pas les CHECK ; MySQL, SQL Server, DB2 ne diffèrent rien.
   */
  private stateClause(table: LogicalTable, kind: "check" | "unique" | "primary" | "foreign", label: string, state?: ConstraintState): string {
    if (!state?.deferrable || state.disabled) return "";
    const { dbms } = this.target;
    const supported = dbms === "oracle" || (kind !== "check" && dbms === "postgresql") || (kind === "foreign" && dbms === "sqlite");
    if (!supported) {
      this.loss(kind === "check" ? "check" : kind === "foreign" ? "action" : "index", table.name, kind === "check" ? MSG.lossDeferrableCheck(label) : MSG.lossDeferrable(label));
      return "";
    }
    return state.deferrable === "deferred" ? " DEFERRABLE INITIALLY DEFERRED" : " DEFERRABLE INITIALLY IMMEDIATE";
  }

  /**
   * Place d'une contrainte selon son état : `inline` (dans le CREATE TABLE), `comment` (désactivée à
   * la source : émise en commentaire, signalée), `after` (non validée : ALTER TABLE … NOT VALID).
   */
  private placement(table: LogicalTable, kind: "check" | "unique" | "primary" | "foreign", label: string, state?: ConstraintState): "inline" | "comment" | "after" {
    const category = kind === "check" ? "check" : kind === "foreign" ? "action" : "index";
    if (state?.disabled) {
      this.loss(category, table.name, MSG.lossDisabled(label, state.dialect));
      return "comment";
    }
    if (!state?.notValidated) return "inline";
    const { dbms } = this.target;
    if (dbms === "oracle" || (dbms === "postgresql" && (kind === "check" || kind === "foreign"))) return "after";
    this.loss(category, table.name, MSG.lossNotValidated(label, state.dialect));
    return "inline";
  }

  /** ALTER TABLE … ADD contrainte NOT VALID (PostgreSQL) / ENABLE NOVALIDATE (Oracle). */
  private addNotValidated(table: LogicalTable, definition: string) {
    const suffix = this.target.dbms === "oracle" ? " ENABLE NOVALIDATE" : " NOT VALID";
    this.notValidated.push(`ALTER TABLE ${this.tableName(table)} ADD ${definition}${suffix};`);
  }

  /** Contrainte placée selon son état ; renvoie la ligne à mettre dans le CREATE TABLE, ou `null`. */
  private place(
    table: LogicalTable,
    definition: string,
    where: "inline" | "comment" | "after",
    after: string[],
    state: ConstraintState | undefined,
    required: () => string,
  ): string | null {
    if (where === "inline") return definition;
    if (where === "comment") after.push(`-- ${definition} -- ${MSG.disabledComment(state?.dialect)}`);
    else this.addNotValidated(table, definition.startsWith("CONSTRAINT ") ? definition : `CONSTRAINT ${this.q(required())} ${definition}`);
    return null;
  }

  // -------------------------------------------------------------------------------------------
  // Tables

  /** Définition d'une colonne dans le CREATE TABLE. */
  private columnLine(table: LogicalTable, c: LogicalColumn, inlinePk: boolean, after: string[]): string {
    const { dbms } = this.target;
    const mysql = dbms === "mysql" || dbms === "mariadb";
    const parts = [this.q(c.name, c.caseSensitive)];
    const generated = c.generated ? this.generatedClause(table, c) : null;
    const { sql: type, checks } = this.typeOf(table, c, inlinePk);
    if (generated && dbms === "sqlserver") {
      // SQL Server : colonne calculée sans type déclaré (déduit de l'expression).
      if (type) this.loss("generated", table.name, MSG.lossGeneratedType(type), c.name);
      parts.push(`AS (${generated.expression})${generated.stored ? " PERSISTED" : ""}`);
      return parts.join(" ");
    }
    if (type) parts.push(type);
    if (inlinePk) parts.push("PRIMARY KEY AUTOINCREMENT");
    if (generated) {
      parts.push(`GENERATED ALWAYS AS (${generated.expression})${dbms === "db2" ? "" : generated.stored ? " STORED" : " VIRTUAL"}`);
    } else {
      const defaultClause = this.defaultClause(table, c, type);
      if (defaultClause) parts.push(defaultClause);
    }
    if (c.onUpdate) {
      if (mysql) parts.push(`ON UPDATE ${c.onUpdate.expression}`);
      else this.loss("onUpdate", table.name, MSG.lossOnUpdate(c.onUpdate.expression), c.name);
    }
    // SQLite accepte NULL dans une clé primaire qui n'est pas INTEGER PRIMARY KEY : NOT NULL explicite.
    const nullablePk = dbms === "sqlite" && !inlinePk && table.primaryKey.includes(c.name);
    if (c.notNull || nullablePk) parts.push("NOT NULL");
    if (c.unique && !table.uniques.some((u) => u.columns.length === 1 && u.columns[0] === c.name)) {
      parts.push("UNIQUE");
      this.sqlServerNulls(table, [c.name], `(${c.name})`);
    }
    // YEAR (MySQL) : 1901 à 2155 ; contrainte fusionnée avec le CHECK de la colonne s'il y en a un (O-38).
    const yearRange =
      c.sourceType && /^year\b/i.test(c.sourceType.sql) && !sameDialect(c.sourceType.dialect, dbms) && !mysql
        ? `${this.columnRef(table, c.name)} BETWEEN 1901 AND 2155`
        : null;
    let merged = false;
    if (c.check) {
      const expression = this.check(table, c.check, c.name);
      const label = c.check.name ?? `CHECK (${c.check.expression})`;
      const where = this.placement(table, "check", label, c.check.state);
      const name = c.check.name ? `CONSTRAINT ${this.q(this.constraintName(table, c.check.name, "CK", [c.name])!)} ` : "";
      if (expression !== null) {
        const active = where === "inline";
        const definition = `${name}CHECK (${yearRange && active ? `(${expression}) AND ${yearRange}` : expression})${this.stateClause(table, "check", label, c.check.state)}`;
        const line = this.place(table, definition, where, after, c.check.state, () => this.constraintName(table, undefined, "CK", [c.name], true)!);
        if (line) parts.push(line);
        merged = Boolean(yearRange) && active;
      } else after.push(`-- ${MSG.untranslatedCheck(`${table.name}.${c.name}`, c.check.expression)}`);
    }
    if (yearRange && !merged) checks.push(yearRange);
    for (const check of checks) parts.push(`CHECK (${check})`);
    // NOT FOR REPLICATION, ROWGUIDCOL (SQL Server) : réémis vers SQL Server, abandonnés ailleurs (O-42).
    for (const option of c.sqlServerOptions ?? []) {
      if (dbms === "sqlserver") parts.splice(option === "ROWGUIDCOL" ? 2 : parts.length, 0, option);
      else this.loss("physical", table.name, MSG.lossSqlServerOption(option), c.name);
    }
    if (c.comment && mysql) parts.push(`COMMENT ${sqlString(c.comment)}`);
    if (c.complement?.trim()) parts.push(c.complement.trim());
    return parts.join(" ");
  }

  createTable(tables: LogicalTable[], table: LogicalTable, deferred: Set<LogicalForeignKey>, graph: CascadeGraph | null): string {
    const after: string[] = [];
    const { dbms } = this.target;
    const mysql = dbms === "mysql" || dbms === "mariadb";
    const sqlitePk =
      dbms === "sqlite" &&
      table.primaryKey.length === 1 &&
      table.columns.find((c) => c.name === table.primaryKey[0])?.type?.kind === "counter" &&
      !table.primaryKeyName;
    const lines = table.columns.map((c) => this.columnLine(table, c, Boolean(sqlitePk && c.name === table.primaryKey[0]), after));
    if (table.primaryKey.length > 0 && !sqlitePk) {
      const name = this.constraintName(table, table.primaryKeyName, "PK", []);
      const label = table.primaryKeyName ?? "PRIMARY KEY";
      const where = this.placement(table, "primary", label, table.primaryKeyState);
      const definition = `${name ? `CONSTRAINT ${this.q(name)} ` : ""}PRIMARY KEY(${table.primaryKey.map((c) => this.columnRef(table, c)).join(", ")})${this.stateClause(table, "primary", label, table.primaryKeyState)}`;
      const line = this.place(table, definition, where, after, table.primaryKeyState, () => this.constraintName(table, undefined, "PK", [], true)!);
      if (line) lines.push(line);
    }
    for (const unique of table.uniques) {
      const line = this.uniqueLine(table, unique, after);
      if (line) lines.push(line);
    }
    table.checks.forEach((check, i) => {
      const expression = this.check(table, check);
      if (expression === null) {
        after.push(`-- ${MSG.untranslatedCheck(table.name, check.expression)}`);
        return;
      }
      const label = check.name ?? `CHECK (${check.expression})`;
      const where = this.placement(table, "check", label, check.state);
      const name = this.constraintName(table, check.name, "CK", [String(i + 1)], where === "after");
      const definition = `${name ? `CONSTRAINT ${this.q(name)} ` : ""}CHECK (${expression})${this.stateClause(table, "check", label, check.state)}`;
      const line = this.place(table, definition, where, after, check.state, () => name!);
      if (line) lines.push(line);
    });
    for (const fk of table.foreignKeys) {
      if (deferred.has(fk)) continue;
      const where = this.placement(table, "foreign", fk.name ?? `FOREIGN KEY(${fk.columns.join(", ")})`, fk.state);
      const definition = this.foreignKey(tables, table, fk, graph);
      const line = this.place(table, definition, where, after, fk.state, () => this.constraintName(table, undefined, "FK", [fk.referencedTable], true)!);
      if (line) lines.push(line);
    }
    // Partitionnement : abandonné, signalé (O-39).
    if (table.partition) this.loss("physical", table.name, MSG.lossPartition(dbms === "postgresql"));
    const options = (this.tableOptions.get(table) ?? "") + (mysql && table.comment ? ` COMMENT=${sqlString(table.comment)}` : "");
    this.declareSchema(table.schema, table);
    const statement = `CREATE TABLE ${this.tableName(table)}(\n${lines.map((l) => INDENT + l).join(",\n")}\n)${options};`;
    this.comments(table);
    this.triggers(table);
    return [statement, ...after].join("\n");
  }

  /**
   * Contrainte UNIQUE dans le CREATE TABLE, ou `null` si elle devient un index unique en fin de
   * script (préfixe : sur expression) ou si la cible ne sait pas l'exprimer (signalé) (O-35).
   */
  private uniqueLine(table: LogicalTable, unique: LogicalKey, after: string[]): string | null {
    const { dbms } = this.target;
    const mysql = dbms === "mysql" || dbms === "mariadb";
    const label = describeKey(unique);
    if (unique.method && unique.method !== "btree" && !mysql) {
      // Hors MySQL, une méthode autre que B-tree ne garantit pas l'unicité (PostgreSQL : HASH non unique).
      this.loss("index", table.name, MSG.lossIndexMethod(unique.name ?? label, unique.method.toUpperCase()));
    }
    // Sur expression ou conditionnelle : index unique en fin de script (O-39).
    if (unique.expression || unique.where) {
      this.epilogue.push(...this.expressionIndex(table, unique));
      return null;
    }
    if (unique.prefixes && !mysql) {
      this.epilogue.push(...this.keyIndex(table, unique, true));
      return null;
    }
    // Plusieurs NULL admis (index filtré SQL Server « IS NOT NULL ») : vers SQL Server, même index filtré (O-41).
    if (unique.nulls === "distinct" && dbms === "sqlserver") {
      const filter = unique.columns.map((c) => `${this.columnRef(table, c)} IS NOT NULL`).join(" AND ");
      const indexName = this.q(this.constraintName(table, unique.name, "AK", unique.columns, true)!);
      this.epilogue.push(`CREATE UNIQUE INDEX ${indexName} ON ${this.tableName(table)}(${this.keyColumns(table, unique)}) WHERE ${filter};`);
      return null;
    }
    const where = this.placement(table, "unique", unique.name ?? label, unique.state);
    const name = this.constraintName(table, unique.name, "AK", unique.columns);
    const columns = this.keyColumns(table, unique);
    const method = mysql && unique.method ? ` USING ${unique.method.toUpperCase()}` : "";
    const equalNulls = unique.nulls === "not distinct" || unique.nulls === "oracle";
    const nulls = equalNulls ? this.nullsClause(table, unique) : "";
    if (!equalNulls) this.sqlServerNulls(table, unique.columns, unique.name ?? label);
    // Oracle : dans une clé composée, les NULL sont égaux entre eux (O-39).
    const nullable = (n: string) => !table.primaryKey.includes(n) && !table.columns.find((c) => c.name === n)?.notNull;
    if (!equalNulls && dbms === "oracle" && unique.columns.length > 1 && unique.columns.some(nullable)) this.loss("index", table.name, MSG.lossOracleCompositeNulls(unique.name ?? label));
    // INCLUDE sur une contrainte UNIQUE : PostgreSQL 11+ seulement (O-42).
    const include = unique.include?.length && dbms === "postgresql" ? this.include(table, unique) : "";
    if (unique.include?.length && !include) this.loss("index", table.name, MSG.lossInclude(unique.name ?? label));
    const definition = `${name ? `CONSTRAINT ${this.q(name)} ` : ""}UNIQUE${nulls}(${columns})${include}${method}${this.stateClause(table, "unique", unique.name ?? label, unique.state)}`;
    return this.place(table, definition, where, after, unique.state, () => this.constraintName(table, undefined, "AK", unique.columns, true)!);
  }

  /**
   * NULL égaux dans une clé composée (Oracle) ou NULLS NOT DISTINCT (PostgreSQL) (O-39) : PostgreSQL
   * 15+ l'exprime ; SQL Server et Oracle le font nativement ; ailleurs, signalé. Une ligne
   * entièrement NULL, qu'Oracle ignore, devient un doublon ailleurs : signalé si possible.
   */
  private nullsClause(table: LogicalTable, unique: LogicalKey): string {
    const { dbms, version } = this.target;
    const label = unique.name ?? describeKey(unique);
    const nullable = (name: string) => !table.primaryKey.includes(name) && !table.columns.find((c) => c.name === name)?.notNull;
    const allNullable = unique.columns.every(nullable);
    if (dbms === "oracle") {
      if (unique.nulls === "not distinct" && allNullable) this.loss("index", table.name, MSG.lossNullsAllNull(label));
      return "";
    }
    if (unique.nulls === "oracle" && allNullable && (dbms === "postgresql" || dbms === "sqlserver")) this.loss("index", table.name, MSG.lossNullsAllNull(label));
    if (dbms === "sqlserver") return "";
    if (dbms === "postgresql" && isAtLeast("postgresql", version, "15")) return " NULLS NOT DISTINCT";
    this.loss("index", table.name, MSG.lossNullsNotDistinct(label));
    return "";
  }

  /** SQL Server : une contrainte UNIQUE n'admet qu'un seul NULL, contrairement aux autres SGBD (O-39). */
  private sqlServerNulls(table: LogicalTable, columns: string[], label: string) {
    if (this.target.dbms !== "sqlserver") return;
    if (columns.some((name) => !table.primaryKey.includes(name) && !table.columns.find((c) => c.name === name)?.notNull)) {
      this.loss("index", table.name, MSG.lossSqlServerNulls(label));
    }
  }

  /** Index unique sur expression (LOWER(email)) ou conditionnel (… WHERE cond) (O-39). */
  private expressionIndex(table: LogicalTable, key: LogicalKey): string[] {
    const { dbms } = this.target;
    const label = key.name ?? describeKey(key);
    const tableName = this.tableName(table);
    const caseSensitive = (n: string) => Boolean(table.columns.find((c) => c.name === n)?.caseSensitive);
    let items: string | null = this.keyColumns(table, key);
    if (key.expression) {
      const { expression, dialect } = key.expression;
      // Index sur expression : PostgreSQL, Oracle, SQLite, DB2, MySQL 8.0.13+ ; pas SQL Server ni MariaDB.
      const supported = ["postgresql", "oracle", "sqlite", "db2"].includes(dbms) || (dbms === "mysql" && this.target.version !== "5.7");
      items = !supported
        ? null
        : sameDialect(dialect, dbms)
        ? expression
        : translateGenerated(expression, dialect, { target: this.target, columnType: (n) => table.columns.find((c) => c.name.toLowerCase() === n.toLowerCase())?.type, caseSensitive });
      // Élément d'index : appel de fonction tel quel, autre expression entre parenthèses.
      if (items && !sameDialect(dialect, dbms) && !/^\w+\(.*\)$/s.test(items)) items = /^\(.*\)$/s.test(items) ? items : `(${items})`;
      // MySQL : partie de clé fonctionnelle entre parenthèses.
      if (items && dbms === "mysql" && !sameDialect(dialect, dbms)) items = `(${items})`;
      if (!items) {
        this.loss("index", table.name, MSG.lossUniqueExpression(label));
        return [];
      }
    }
    let condition = "";
    if (key.where) {
      const { expression, dialect } = key.where;
      const rendered = sameDialect(dialect, dbms) ? expression : renderStructured(this, table, expression, dialect);
      if (!rendered || (!["postgresql", "sqlite", "sqlserver", "oracle"].includes(dbms)) || (dbms === "oracle" && key.expression)) {
        this.loss("index", table.name, MSG.lossUniqueWhere(label));
        return [];
      }
      // Oracle : pas d'index partiel — motif CASE WHEN cond THEN col END (les clés NULL ne sont pas indexées).
      if (dbms === "oracle") items = key.columns.map((c) => `CASE WHEN ${rendered} THEN ${this.columnRef(table, c)} END`).join(", ");
      else condition = ` WHERE ${rendered}`;
    }
    const name = this.q(this.constraintName(table, key.name, "AK", key.columns, true)!);
    return [`CREATE UNIQUE INDEX ${name} ON ${tableName}(${items})${this.include(table, key)}${condition};`];
  }

  /** Colonnes d'une clé, avec leurs préfixes MySQL `col(n)`. */
  private keyColumns(table: LogicalTable, key: LogicalKey): string {
    return key.columns.map((c, i) => `${this.columnRef(table, c)}${key.prefixes?.[i] ? `(${key.prefixes[i]})` : ""}`).join(", ");
  }

  /**
   * CREATE [UNIQUE] INDEX pour la cible : préfixes en index sur expression, plein texte (GIN en
   * PostgreSQL), méthode d'index ; ce qui n'a pas d'équivalent est signalé, rien n'est élargi (O-35).
   */
  private keyIndex(table: LogicalTable, index: LogicalKey, unique: boolean): string[] {
    const { dbms } = this.target;
    const mysql = dbms === "mysql" || dbms === "mariadb";
    const label = describeKey(index);
    const tableName = this.tableName(table);
    const name = this.q(this.constraintName(table, index.name, unique ? "AK" : "IX", index.columns, true)!);
    if (index.kind) {
      if (mysql) return [`CREATE ${index.kind.toUpperCase()} INDEX ${name} ON ${tableName}(${this.keyColumns(table, index)});`];
      if (dbms === "postgresql" && index.kind === "fulltext") {
        const text = index.columns.map((c) => `coalesce(${this.columnRef(table, c)}, '')`).join(" || ' ' || ");
        this.loss("index", table.name, MSG.lossFulltextGin(index.name ?? label));
        return [`CREATE INDEX ${name} ON ${tableName} USING GIN (to_tsvector('simple', ${index.columns.length === 1 ? this.columnRef(table, index.columns[0]!) : text}));`];
      }
      this.loss("index", table.name, MSG.lossIndexKind(index.name ?? label, index.kind.toUpperCase()));
      return [];
    }
    let items = this.keyColumns(table, index);
    if (index.prefixes && !mysql) {
      const prefix = (column: string, n: number) => {
        const ref = this.columnRef(table, column);
        switch (dbms) {
          case "postgresql":
            return `left(${ref}, ${n})`;
          case "sqlite":
          case "oracle":
            return `substr(${ref}, 1, ${n})`;
          default:
            return null;
        }
      };
      const parts = index.columns.map((c, i) => (index.prefixes![i] ? prefix(c, index.prefixes![i]!) : this.columnRef(table, c)));
      if (parts.some((p) => p === null)) {
        // Jamais élargi en UNIQUE / index sur la colonne entière : abandonné, et signalé.
        this.loss("index", table.name, MSG.lossPrefixKey(index.name ?? label, unique));
        return [];
      }
      items = parts.join(", ");
    }
    let method = "";
    if (index.method && index.method !== "btree") {
      if (mysql) method = ` USING ${index.method.toUpperCase()}`;
      else if (dbms === "postgresql" && !unique && ["hash", "gin", "gist", "brin", "spgist"].includes(index.method)) method = ` USING ${index.method.toUpperCase()}`;
      else if (!unique) this.loss("index", table.name, MSG.lossIndexMethod(index.name ?? label, index.method.toUpperCase()));
    }
    const using = dbms === "postgresql" ? method : "";
    const trailing = mysql ? method : "";
    return [`CREATE ${unique ? "UNIQUE " : ""}INDEX ${name} ON ${tableName}${using}(${items})${this.include(table, index)}${trailing};`];
  }

  /** INCLUDE (colonnes couvertes) : SQL Server, PostgreSQL 11+ ; ailleurs signalé (O-42). */
  private include(table: LogicalTable, key: LogicalKey): string {
    if (!key.include?.length) return "";
    const { dbms, version } = this.target;
    if (dbms === "sqlserver" || (dbms === "postgresql" && isAtLeast("postgresql", version, "11"))) {
      return ` INCLUDE (${key.include.map((c) => this.columnRef(table, c)).join(", ")})`;
    }
    this.loss("index", table.name, MSG.lossInclude(key.name ?? describeKey(key)));
    return "";
  }

  private readonly schemas = new Set<string>();

  /** CREATE SCHEMA en tête de script pour tout schéma source autre que celui par défaut (O-42). */
  declareSchema(schema: string | undefined, table: LogicalTable) {
    if (!schema) return;
    const target = this.schemaOf(schema);
    const { dbms } = this.target;
    if (!target) {
      if (!["postgresql", "sqlserver", "db2"].includes(dbms) && !["dbo", "public"].includes(schema.toLowerCase())) this.loss("name", table.name, MSG.lossSchema(schema));
      return;
    }
    if (this.schemas.has(target.toLowerCase()) || (dbms === "sqlserver" && target.toLowerCase() === "dbo")) return;
    this.schemas.add(target.toLowerCase());
    this.schemaStatements.push(
      dbms === "sqlserver" ? `IF SCHEMA_ID(N'${target}') IS NULL EXEC(N'CREATE SCHEMA ${this.q(target)}');` : `CREATE SCHEMA IF NOT EXISTS ${this.q(target)};`,
    );
  }

  private readonly schemaStatements: string[] = [];

  /** Commentaires : COMMENT ON (PostgreSQL, Oracle, DB2) ; MySQL les porte en ligne ; ailleurs signalés. */
  private comments(table: LogicalTable) {
    const { dbms } = this.target;
    const tableName = this.tableName(table);
    const commented = table.columns.filter((c) => c.comment);
    if (!table.comment && !commented.length) return;
    if (dbms === "mysql" || dbms === "mariadb") return;
    if (dbms === "postgresql" || dbms === "oracle" || dbms === "db2") {
      if (table.comment) this.epilogue.push(`COMMENT ON TABLE ${tableName} IS ${sqlString(table.comment)};`);
      for (const c of commented) this.epilogue.push(`COMMENT ON COLUMN ${tableName}.${this.q(c.name, c.caseSensitive)} IS ${sqlString(c.comment!)};`);
      return;
    }
    this.loss("comment", table.name, MSG.lossComments(Number(Boolean(table.comment)) + commented.length));
  }

  /** Déclencheurs : réémis vers le même dialecte, signalés sinon (leur code est propre au SGBD). */
  private triggers(table: LogicalTable) {
    for (const trigger of table.triggers ?? []) {
      if (sameDialect(trigger.dialect, this.target.dbms) && (this.target.dbms === "mysql" || this.target.dbms === "mariadb")) {
        this.epilogue.push(`DELIMITER $$\n${trigger.sql.trim().replace(/;?\s*$/, "")}$$\nDELIMITER ;`);
      } else if (sameDialect(trigger.dialect, this.target.dbms)) {
        this.epilogue.push(`${trigger.sql.trim().replace(/;?\s*$/, "")};`);
      } else {
        this.loss("trigger", table.name, MSG.lossTrigger(trigger.name));
      }
    }
  }

  run(model: LogicalModel): string {
    const tables = model.tables;
    for (const c of tables.flatMap((t) => t.columns)) {
      if (c.sequence) this.sequenceUsers.set(c.sequence.name.toLowerCase(), (this.sequenceUsers.get(c.sequence.name.toLowerCase()) ?? 0) + 1);
    }
    const alterAll = this.options.foreignKeysInAlter;
    const canAlter = supportsAlterForeignKey(this.target);
    if (alterAll && !canAlter) this.loss("option", "", MSG.lossAlterUnsupported());
    const { order, deferred } = planOrder(tables, alterAll && canAlter);
    // SQLite accepte les références vers des tables créées plus loin : tout reste en ligne.
    if (!canAlter) deferred.clear();
    const graph = this.target.dbms === "sqlserver" ? new CascadeGraph() : null;

    const statements = order.map((t) => this.createTable(tables, t, deferred, graph));
    for (const table of order) {
      for (const fk of table.foreignKeys) {
        if (!deferred.has(fk)) continue;
        const where = this.placement(table, "foreign", fk.name ?? `FOREIGN KEY(${fk.columns.join(", ")})`, fk.state);
        const alter = `ALTER TABLE ${this.tableName(table)} ADD ${this.foreignKey(tables, table, fk, graph)}`;
        if (where === "comment") statements.push(`-- ${alter}; -- ${MSG.disabledComment(fk.state?.dialect)}`);
        else statements.push(`${alter}${where === "after" ? (this.target.dbms === "oracle" ? " ENABLE NOVALIDATE" : " NOT VALID") : ""};`);
      }
    }
    // Clauses de stockage : une ligne du rapport pour toutes les tables concernées (O-39).
    const storage = [...new Set(order.flatMap((t) => t.storage ?? []))];
    if (storage.length) for (const table of order) if (table.storage?.length) this.loss("physical", table.name, MSG.lossStorage(storage.join(", ")));
    const indexes = this.options.indexes ? order.flatMap((table) => table.indexes.flatMap((index) => this.keyIndex(table, index, false))) : [];
    // Extensions et collations d'abord, puis schémas, séquences et tables (O-42).
    const head = this.preamble.filter((p) => /^CREATE (EXTENSION|COLLATION)/.test(p));
    const rest = this.preamble.filter((p) => !head.includes(p));
    return [...head, ...this.schemaStatements, ...rest, ...statements, ...this.notValidated, ...indexes, ...this.epilogue].join("\n\n");
  }
}

const sqlString = (value: string) => `'${value.replaceAll("'", "''")}'`;

const describeKey = (key: LogicalKey) => `(${key.columns.map((c, i) => (key.prefixes?.[i] ? `${c}(${key.prefixes[i]})` : c)).join(", ")})`;

/** Famille du type d'une colonne pour la cible (cohérence des CHECK, O-35). */
function familyOf(table: LogicalTable, name: string, target: Target): TypeFamily | undefined {
  const column = table.columns.find((c) => c.name.toLowerCase() === name.toLowerCase());
  const type = column?.type;
  if (!type) return undefined;
  if (column.domain) return "text";
  if (column.sourceType && sameDialect(column.sourceType.dialect, target.dbms)) return undefined;
  switch (type.kind) {
    case "integer":
    case "decimal":
    case "real":
    case "money":
    case "counter":
      return "number";
    case "text":
      return type.encoding === "binary" ? undefined : "text";
    case "date":
    case "time":
    case "datetime":
      return "temporal";
    case "boolean":
      return "boolean";
    case "free": {
      // Type libre réémis tel quel ou remplacé par du texte : famille d'après sa conversion.
      const fallback = column.sourceType ? freeTypeFallback(type.sql, target).sql : type.sql;
      const parsed = sqlTypeToDataType(fallback, false, target.dbms);
      return parsed && parsed.kind !== "free" ? familyOf({ ...table, columns: [{ ...column, type: parsed, sourceType: undefined }] }, name, target) : undefined;
    }
    default:
      return undefined;
  }
}

type Usage = { compared: boolean; keyed: boolean };

/** Emplois d'une colonne : comparée dans un CHECK, ou membre d'une clé ou d'un index. */
function usage(table: LogicalTable, column: string): Usage {
  const lower = column.toLowerCase();
  const cites = (expression: string) => referencedColumns(expression).some((c) => c.toLowerCase() === lower);
  const self = table.columns.find((c) => c.name === column);
  const keys = [table.primaryKey, ...table.uniques.map((u) => u.columns), ...table.indexes.map((i) => i.columns), ...table.foreignKeys.map((fk) => fk.columns)];
  return {
    compared: Boolean(self?.check && cites(self.check.expression)) || table.checks.some((c) => cites(c.expression)),
    keyed: Boolean(self?.unique) || keys.some((k) => k.some((c) => c.toLowerCase() === lower)),
  };
}

/**
 * Longueur imposée à un texte long que la cible ne sait pas comparer ou indexer :
 * Oracle et DB2 (LOB interdits dans les CHECK et les clés), MySQL (TEXT dans une clé : longueur
 * de préfixe obligatoire), SQL Server (VARCHAR(MAX) interdit dans une clé d'index).
 */
function boundedTextSize(target: Target, { compared, keyed }: Usage): number | undefined {
  switch (target.dbms) {
    case "oracle":
    case "db2":
      return compared || keyed ? 4000 : undefined;
    case "mysql":
    case "mariadb":
      return keyed ? 255 : undefined;
    case "sqlserver":
      return keyed ? 450 : undefined;
    default:
      return undefined;
  }
}

/** Réécrit une condition CHECK structurée pour la cible (`null` si hors du sous-ensemble). */
function renderStructured(generator: Generator, table: LogicalTable, expression: string, dialect?: SqlDialect): string | null {
  const condition = parseCondition(expression);
  if (!condition) return null;
  const caseSensitive = (name: string) => Boolean(table.columns.find((c) => c.name === name)?.caseSensitive);
  const translated = dialect === "sqlserver" ? sqlServerLikes(generator, booleanLiterals(condition, table), table) : booleanLiterals(condition, table);
  return translated && renderCondition(translated, generator.target, caseSensitive);
}

/**
 * LIKE SQL Server à classes ([A-Z], [^A-Z]) → expression rationnelle ancrée (O-42) : ~* sous collation
 * insensible à la casse ; COLLATE "C" si la colonne a une collation non déterministe (PostgreSQL n'y
 * applique pas les expressions rationnelles). Ailleurs qu'en PostgreSQL : `null` (non traduit).
 */
function sqlServerLikes(generator: Generator, c: Condition, table: LogicalTable): Condition | null {
  switch (c.kind) {
    case "and":
    case "or": {
      const items = c.items.map((item) => sqlServerLikes(generator, item, table));
      return items.every((i): i is Condition => i !== null) ? { ...c, items } : null;
    }
    case "not": {
      const item = sqlServerLikes(generator, c.item, table);
      return item && { ...c, item };
    }
    case "like": {
      const regex = c.pattern.kind === "string" ? likeToRegex(c.pattern.value) : null;
      if (!regex) return c;
      if (generator.target.dbms !== "postgresql") return null;
      const column = c.operand.kind === "column" ? table.columns.find((col) => col.name.toLowerCase() === (c.operand as { name: string }).name.toLowerCase()) : undefined;
      const klass = column ? generator.effectiveCollationClass(column) : undefined;
      const insensitive = klass === "ci" || klass === "ai_ci";
      const nondeterministic = insensitive && generator.icuCollations();
      return { kind: "regex", operand: c.operand, pattern: regex, negated: c.negated, insensitive, ...(nondeterministic ? { collateC: true } : {}) };
    }
    default:
      return c;
  }
}

/** Colonne booléenne comparée à 0 / 1 (BIT SQL Server, TINYINT(1) MySQL) : FALSE / TRUE (O-41). */
function booleanLiterals(c: Condition, table: LogicalTable): Condition {
  const isBoolean = (o: Operand) => o.kind === "column" && table.columns.find((col) => col.name.toLowerCase() === o.name.toLowerCase())?.type?.kind === "boolean";
  const literal = (o: Operand): Operand => (o.kind === "number" && (o.value === "0" || o.value === "1") ? { kind: "boolean", value: o.value === "1" } : o);
  switch (c.kind) {
    case "and":
    case "or":
      return { ...c, items: c.items.map((item) => booleanLiterals(item, table)) };
    case "not":
      return { ...c, item: booleanLiterals(c.item, table) };
    case "compare":
      return isBoolean(c.left) ? { ...c, right: literal(c.right) } : isBoolean(c.right) ? { ...c, left: literal(c.left) } : c;
    case "in":
      return isBoolean(c.operand) ? { ...c, values: c.values.map(literal) } : c;
    default:
      return c;
  }
}

/**
 * Graphe des cascades SQL Server : une nouvelle cascade est refusée si elle crée un second chemin
 * entre deux tables, ou un cycle (y compris réflexif).
 */
class CascadeGraph {
  private readonly edges: Record<"delete" | "update", Map<string, Set<string>>> = { delete: new Map(), update: new Map() };

  private reaches(event: "delete" | "update", from: string, to: string, seen = new Set<string>()): boolean {
    if (from === to) return true;
    if (seen.has(from)) return false;
    seen.add(from);
    for (const next of this.edges[event].get(from) ?? []) if (this.reaches(event, next, to, seen)) return true;
    return false;
  }

  accept(event: "delete" | "update", referenced: string, child: string): boolean {
    if (referenced === child || this.reaches(event, referenced, child) || this.reaches(event, child, referenced)) return false;
    const targets = this.edges[event].get(referenced) ?? new Set<string>();
    targets.add(child);
    this.edges[event].set(referenced, targets);
    return true;
  }
}

/** Équivalents des types libres courants (UUID, JSON, INTERVAL) ; sinon texte, avec perte. */
function freeTypeFallback(sql: string, target: Target): { sql: string; lossy: boolean; loss?: string } {
  const base = sql.trim().toLowerCase().replace(/\(.*\)/, "");
  const { dbms } = target;
  // ROWVERSION / TIMESTAMP SQL Server : numéro de version automatique, sans équivalent (O-41).
  if (base === "rowversion" && dbms !== "sqlserver") {
    const binary = { postgresql: "BYTEA", mysql: "BINARY(8)", mariadb: "BINARY(8)", oracle: "RAW(8)", db2: "BINARY(8)", sqlite: "BLOB" }[dbms as string] ?? "VARBINARY(8)";
    return { sql: binary, lossy: false, loss: MSG.lossRowversion(binary) };
  }
  // INTERVAL Oracle → PostgreSQL : la précision du premier champ (jours, années) n'y existe pas (O-39).
  const interval = /^interval\s+(day|year)\s*(?:\(\s*(\d+)\s*\))?\s+to\s+(second|month)\s*(?:\(\s*(\d+)\s*\))?$/i.exec(sql.trim());
  if (interval && dbms === "postgresql") {
    const [, first, , last, fraction] = interval;
    const emitted = `INTERVAL ${first!.toUpperCase()} TO ${last!.toUpperCase()}${fraction !== undefined ? `(${fraction})` : ""}`;
    return { sql: emitted, lossy: false, loss: MSG.lossIntervalDays(sql.trim(), emitted) };
  }
  const table: Record<string, Partial<Record<Dbms, string>>> = {
    uuid: { postgresql: "UUID", sqlserver: "UNIQUEIDENTIFIER", mysql: "CHAR(36)", mariadb: "UUID", oracle: "RAW(16)", sqlite: "TEXT", db2: "CHAR(36)" },
    uniqueidentifier: { postgresql: "UUID", sqlserver: "UNIQUEIDENTIFIER", mysql: "CHAR(36)", mariadb: "UUID", oracle: "RAW(16)", sqlite: "TEXT", db2: "CHAR(36)" },
    // PostgreSQL : JSONB, comme le JSON de MySQL (forme binaire normalisée, comparable, indexable) (O-37).
    json: { postgresql: "JSONB", mysql: "JSON", mariadb: "JSON", sqlserver: "NVARCHAR(MAX)", oracle: "CLOB", sqlite: "TEXT", db2: "CLOB" },
    jsonb: { postgresql: "JSONB", mysql: "JSON", mariadb: "JSON", sqlserver: "NVARCHAR(MAX)", oracle: "CLOB", sqlite: "TEXT", db2: "CLOB" },
  };
  const known = table[base]?.[dbms];
  if (known) return { sql: known, lossy: !["uuid", "json", "jsonb", "uniqueidentifier"].includes(known.toLowerCase()) };
  const text = sqlType({ kind: "text", encoding: "unicode", length: "large" }, dbms, target.version, target.custom?.types) ?? "TEXT";
  return { sql: text, lossy: true };
}

const describe = (type: DataType) => JSON.stringify(type);

/** En-tête du script : rapport de pertes en commentaire SQL. */
function header(target: Target, losses: Loss[]): string {
  const label = `${DBMS_LIST.find((d) => d.id === target.dbms)?.label ?? target.dbms}${target.version && target.version !== GENERIC_VERSION ? ` ${target.version}` : ""}`;
  // SGBD personnalisé : toujours annoncé, pour qu'on sache que ce n'est plus le SGBD tel quel (O-59).
  const custom = target.custom ? [`-- ${MSG.customDbmsHeader(target.custom.name, label)}`, ""] : [];
  if (!losses.length) return custom.length ? [...custom, ""].join("\n") : "";
  const lines = groupLosses(losses).map((g) => `--   • ${formatLossGroup(g)}`);
  return [...custom, `-- ${MSG.lossHeader(target.custom?.name ?? label, losses.length)}`, ...lines, "", ""].join("\n");
}

export function generateDdl(model: LogicalModel, target: SqlTarget, options: Partial<DdlOptions> = {}): DdlResult {
  if (hasErrors(model)) return { ok: false, error: MSG.sqlBlocked };
  const generator = new Generator(target, { ...DEFAULT_OPTIONS, ...options });
  const body = generator.run(model);
  const sql = body ? `${header(target, generator.report.entries)}${body}\n` : "";
  return { ok: true, sql, losses: generator.report.entries };
}
