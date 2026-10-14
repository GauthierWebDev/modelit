import type { DataType } from "../model/datatype";
import type { Dbms } from "./dbms";
import { isAtLeast } from "./versions";

/**
 * Correspondance type conceptuel → type SQL, par SGBD.
 * Gabarits : `{n}` = longueur, `{p}` / `{s}` = précision / échelle.
 * `null` = pas de type défini ; la colonne est alors émise sans type.
 */
type Row = Record<Dbms, string | null>;

const row = (
  access: string | null,
  mysql: string | null,
  mariadb: string | null,
  oracle: string | null,
  postgresql: string | null,
  sqlserver: string | null,
  sybase: string | null,
  db2: string | null,
  sqlite: string | null,
): Row => ({ access, mysql, mariadb, oracle, postgresql, sqlserver, sybase, db2, sqlite });

//                                   Access          MySQL                 MariaDB               Oracle                      PostgreSQL          SQL Server        Sybase                      DB2                                     SQLite
const TABLE = {
  asciiVariable:    row("VARCHAR({n})",  "VARCHAR({n})",       "VARCHAR({n})",       "VARCHAR2({n})",            "VARCHAR({n})",     "VARCHAR({n})",   "VARCHAR({n})",             "VARCHAR({n})",                         "TEXT"),
  asciiFixed:       row("CHAR({n})",     "CHAR({n})",          "CHAR({n})",          "CHAR({n})",                "CHAR({n})",        "CHAR({n})",      "CHAR({n})",                "CHAR({n})",                            "TEXT"),
  asciiLarge:       row("TEXT",          "TEXT",               "TEXT",               "CLOB",                     "TEXT",             "VARCHAR(max)",   "TEXT",                     "CLOB",                                 "TEXT"),
  unicodeVariable:  row("VARCHAR({n})",  "VARCHAR({n})",       "VARCHAR({n})",       "NVARCHAR2({n})",           "VARCHAR({n})",     "NVARCHAR({n})",  "NVARCHAR({n})",            "VARGRAPHIC({n})",                      "TEXT"),
  unicodeFixed:     row("CHAR({n})",     "CHAR({n})",          "CHAR({n})",          "NCHAR({n})",               "CHAR({n})",        "NCHAR({n})",     "NCHAR({n})",               "GRAPHIC({n})",                         "TEXT"),
  unicodeLarge:     row("TEXT",          "TEXT",               "TEXT",               "NCLOB",                    "TEXT",             "NVARCHAR(max)",  "UNITEXT",                  "DBCLOB",                               "TEXT"),
  binaryVariable:   row("VARBINARY({n})","VARBINARY({n})",     "VARBINARY({n})",     "VARBINARY({n})",           "BIT VARYING({n})", "VARBINARY({n})", "VARBINARY({n})",           "VARBINARY({n})",                       "TEXT"),
  binaryFixed:      row("BINARY({n})",   "BINARY({n})",        "BINARY({n})",        "BINARY({n})",              "BIT({n})",         "BINARY({n})",    "BINARY({n})",              "BINARY({n})",                          "TEXT"),
  binaryLarge:      row("LONGBINARY",    "BLOB",               "BLOB",               "BLOB",                     "BYTEA",            "VARBINARY(max)", "IMAGE",                    "BLOB",                                 "BLOB"),
  int8:             row("BYTE",          "TINYINT",            "TINYINT",            "NUMBER(3)",                "SMALLINT",         "TINYINT",        "TINYINT",                  "SMALLINT",                             "INTEGER"),
  int16:            row("SMALLINT",      "SMALLINT",           "SMALLINT",           "NUMBER(5)",                "SMALLINT",         "SMALLINT",       "SMALLINT",                 "SMALLINT",                             "INTEGER"),
  int32:            row("INT",           "INT",                "INT",                "NUMBER(10)",               "INTEGER",          "INT",            "INT",                      "INT",                                  "INTEGER"),
  int64:            row("BIGINT",        "BIGINT",             "BIGINT",             "NUMBER(20)",               "BIGINT",           "BIGINT",         "BIGINT",                   "BIGINT",                               "INTEGER"),
  // Décimal : seules les formes SQL Server, MariaDB et SQLite sont confirmées.
  decimal:          row("DECIMAL({p},{s})","DECIMAL({p},{s})", "DECIMAL({p},{s})",   "NUMBER({p},{s})",          "NUMERIC({p},{s})", "DECIMAL({p},{s})","NUMERIC({p},{s})",        "DECIMAL({p},{s})",                     "NUMERIC({p},{s})"),
  realSingle:       row("REAL",          "FLOAT",              "FLOAT",              "BINARY_FLOAT",             "REAL",             "REAL",           "REAL",                     "REAL",                                 "REAL"),
  realDouble:       row("DOUBLE",        "DOUBLE",             "DOUBLE",             "BINARY_DOUBLE",            "DOUBLE PRECISION", "FLOAT",          "DOUBLE PRECISION",         "DOUBLE",                               "REAL"),
  // PostgreSQL : jamais MONEY (dépend de la locale) → NUMERIC(19,4) (O-42).
  money:            row("CURRENCY",      "DECIMAL(19,4)",      "DECIMAL(19,4)",      "NUMBER(19,4)",             "NUMERIC(19,4)",    "MONEY",          "MONEY",                    "DECIMAL(19,4)",                        "NUMERIC"),
  // Oracle : la clause d'auto-incrément éventuelle reste à vérifier.
  counter:          row("COUNTER",       "INT AUTO_INCREMENT", "INT AUTO_INCREMENT", "NUMBER(10)",               "SERIAL",           "INT IDENTITY",   "INT IDENTITY",             "INT GENERATED BY DEFAULT AS IDENTITY", "INTEGER"),
  counter64:        row("COUNTER",       "BIGINT AUTO_INCREMENT", "BIGINT AUTO_INCREMENT", "NUMBER(20)",          "BIGSERIAL",        "BIGINT IDENTITY", "BIGINT IDENTITY",          "BIGINT GENERATED BY DEFAULT AS IDENTITY", "INTEGER"),
  date:             row("DATE",          "DATE",               "DATE",               "DATE",                     "DATE",             "DATE",           "DATE",                     "DATE",                                 "NUMERIC"),
  time:             row("TIME",          "TIME",               "TIME",               "DATE",                     "TIME",             "TIME",           "TIME",                     "TIME",                                 "NUMERIC"),
  datetime:         row("DATETIME",      "DATETIME",           "DATETIME",           "TIMESTAMP",                "TIMESTAMP",        "DATETIME2",      "BIGDATETIME",              "TIMESTAMP",                            "NUMERIC"),
  // PostgreSQL : TIMESTAMPTZ (et non « TIMESTAMPZ », invalide).
  // SQLite : non documenté.
  datetimeTz:       row("DATETIME",      "DATETIME",           "DATETIME",           "TIMESTAMP WITH TIME ZONE", "TIMESTAMPTZ",      "DATETIMEOFFSET", "TIMESTAMP WITH TIME ZONE", "TIMESTAMP",                            null),
  boolean:          row("LOGICAL",       "BOOLEAN",            "BOOLEAN",            "NUMBER(1)",                "BOOLEAN",          "BIT",            "BIT",                      "SMALLINT",                             "NUMERIC"),
  xml:              row("TEXT",          "TEXT",               "TEXT",               "XMLTYPE",                  "XML",              "XML",            "XML",                      "XML",                                  "TEXT"),
  geometry:         row("TEXT",          "GEOMETRY",           "GEOMETRY",           "SDO_GEOMETRY",             "GEOMETRY",         "GEOMETRY",       "ST_GEOMETRY",              "ST_GEOMETRY",                          "TEXT"),
  geography:        row("TEXT",          "GEOMETRY",           "GEOMETRY",           "SDO_GEOMETRY",             "GEOGRAPHY",        "GEOGRAPHY",      "ST_GEOMETRY",              "ST_GEOMETRY",                          "TEXT"),
} satisfies Record<string, Row>;

type RowKey = keyof typeof TABLE;

/**
 * Surcharges selon la version du SGBD (override O-04) : mots-clés plus adaptés,
 * disponibles à partir de la version `since`. Sans version (ou version générique),
 * la table ci-dessus s'applique telle quelle.
 */
const VERSION_OVERRIDES: { dbms: Dbms; since: string; row: RowKey; sql: string }[] = [
  // Colonnes IDENTITY (norme SQL) à la place de SERIAL.
  { dbms: "postgresql", since: "10", row: "counter", sql: "INTEGER GENERATED BY DEFAULT AS IDENTITY" },
  { dbms: "postgresql", since: "10", row: "counter64", sql: "BIGINT GENERATED BY DEFAULT AS IDENTITY" },
  // Colonnes IDENTITY natives depuis 12c (avant : séquence + trigger).
  { dbms: "oracle", since: "12c", row: "counter", sql: "NUMBER(10) GENERATED BY DEFAULT AS IDENTITY" },
  { dbms: "oracle", since: "12c", row: "counter64", sql: "NUMBER(20) GENERATED BY DEFAULT AS IDENTITY" },
  // Type BOOLEAN SQL natif depuis 23ai.
  { dbms: "oracle", since: "23ai", row: "boolean", sql: "BOOLEAN" },
];

function templateFor(row: RowKey, dbms: Dbms, version: string | undefined): string | null {
  const override = VERSION_OVERRIDES.filter((o) => o.dbms === dbms && o.row === row && isAtLeast(dbms, version, o.since)).at(-1);
  return override ? override.sql : TABLE[row][dbms];
}

function rowKey(type: Exclude<DataType, { kind: "free" }>): RowKey {
  switch (type.kind) {
    case "text": {
      const length = { variable: "Variable", fixed: "Fixed", large: "Large" }[type.length];
      return `${type.encoding}${length}` as RowKey;
    }
    case "integer":
      return `int${type.bits}`;
    case "real":
      return type.precision === "single" ? "realSingle" : "realDouble";
    case "datetime":
      return type.withTimeZone ? "datetimeTz" : "datetime";
    case "counter":
      return type.bits === 64 ? "counter64" : "counter";
    default:
      return type.kind;
  }
}

function fill(template: string, values: Record<string, number | undefined>): string {
  // Paramètre absent (longueur non saisie) : on retire la parenthèse plutôt que d'émettre « () ».
  if (Object.entries(values).some(([k, v]) => v === undefined && template.includes(`{${k}}`))) {
    return template.replace(/\(.*\)/, "");
  }
  return template.replace(/\{(\w)\}/g, (_, k: string) => String(values[k]));
}

/** SGBD dont le type date-heure accepte une précision des fractions de seconde. */
const FRACTIONAL_SECONDS: Dbms[] = ["postgresql", "oracle", "mysql", "mariadb", "sqlserver", "db2"];

/** Type SQL d'une colonne, ou `null` si non défini pour ce SGBD. */
export function sqlType(type: DataType, dbms: Dbms, version?: string): string | null {
  if (type.kind === "free") return type.sql.trim() || null;
  const template = templateFor(rowKey(type), dbms, version);
  if (template === null) return null;
  const values =
    type.kind === "text"
      ? { n: type.size }
      : type.kind === "decimal"
        ? { p: type.precision, s: type.scale }
        : {};
  let base = fill(template, values);
  // PostgreSQL : NUMERIC(p) plutôt que NUMERIC(p,0) (même type).
  if (type.kind === "decimal" && type.scale === 0 && type.precision !== undefined && dbms === "postgresql") base = `NUMERIC(${type.precision})`;
  // Précision des fractions de seconde écrite à la source (O-39) : TIMESTAMP(0), TIMESTAMPTZ(3), DATETIME2(3)…
  if (type.kind === "datetime" && type.precision !== undefined && FRACTIONAL_SECONDS.includes(dbms)) base = base.replace(/^(\w+)/, `$1(${type.precision})`);
  return type.kind === "text" && type.collation ? `${base} COLLATE ${type.collation}` : base;
}

/**
 * Type d'une clé étrangère : une clé étrangère vers un compteur prend
 * le type entier correspondant.
 */
export function foreignKeyDataType(referenced: DataType | undefined): DataType | undefined {
  return referenced?.kind === "counter" ? { kind: "integer", bits: referenced.bits ?? 32 } : referenced;
}
