import type { DataType } from "../model/datatype";
import type { SqlDialect } from "../model/physical";

/**
 * Type SQL (tous dialectes) → type conceptuel (override O-28), pour pouvoir regénérer le
 * script vers n'importe quel SGBD. Un type sans équivalent conceptuel (UUID, JSON, ENUM,
 * INTERVAL…) devient un type « Libre » qui conserve le texte d'origine.
 *
 * `dialect` lève les ambiguïtés : REAL est un réel double en SQLite, FLOAT un réel simple en MySQL.
 */
export function sqlTypeToDataType(sqlType: string, autoIncrement = false, dialect?: SqlDialect): DataType | undefined {
  const text = sqlType.trim();
  if (!text) {
    return autoIncrement ? { kind: "counter" } : undefined;
  }
  const t = typeParts(text, dialect);
  return (
    counterOf(t, autoIncrement) ??
    textOf(t) ??
    binaryOf(t) ??
    integerOf(t) ??
    decimalOf(t) ??
    realOf(t) ??
    dateOf(t) ??
    dateTimeOf(t) ??
    otherOf(t) ?? { kind: "free", sql: text }
  );
}

/** Parties d'un type SQL : nom sans arguments ni modificateurs, arguments, dialecte. */
interface TypeParts {
  text: string;
  base: string;
  /** Premier argument (longueur, précision), `undefined` s'il manque ou vaut MAX. */
  n: number | undefined;
  scale: number | undefined;
  /** Longueur MAX (SQL Server). */
  large: boolean;
  dialect: SqlDialect | undefined;
}

function typeParts(text: string, dialect: SqlDialect | undefined): TypeParts {
  const lower = text.toLowerCase();
  // Arguments, échelle négative comprise (Oracle NUMBER(12,-3)) (O-39).
  const args = [...(/\(([^)]*)\)/.exec(lower)?.[1] ?? "").replace(/-\s+/g, "-").matchAll(/-?\d+|max/g)].map(
    (m) => m[0],
  );
  const n = args[0] === "max" ? undefined : args[0] === undefined ? undefined : Number(args[0]);
  const scale = args[1] === undefined ? undefined : Number(args[1]);
  // Nom du type sans arguments ni modificateurs MySQL.
  const base = lower
    .replace(/\([^)]*\)/g, " ")
    .replace(/\b(unsigned|signed|zerofill)\b/g, "")
    .replace("without time zone", "")
    .replace(/\s+/g, " ")
    .trim();
  const large = args[0] === "max";
  return { text, base, n, scale, large, dialect };
}

/** Compteurs (auto-incrément, SERIAL…). */
function counterOf(t: TypeParts, autoIncrement: boolean): DataType | undefined {
  const { base, n } = t;
  // Compteurs (64 bits : BIGSERIAL, BIGINT AUTO_INCREMENT / IDENTITY, NUMBER(10+) ou NUMBER IDENTITY…)
  const wide = /^(bigserial|serial8|bigint|int8)$/.test(base) || (base === "number" && (n === undefined || n > 9));
  if (autoIncrement || /^(small|big)?serial\d?$/.test(base) || ["counter", "autoincrement"].includes(base)) {
    return wide ? { kind: "counter", bits: 64 } : { kind: "counter" };
  }
  return undefined;
}

/** Texte. */
function textOf(t: TypeParts): DataType | undefined {
  const { base, n, large } = t;
  const unicode = /^(n|national\b)/.test(base) || /\bunicode\b/.test(base);
  const encoding = unicode ? "unicode" : "ascii";
  if (/^(n?clob|n?text|ntext|longtext|mediumtext|tinytext|long|long varchar|memo|citext)$/.test(base)) {
    return { kind: "text", encoding, length: "large" };
  }
  if (
    /^(n?varchar2?|character varying|char varying|national character varying|national char varying|varchar_ignorecase|string)$/.test(
      base,
    )
  ) {
    return large
      ? { kind: "text", encoding, length: "large" }
      : { kind: "text", encoding, length: "variable", size: n };
  }
  if (/^(n?char|character|nchar|national character|national char|bpchar)$/.test(base)) {
    return { kind: "text", encoding, length: "fixed", size: n ?? 1 };
  }
  return undefined;
}

/** Binaire. */
function binaryOf(t: TypeParts): DataType | undefined {
  const { base, n, large } = t;
  if (/^(blob|longblob|mediumblob|tinyblob|bytea|image|long raw)$/.test(base) || (base === "varbinary" && large)) {
    return { kind: "text", encoding: "binary", length: "large" };
  }
  if (/^(varbinary|raw|bit varying|varbit)$/.test(base)) {
    return { kind: "text", encoding: "binary", length: "variable", size: n };
  }
  if (base === "binary") {
    return { kind: "text", encoding: "binary", length: "fixed", size: n ?? 1 };
  }
  if (base === "bit") {
    return n !== undefined && n > 1
      ? { kind: "text", encoding: "binary", length: "fixed", size: n }
      : { kind: "boolean" };
  }
  return undefined;
}

/** Entiers. */
function integerOf(t: TypeParts): DataType | undefined {
  const { base, n, scale } = t;
  // TINYINT(1) : booléen par convention MySQL.
  if (/^(tinyint|int1|byte)$/.test(base)) {
    return base === "tinyint" && n === 1 ? { kind: "boolean" } : { kind: "integer", bits: 8 };
  }
  if (/^(smallint|int2|short)$/.test(base)) {
    return { kind: "integer", bits: 16 };
  }
  if (/^(mediumint|int|integer|int4|long integer)$/.test(base)) {
    return { kind: "integer", bits: 32 };
  }
  if (/^(bigint|int8)$/.test(base)) {
    return { kind: "integer", bits: 64 };
  }
  // Oracle NUMBER(p) / NUMBER(p,0) (O-39) : p ≤ 4 → 16 bits, ≤ 9 → 32, ≤ 18 → 64, au-delà décimal.
  if (base === "number" && n !== undefined && (scale === undefined || scale === 0)) {
    return numberInteger(n);
  }
  return undefined;
}

function numberInteger(n: number): DataType {
  if (n <= 18) {
    return { kind: "integer", bits: n <= 4 ? 16 : n <= 9 ? 32 : 64 };
  }
  return { kind: "decimal", precision: n, scale: 0 };
}

/** Décimaux et monétaire. */
function decimalOf(t: TypeParts): DataType | undefined {
  const { base, n, scale } = t;
  // Décimaux, réels, monétaire. NUMBER / NUMERIC sans précision : décimal libre, jamais un flottant (O-39).
  if (/^(decimal|numeric|dec|number|fixed)$/.test(base)) {
    if ((base === "number" || base === "numeric") && n === undefined) {
      return { kind: "decimal", scale: 0 };
    }
    return { kind: "decimal", precision: n ?? 18, scale: scale ?? 0 };
  }
  // SMALLMONEY : décimal à 4 décimales sur 10 chiffres (O-42) ; MONEY : monétaire (19,4).
  if (base === "smallmoney") {
    return { kind: "decimal", precision: 10, scale: 4 };
  }
  if (/^(money|currency)$/.test(base)) {
    return { kind: "money" };
  }
  return undefined;
}

/** Réels. */
function realOf(t: TypeParts): DataType | undefined {
  const { base, n, dialect } = t;
  if (base === "real" && dialect === "sqlite") {
    return { kind: "real", precision: "double" };
  }
  if (/^(real|float4|binary_float|single)$/.test(base)) {
    return { kind: "real", precision: "single" };
  }
  if (base === "float" && n === undefined && (dialect === "mysql" || dialect === "mariadb")) {
    return { kind: "real", precision: "single" };
  }
  if (base === "float") {
    return { kind: "real", precision: n !== undefined && n <= 24 ? "single" : "double" };
  }
  if (/^(double|double precision|float8|binary_double)$/.test(base)) {
    return { kind: "real", precision: "double" };
  }
  return undefined;
}

/** Dates, années, versions de ligne, heures. */
function dateOf(t: TypeParts): DataType | undefined {
  const { base, dialect } = t;
  // Dates et heures. Oracle DATE : date et heure à la seconde (O-39).
  if (base === "date" && dialect === "oracle") {
    return { kind: "datetime", withTimeZone: false, precision: 0 };
  }
  if (base === "date") {
    return { kind: "date" };
  }
  // YEAR (MySQL) : année sur 4 chiffres, 1901–2155 → entier 16 bits (O-35).
  if (base === "year") {
    return { kind: "integer", bits: 16 };
  }
  // TIMESTAMP (SQL Server) : synonyme de ROWVERSION, numéro de version de la ligne (O-41).
  if ((base === "timestamp" && dialect === "sqlserver") || base === "rowversion") {
    return { kind: "free", sql: "ROWVERSION" };
  }
  // TIMESTAMP (MySQL) : stocké en UTC et converti selon le fuseau de session, comme TIMESTAMPTZ.
  if (base === "timestamp" && (dialect === "mysql" || dialect === "mariadb")) {
    return { kind: "datetime", withTimeZone: true };
  }
  if (/^(time|timetz|time with time zone)$/.test(base)) {
    return { kind: "time" };
  }
  return undefined;
}

/** Horodatages. */
function dateTimeOf(t: TypeParts): DataType | undefined {
  const { base, n, dialect } = t;
  // Précision des fractions de seconde, si elle est écrite et diffère du défaut (6) (O-39).
  const fraction = n !== undefined && n !== 6 ? { precision: n } : {};
  if (/^(timestamptz|timestamp with time zone|timestamp with local time zone|datetimeoffset)$/.test(base)) {
    return { kind: "datetime", withTimeZone: true, ...fraction };
  }
  if (/^(timestamp|datetime2)$/.test(base)) {
    return { kind: "datetime", withTimeZone: false, ...fraction };
  }
  // DATETIME SQL Server : arrondi au 1/300 s, soit 3 décimales (O-42).
  if (base === "datetime" && dialect === "sqlserver") {
    return { kind: "datetime", withTimeZone: false, precision: 3 };
  }
  if (/^(datetime|smalldatetime|bigdatetime)$/.test(base)) {
    return { kind: "datetime", withTimeZone: false, ...(base === "datetime" && n !== undefined ? fraction : {}) };
  }
  return undefined;
}

/** Booléens, XML, types spatiaux. */
function otherOf(t: TypeParts): DataType | undefined {
  const { base } = t;
  if (/^(boolean|bool|logical|yesno)$/.test(base)) {
    return { kind: "boolean" };
  }
  if (/^(xml|xmltype)$/.test(base)) {
    return { kind: "xml" };
  }
  if (/^(geography)$/.test(base)) {
    return { kind: "geography" };
  }
  if (
    /^(geometry|st_geometry|sdo_geometry|point|linestring|polygon|multipoint|multilinestring|multipolygon|geometrycollection)$/.test(
      base,
    )
  ) {
    return { kind: "geometry" };
  }
  return undefined;
}

/**
 * Plage d'un type entier (O-39) : NUMBER(p) / NUMBER(p,0) Oracle → ±(10^p − 1) ; entiers binaires →
 * leurs bornes (UNSIGNED compris). `undefined` pour un type non entier.
 */
export function integerRange(sqlType: string, dialect?: SqlDialect): [bigint, bigint] | undefined {
  const digits = /^\s*number\s*\(\s*(\d+)\s*(?:,\s*0\s*)?\)\s*$/i.exec(sqlType);
  if (digits) {
    const max = 10n ** BigInt(digits[1]!) - 1n;
    return [-max, max];
  }
  const type = sqlTypeToDataType(sqlType, false, dialect);
  const bits = type?.kind === "integer" ? type.bits : type?.kind === "counter" ? (type.bits ?? 32) : undefined;
  if (bits === undefined) {
    return undefined;
  }
  // TINYINT SQL Server : 0 à 255 (O-41).
  const unsigned = /\bunsigned\b/i.test(sqlType) || (dialect === "sqlserver" && /^\s*tinyint\b/i.test(sqlType));
  return unsigned ? [0n, 2n ** BigInt(bits) - 1n] : [-(2n ** BigInt(bits - 1)), 2n ** BigInt(bits - 1) - 1n];
}
