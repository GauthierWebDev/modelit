import { isAtLeast } from "../../dbms/versions";
import { type Dialect, reservedWords, standard } from "./dialect";

/** Mots réservés propres au SGBD (les mots communs sont ajoutés par `reservedWords`). */
const RESERVED =
  reservedWords(`accessible analyze asensitive before bigint binary blob call cascade change char character condition continue
convert cube cume_dist cursor database databases dec decimal declare delayed dense_rank describe deterministic distinctrow
div double dual each elseif empty enclosed escaped exit explain first_value float float4 float8 force fulltext function
generated get grouping groups high_priority if ignore index infile inout insensitive int int1 int2 int3 int4 int8 integer
interval iterate json_table key keys kill lag last_value lateral lead leave limit linear lines load localtime
localtimestamp lock long longblob longtext loop low_priority match maxvalue mediumblob mediumint mediumtext middleint mod
modifies natural no_write_to_binlog nth_value ntile numeric optimize option optionally out outfile over partition
percent_rank precision procedure purge range rank read reads read_write real recursive regexp release rename repeat
replace require resignal restrict return revoke rlike row rows row_number schema schemas sensitive separator show signal
smallint spatial specific sql sqlexception sqlstate sqlwarning ssl starting stored straight_join system terminated
tinyblob tinyint tinytext trigger undo unlock unsigned usage use utc_date utc_time utc_timestamp varbinary varchar
varcharacter varying virtual while window write xor zerofill`);

/** Actions acceptées : InnoDB rejette SET DEFAULT. */
const ACTIONS = ["cascade", "set null", "restrict", "no action"] as const;

function family(dbms: "mysql" | "mariadb", version: string | undefined): Dialect {
  // MySQL 5.7 : ni expression entre parenthèses en DEFAULT, ni index sur expression (8.0.13+).
  const mysql57 = dbms === "mysql" && version === "5.7";
  return {
    ...standard,
    dbms,
    types: {
      ...standard.types,
      nativeDomains: true,
      unsigned: true,
      tinyintBoolean: true,
      yearRange: false,
      unboundedDecimal: { precision: 65, scale: 30 },
      // TEXT dans une clé : longueur de préfixe obligatoire.
      boundedText: ({ keyed }) => (keyed ? 255 : undefined),
      free: { rowversion: "BINARY(8)", uuid: dbms === "mariadb" ? "UUID" : "CHAR(36)", json: "JSON", intervals: false },
    },
    counters: { ...standard.counters, startOption: (start) => ` AUTO_INCREMENT=${start}`, nullTakesNextValue: true },
    columns: {
      ...standard.columns,
      onUpdate: true,
      // Pas de défaut littéral sur TEXT / BLOB / JSON / GEOMETRY ; expression entre parenthèses depuis 8.0.13.
      defaultFor: (rendered, type) =>
        !/^(\w*text|\w*blob|json|geometry)\b/i.test(type)
          ? rendered
          : mysql57
            ? null
            : rendered.startsWith("(")
              ? rendered
              : `(${rendered})`,
    },
    // CHECK ignoré par MySQL avant 8.0.16.
    constraints: { ...standard.constraints, enforcedChecks: !mysql57 },
    uniques: { ...standard.uniques, methods: true },
    indexes: {
      ...standard.indexes,
      // Pas d'index sur expression en MariaDB.
      expressions: dbms === "mysql" && !mysql57,
      parenthesizedExpressions: dbms === "mysql",
      nativeKinds: true,
      nativePrefixes: true,
      method: { position: "after", accepts: () => true },
    },
    comments: "inline",
    trigger: (body) => `DELIMITER $$\n${body}$$\nDELIMITER ;`,
    identifiers: { quotes: ["`", "`"], reserved: RESERVED, maxLength: 64 },
    actions: { delete: ACTIONS, update: ACTIONS, implicit: [] },
    // Expressions entre parenthèses en DEFAULT : MySQL 8.0.13+, MariaDB 10.2+.
    expressions:
      dbms === "mysql"
        ? {
            booleanLiterals: true,
            dates: {
              current_date: mysql57 ? null : "(CURRENT_DATE)",
              current_time: mysql57 ? null : "(CURRENT_TIME)",
              current_timestamp: "CURRENT_TIMESTAMP",
              localtimestamp: "CURRENT_TIMESTAMP",
              localtimestamp_seconds: "CURRENT_TIMESTAMP",
              utc_timestamp: mysql57 ? null : "(UTC_TIMESTAMP())",
            },
            functions: mysql57
              ? { current_user: null, uuid: null, uuid_sequential: null }
              : { current_user: "(CURRENT_USER())", uuid: "(UUID())", uuid_sequential: "(UUID())" },
          }
        : {
            booleanLiterals: true,
            dates: {
              current_date: "(CURRENT_DATE)",
              current_time: "(CURRENT_TIME)",
              current_timestamp: "CURRENT_TIMESTAMP",
              localtimestamp: "CURRENT_TIMESTAMP",
              localtimestamp_seconds: "CURRENT_TIMESTAMP",
              utc_timestamp: "(UTC_TIMESTAMP())",
            },
            functions: { current_user: "CURRENT_USER()", uuid: "UUID()", uuid_sequential: "UUID()" },
          },
    collations: {
      sensitive: "COLLATE utf8mb4_0900_as_cs",
      binary: "COLLATE utf8mb4_bin",
      insensitive: (klass) =>
        dbms === "mysql"
          ? { kind: "emit", sql: klass === "ci" ? "COLLATE utf8mb4_0900_as_ci" : "COLLATE utf8mb4_0900_ai_ci" }
          : klass === "ai_ci"
            ? { kind: "emit", sql: "COLLATE utf8mb4_unicode_ci" }
            : { kind: "emit", sql: "COLLATE utf8mb4_unicode_ci", approximation: "accents" },
    },
  };
}

export const mysql = (version: string | undefined) => family("mysql", version);

export function mariadb(version: string | undefined): Dialect {
  const base = family("mariadb", version);
  return isAtLeast("mariadb", version, "10.3")
    ? {
        ...base,
        sequences: {
          next: (name) => `NEXTVAL(${name})`,
          valueType: () => undefined,
          noCycle: "NO CYCLE",
          ownedBy: false,
        },
      }
    : base;
}
