import { sqlType } from "../dbms/typeMapping";
import type { LogicalColumn, LogicalTable } from "../mld/logical";
import type { DataType } from "../model/datatype";
import type { SqlDialect } from "../model/physical";
import { integerRange, sqlTypeToDataType } from "../reverse/types";
import { MSG } from "../validation/messages";
import { collationClass, translateCollation } from "./collation";
import { activeConditions, type Context, describe } from "./context";
import { fitName, sameDialect, sqliteAffinity } from "./dialects";
import { excludesEmptyString, impliesNonNegative, referencedColumns, valueBounds } from "./expressions";
import { columnRef, q } from "./naming";
import { sourceLosses } from "./sources";
import type { Usage } from "./targets";

/**
 * Type de la colonne pour la cible, et CHECK qu'il implique (domaine ENUM / SET, non-signé).
 * Chaque écart avec la source est signalé une fois, avec ce qui est réellement émis (O-35).
 */
export function typeOf(
  ctx: Context,
  table: LogicalTable,
  column: LogicalColumn,
  inlinePrimaryKey: boolean,
): { sql: string | null; checks: string[] } {
  const { dbms, version } = ctx.target;
  const d = ctx.dialect.types;
  const counters = ctx.dialect.counters;
  const checks: string[] = [];
  const ref = () => columnRef(ctx, table, column.name);
  const loss = (category: "type" | "domain" | "unsigned" | "autoIncrement", message: string) =>
    ctx.report.add(category, table.name, message, column.name);
  const source = column.sourceType;
  const same = Boolean(source && sameDialect(source.dialect, dbms));
  const type = column.type && column.type.kind === "text" ? { ...column.type, collation: undefined } : column.type;
  const collate = collationClause(ctx, table, column, same ? source?.dialect : column.sourceType?.dialect);

  // Type d'origine, réémis tel quel vers le même dialecte (UNSIGNED, ENUM, SET, YEAR compris).
  if (same && type?.kind !== "counter") return { sql: source!.sql + collate, checks };
  if (!type) return { sql: null, checks };

  // Domaine énuméré (O-35) : le domaine Merise, exprimé selon la cible.
  const domain = column.domain;
  if (domain) {
    const list = domain.values.map((v) => `'${v.replaceAll("'", "''")}'`).join(", ");
    if (d.nativeDomains) return { sql: `${domain.kind.toUpperCase()}(${list})${collate}`, checks };
    if (domain.kind === "enum") {
      if (d.enumTypes && ctx.options.enums === "type") return { sql: enumType(ctx, table, column, list), checks };
      checks.push(`${ref()} IN (${list})`);
      // MySQL ramène une valeur saisie dans une autre casse (ACTIF) à la valeur de l'ENUM (actif) (O-38).
      const klass =
        column.type?.kind === "text" && column.type.collation ? collationClass(column.type.collation) : undefined;
      if (klass === "ci" || klass === "ai_ci") {
        const insensitive = collate.trim() !== "" && ctx.options.collations !== "deterministic";
        loss("domain", MSG.lossEnumCase(insensitive));
      }
    } else if (d.setArrays && ctx.options.sets === "array") {
      checks.push(`${ref()} <@ ARRAY[${list}]::text[]`);
      // MySQL ordonne les membres d'un SET et en retire les doublons ; un tableau les garde (O-38).
      loss("domain", MSG.lossSetArray());
      return { sql: `TEXT[]${collate}`, checks };
    } else {
      loss("domain", MSG.lossSet(domain.values.join(", ")));
    }
  }

  // Non signé (O-35) : MySQL l'exprime ; ailleurs, type élargi ou CHECK (>= 0), selon l'option.
  let effective: DataType = type;
  if (column.unsigned && !d.unsigned) {
    if (type.kind === "decimal" || type.kind === "real" || type.kind === "money") checks.push(`${ref()} >= 0`);
    else if ((type.kind === "integer" || type.kind === "counter") && ctx.options.unsigned === "check") {
      checks.push(`${ref()} >= 0`);
      // Clé étrangère : sa plage découle de la clé référencée, qui seule porte l'entrée (O-40).
      if (!column.foreign) loss("unsigned", MSG.lossUnsignedCheck(source?.sql ?? describe(type)));
    } else if (type.kind === "integer" || type.kind === "counter") {
      // Type élargi : plage couverte. Les négatifs restent interdits par un CHECK (>= 0), sauf
      // sur une clé étrangère (bornée par la colonne référencée) ou si un CHECK les exclut déjà (O-37).
      // TINYINT SQL Server : 0 à 255, toujours rétabli par un CHECK, même si un autre CHECK existe (O-42).
      if (!column.foreign && source?.dialect === "sqlserver" && /^\s*tinyint\b/i.test(source.sql))
        checks.push(`${ref()} BETWEEN 0 AND 255`);
      else if (!column.foreign && !alreadyNonNegative(table, column)) checks.push(`${ref()} >= 0`);
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
  if (
    source?.dialect === "oracle" &&
    /^date$/i.test(source.sql.trim()) &&
    effective.kind === "datetime" &&
    ctx.options.oracleDates === "date"
  ) {
    const sql = sqlType({ kind: "date" }, dbms, version, ctx.target.custom?.types) ?? "DATE";
    loss("type", MSG.lossOracleDate(sql));
    return { sql, checks };
  }

  if (effective.kind === "counter") {
    let sql = sqlType(effective, dbms, version, ctx.target.custom?.types) ?? "INTEGER";
    // Oracle vers Oracle : le type d'origine du compteur (NUMBER(10)) est conservé (O-39).
    if (same && counters.keepSourceType) sql = counters.keepSourceType(sql, source!.sql);
    // Sans IDENTITY / SERIAL… (SQLite hors clé primaire simple, Oracle avant 12c) : simple entier.
    const native = /identity|serial|auto_?increment|counter/i.test(sql) || inlinePrimaryKey;
    if (!native) loss("autoIncrement", MSG.lossAutoIncrement());
    if (counters.narrowOnly && effective.bits === 64)
      loss("type", MSG.lossType("BIGINT AUTOINCREMENT", counters.narrowOnly));
    sql = identityStart(ctx, table, column, sql);
    if (d.unsigned && column.unsigned) sql = sql.replace(/^(\w+)/, "$1 UNSIGNED");
    // GENERATED ALWAYS / BY DEFAULT ON NULL (O-39). MySQL : un NULL reçoit déjà une valeur.
    if (column.identity === "always") {
      // SQL Server : IDENTITY refuse déjà une valeur fournie (O-42).
      if (/BY DEFAULT AS IDENTITY/i.test(sql)) sql = sql.replace(/BY DEFAULT AS IDENTITY/i, "ALWAYS AS IDENTITY");
      else if (!counters.rejectsExplicitValues) loss("autoIncrement", MSG.lossIdentityAlways());
    } else if (counters.rejectsExplicitValues && /IDENTITY/i.test(sql) && source && !same) {
      // Vers SQL Server : IDENTITY refuse une valeur fournie, que la source acceptait (O-42).
      loss("autoIncrement", MSG.lossSqlServerIdentity());
    } else if (column.identity === "on null" && !counters.nullTakesNextValue) {
      if (counters.onNullIdentity && /BY DEFAULT AS IDENTITY/i.test(sql))
        sql = sql.replace(/BY DEFAULT AS IDENTITY/i, "BY DEFAULT ON NULL AS IDENTITY");
      else loss("autoIncrement", MSG.lossIdentityOnNull());
    }
    if (/^\s*number\b/i.test(source?.sql ?? "") || /^NUMBER\(/i.test(sql))
      integerLosses(ctx, table, column, sql, checks);
    return { sql, checks };
  }

  // Décimal (O-39) : sans précision (Oracle NUMBER, NUMERIC), échelle négative (NUMBER(12,-3)).
  if (effective.kind === "decimal") {
    const unbounded = d.unboundedDecimal;
    if (effective.precision === undefined && unbounded !== "native") {
      if ("sql" in unbounded) return { sql: unbounded.sql, checks };
      const bounded =
        sqlType({ kind: "decimal", ...unbounded }, dbms, version, ctx.target.custom?.types) ?? "DECIMAL(38,10)";
      loss("type", MSG.lossDecimalUnbounded(source?.sql ?? "NUMERIC", bounded));
      return { sql: bounded, checks };
    }
    if (effective.scale < 0 && !d.negativeScale) {
      const widened =
        sqlType(
          { kind: "decimal", precision: (effective.precision ?? 38) - effective.scale, scale: 0 },
          dbms,
          version,
          ctx.target.custom?.types,
        ) ?? "NUMERIC";
      loss("type", MSG.lossNegativeScale(source?.sql ?? describe(effective), widened));
      return { sql: widened, checks };
    }
  }

  // Type libre venu d'un autre dialecte : équivalents connus, sinon texte.
  if (effective.kind === "free" && source) {
    const fallback = freeTypeFallback(ctx, effective.sql);
    if (fallback.loss) loss("type", fallback.loss);
    else if (fallback.lossy) loss("type", MSG.lossType(effective.sql, fallback.sql));
    // RAW(16) DEFAULT SYS_GUID() lu comme UUID (O-39) : approximation.
    if (
      source.dialect === "oracle" &&
      /^raw\b/i.test(source.sql.trim()) &&
      /^(uuid|uniqueidentifier)$/i.test(fallback.sql)
    )
      loss("type", MSG.lossRawUuid());
    return { sql: fallback.sql + collate, checks };
  }
  // Texte long (LOB) là où la cible ne sait pas le comparer : borné, avec perte.
  const bound =
    effective.kind === "text" && effective.length === "large" && effective.encoding !== "binary"
      ? d.boundedText(usage(table, column.name))
      : undefined;
  if (effective.kind === "text" && bound !== undefined) {
    const bounded = sqlType(
      { ...effective, length: "variable", size: bound },
      dbms,
      version,
      ctx.target.custom?.types,
    )!;
    if (!column.foreign)
      loss(
        "type",
        MSG.lossType(source?.sql ?? sqlType(effective, dbms, version, ctx.target.custom?.types) ?? "TEXT", bounded),
      );
    return { sql: bounded + collate, checks };
  }
  let sql = sqlType(effective, dbms, version, ctx.target.custom?.types);
  if (d.boundedBinary && effective.kind === "text" && effective.encoding === "binary" && effective.length !== "large") {
    if (!column.foreign) loss("type", MSG.lossType(source?.sql ?? describe(effective), d.boundedBinary));
    return { sql: d.boundedBinary, checks };
  }
  if (sql === null) {
    loss("type", MSG.lossType(source?.sql ?? effective.kind, "—"));
    return { sql: null, checks };
  }
  // Entiers à plage décimale (Oracle NUMBER(p), NUMBER) : comparés par leur plage (O-39).
  const digits = effective.kind === "integer" && (/^\s*number\b/i.test(source?.sql ?? "") || /^NUMBER\(/i.test(sql));
  if (effective !== type) {
    // Élargi pour couvrir la plage, négatifs exclus (CHECK ou clé étrangère) : rien de perdu.
  } else if (d.affinities) {
    // Affinités seules (SQLite : TEXT, INTEGER, NUMERIC…) : seul un changement d'affinité compte.
    if (source && !domain && sqliteAffinity(source.sql) !== sqliteAffinity(sql))
      loss("type", MSG.lossType(source.sql, sql));
  } else if (digits) {
    integerLosses(ctx, table, column, sql, checks);
  } else if (column.foreign && (effective.kind === "integer" || effective.kind === "text")) {
    // Clé étrangère : plage et longueur découlent de la clé référencée, qui seule porte l'entrée (O-40).
  } else if (effective.kind !== "free" && !domain && !sameType(sqlTypeToDataType(sql, false, dbms), effective)) {
    loss("type", MSG.lossType(source?.sql ?? describe(effective), sql));
  }
  if (d.unsigned && column.unsigned && (effective.kind === "integer" || effective.kind === "decimal"))
    sql += " UNSIGNED";
  // TINYINT(1) lu comme booléen : MySQL y accepte d'autres valeurs que 0 / 1 (−128 à 127) (O-38).
  if (source && /^tinyint\s*\(\s*1\s*\)/i.test(source.sql) && effective.kind === "boolean" && !d.tinyintBoolean) {
    loss("type", MSG.lossTinyintBoolean(sql));
  }
  // Ici, la source est d'un autre dialecte (le même dialecte a réémis le type d'origine).
  sourceLosses(ctx, table, column, sql, effective, checks);
  // Types spatiaux vers PostgreSQL (O-42) : CREATE EXTENSION postgis en tête (option par défaut), ou
  // repli sans extension — BYTEA (WKB) ou TEXT (WKT) —, signalé ; le script s'exécute sans PostGIS.
  if ((effective.kind === "geography" || effective.kind === "geometry") && d.postgis) {
    if (ctx.options.spatial === "postgis") {
      const extension = "CREATE EXTENSION IF NOT EXISTS postgis;";
      if (!ctx.script.preamble.includes(extension)) ctx.script.preamble.unshift(extension);
    } else {
      const fallback = ctx.options.spatial === "wkb" ? "BYTEA" : "TEXT";
      loss("type", MSG.lossSpatialFallback(sql, fallback));
      return { sql: fallback, checks };
    }
  }
  // Vers Oracle (O-39) : longueur en caractères, comme à la source ; la chaîne vide y vaut NULL.
  if (d.emptyStringIsNull && source && effective.kind === "text" && effective.encoding !== "binary") {
    sql = d.textLength(sql);
    const rejected = activeConditions(table, column).some((c) => excludesEmptyString(c, column.name));
    const notNull = column.notNull || table.primaryKey.includes(column.name);
    if (!rejected || !notNull) loss("domain", MSG.lossToOracleEmptyString(notNull));
  }
  return { sql: sql + collate, checks };
}

/**
 * Entier issu d'un NUMBER Oracle (O-39) : NUMBER sans précision devenu entier (séquence, identité,
 * clé qui la référence) ; plage élargie (NUMBER(4) → SMALLINT) sauf si un CHECK la borne.
 */
function integerLosses(ctx: Context, table: LogicalTable, column: LogicalColumn, sql: string, checks: string[]) {
  const source = column.sourceType;
  // Clé étrangère : type et plage découlent de la clé référencée, qui seule porte l'entrée (O-40).
  if (!source || column.foreign) return;
  const emitted = sql.replace(/\s+(GENERATED|IDENTITY|AUTO_INCREMENT)\b.*$/i, "").trim();
  if (source.dialect === "oracle" && /^number$/i.test(source.sql.trim())) {
    const why = column.sequence ? "sequence" : column.type?.kind === "counter" ? "identity" : "reference";
    ctx.report.add("type", table.name, MSG.lossNumberInteger(source.sql, emitted, why), column.name);
    return;
  }
  const from = integerRange(source.sql, source.dialect);
  const to = integerRange(emitted, ctx.target.dbms);
  if (!from || !to || (to[0] >= from[0] && to[1] <= from[1])) return;
  // Bornes que les CHECK actifs de la colonne et de la table imposent à ses valeurs.
  const bounds = valueBounds({ kind: "and", items: activeConditions(table, column) }, column.name);
  if (bounds === "none") return;
  const lo = bounds.lo !== null && bounds.lo > to[0] ? bounds.lo : to[0];
  const hi = bounds.hi !== null && bounds.hi < to[1] ? bounds.hi : to[1];
  if (lo >= from[0] && hi <= from[1]) return;
  // Fidélité stricte (option) : la plage d'origine est rétablie par un CHECK (O-40).
  if (ctx.options.strictRanges) {
    checks.push(`${columnRef(ctx, table, column.name)} BETWEEN ${from[0]} AND ${from[1]}`);
    return;
  }
  ctx.report.add("type", table.name, MSG.lossRangeWidened(source.sql, emitted), column.name);
}

/** Un CHECK de la colonne (ou de la table, ne portant que sur elle) exclut-il déjà les négatifs ? */
function alreadyNonNegative(table: LogicalTable, column: LogicalColumn): boolean {
  return activeConditions(table, column).some((c) => impliesNonNegative(c, column.name));
}

/** Clause COLLATE pour la cible (vide si sans objet) ; une collation intransposable est signalée. */
function collationClause(
  ctx: Context,
  table: LogicalTable,
  column: LogicalColumn,
  source: SqlDialect | undefined,
): string {
  const name = column.type?.kind === "text" ? (column.type.collation ?? assumedCollation(ctx, column)) : undefined;
  if (!name) return "";
  const result = translateCollation(name, source, ctx.target, ctx.options.collations !== "deterministic");
  if (result.kind === "dropped") {
    ctx.report.add("collation", table.name, MSG.lossCollation(name), column.name);
    return "";
  }
  if (result.preamble && !ctx.script.preamble.includes(result.preamble)) ctx.script.preamble.unshift(result.preamble);
  if (result.approximation)
    ctx.report.add("collation", table.name, MSG.lossCollationApprox(name, result.approximation), column.name);
  if (
    column.domain &&
    ctx.dialect.types.enumTypes &&
    ctx.options.enums === "type" &&
    column.domain.kind === "enum" &&
    result.sql
  ) {
    ctx.report.add("collation", table.name, MSG.lossCollationEnumType(name), column.name);
  }
  return result.sql ? ` ${result.sql}` : "";
}

/**
 * Collation supposée d'un texte SQL Server sans collation déclarée (celle de la base, absente du
 * script) : CI_AS par défaut (option) ; l'hypothèse est rappelée une fois au rapport (O-42).
 */
function assumedCollation(ctx: Context, column: LogicalColumn): string | undefined {
  const source = column.sourceType;
  if (source?.dialect !== "sqlserver" || sameDialect(source.dialect, ctx.target.dbms)) return undefined;
  if (column.type?.kind !== "text" || column.type.encoding === "binary") return undefined;
  const name = { ci_as: "Latin1_General_CI_AS", ci_ai: "Latin1_General_CI_AI", cs_as: "Latin1_General_CS_AS" }[
    ctx.options.sqlServerCollation
  ];
  if (!ctx.report.has(MSG.lossSqlServerCollation(name)))
    ctx.report.add("collation", "", MSG.lossSqlServerCollation(name));
  return name;
}

/** Collations insensibles émises comme collations ICU non déterministes (PostgreSQL) ? */
export function icuCollations(ctx: Context): boolean {
  return ctx.dialect.types.nondeterministicCollations && ctx.options.collations !== "deterministic";
}

/** Classe de collation effective d'une colonne (déclarée ou supposée) (O-42). */
export function effectiveCollationClass(ctx: Context, column: LogicalColumn) {
  const name = column.type?.kind === "text" ? (column.type.collation ?? assumedCollation(ctx, column)) : undefined;
  return name ? collationClass(name) : undefined;
}

/** Type énuméré PostgreSQL (option « type ») : déclaré avant les tables. */
function enumType(ctx: Context, table: LogicalTable, column: LogicalColumn, list: string): string {
  const name = fitName(`${table.name}_${column.name}`.toLowerCase(), ctx.maxName);
  ctx.script.preamble.push(`CREATE TYPE ${q(ctx, name)} AS ENUM (${list});`);
  return q(ctx, name);
}

/** Première valeur du compteur (AUTO_INCREMENT = n, START WITH n). */
function identityStart(ctx: Context, table: LogicalTable, column: LogicalColumn, sql: string): string {
  const start = table.identityStart;
  // Pas du compteur : IDENTITY(100, 10), INCREMENT BY 10 (O-41).
  const step = table.identityStep;
  if ((start === undefined && step === undefined) || !table.primaryKey.includes(column.name)) return sql;
  const counters = ctx.dialect.counters;
  if (/AS IDENTITY$/i.test(sql)) {
    return `${sql} (${[start !== undefined ? `START WITH ${start}` : "", step !== undefined ? `INCREMENT BY ${step}` : ""].filter(Boolean).join(" ")})`;
  }
  const seeded = counters.seed?.(sql, start, step);
  if (seeded) return seeded;
  if (step !== undefined) ctx.report.add("autoIncrement", table.name, MSG.lossIdentityStep(step), column.name);
  if (start === undefined) return sql;
  if (counters.startOption) {
    ctx.script.tableOptions.set(table, counters.startOption(start));
    return sql;
  }
  ctx.report.add("autoIncrement", table.name, MSG.lossIdentityStart(start), column.name);
  return sql;
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

/** Emplois d'une colonne : comparée dans un CHECK, ou membre d'une clé ou d'un index. */
function usage(table: LogicalTable, column: string): Usage {
  const lower = column.toLowerCase();
  const cites = (expression: string) => referencedColumns(expression).some((c) => c.toLowerCase() === lower);
  const self = table.columns.find((c) => c.name === column);
  const keys = [
    table.primaryKey,
    ...table.uniques.map((u) => u.columns),
    ...table.indexes.map((i) => i.columns),
    ...table.foreignKeys.map((fk) => fk.columns),
  ];
  return {
    compared: Boolean(self?.check && cites(self.check.expression)) || table.checks.some((c) => cites(c.expression)),
    keyed: Boolean(self?.unique) || keys.some((k) => k.some((c) => c.toLowerCase() === lower)),
  };
}

/** Équivalents des types libres courants (UUID, JSON, INTERVAL) ; sinon texte, avec perte. */
export function freeTypeFallback(ctx: Context, sql: string): { sql: string; lossy: boolean; loss?: string } {
  const base = sql
    .trim()
    .toLowerCase()
    .replace(/\(.*\)/, "");
  const { free } = ctx.dialect.types;
  // ROWVERSION / TIMESTAMP SQL Server : numéro de version automatique, sans équivalent (O-41).
  if (base === "rowversion" && free.rowversion)
    return { sql: free.rowversion, lossy: false, loss: MSG.lossRowversion(free.rowversion) };
  // INTERVAL Oracle → PostgreSQL : la précision du premier champ (jours, années) n'y existe pas (O-39).
  const interval = /^interval\s+(day|year)\s*(?:\(\s*(\d+)\s*\))?\s+to\s+(second|month)\s*(?:\(\s*(\d+)\s*\))?$/i.exec(
    sql.trim(),
  );
  if (interval && free.intervals) {
    const [, first, , last, fraction] = interval;
    const emitted = `INTERVAL ${first!.toUpperCase()} TO ${last!.toUpperCase()}${fraction !== undefined ? `(${fraction})` : ""}`;
    return { sql: emitted, lossy: false, loss: MSG.lossIntervalDays(sql.trim(), emitted) };
  }
  const known =
    base === "uuid" || base === "uniqueidentifier"
      ? free.uuid
      : base === "json" || base === "jsonb"
        ? free.json
        : undefined;
  if (known) return { sql: known, lossy: !["uuid", "json", "jsonb", "uniqueidentifier"].includes(known.toLowerCase()) };
  const { dbms, version, custom } = ctx.target;
  const text = sqlType({ kind: "text", encoding: "unicode", length: "large" }, dbms, version, custom?.types) ?? "TEXT";
  return { sql: text, lossy: true };
}
