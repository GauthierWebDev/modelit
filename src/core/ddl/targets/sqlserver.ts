import { isAtLeast } from "../../dbms/versions";
import { type Dialect, reservedWords, standard } from "./dialect";

/** Mots réservés propres au SGBD (les mots communs sont ajoutés par `reservedWords`). */
const RESERVED =
  reservedWords(`authorization backup begin break browse bulk cascade checkpoint close clustered coalesce commit compute
contains containstable continue convert current cursor database dbcc deallocate declare deny disk distributed double dump
errlvl escape exec execute exit external file fillfactor freetext freetexttable function goto holdlock identity
identity_insert identitycol if index key kill lineno load merge national nocheck nonclustered nullif off offsets open
opendatasource openquery openrowset openxml option over percent pivot plan precision print proc procedure public
raiserror read readtext reconfigure replication restore restrict return revert revoke rollback rowcount rowguidcol rule
save schema securityaudit session_user setuser shutdown statistics system_user tablesample textsize top tran transaction
trigger truncate try_convert tsequal unpivot updatetext use varying view waitfor while writetext`);

export function sqlserver(version: string | undefined): Dialect {
  return {
    ...standard,
    dbms: "sqlserver",
    schemas: {
      existing: "dbo",
      create: (name, quoted) => `IF SCHEMA_ID(N'${name}') IS NULL EXEC(N'CREATE SCHEMA ${quoted}');`,
    },
    types: {
      ...standard.types,
      // VARCHAR(MAX) interdit dans une clé d'index.
      boundedText: ({ keyed }) => (keyed ? 450 : undefined),
      free: { rowversion: undefined, uuid: "UNIQUEIDENTIFIER", json: "NVARCHAR(MAX)", intervals: false },
    },
    counters: {
      ...standard.counters,
      seed: (sql, start, step) => (/IDENTITY$/i.test(sql) ? `${sql}(${start ?? 1}, ${step ?? 1})` : undefined),
      rejectsExplicitValues: true,
    },
    sequences: isAtLeast("sqlserver", version, "2012")
      ? {
          next: (name) => `NEXT VALUE FOR ${name}`,
          valueType: (type) => (type === "INTEGER" ? "INT" : type),
          noCache: "NO CACHE",
          noCycle: "NO CYCLE",
          ownedBy: false,
        }
      : null,
    // Colonne calculée sans type déclaré (déduit de l'expression).
    generated: {
      virtual: true,
      stored: true,
      typed: false,
      clause: (expression, stored) => `AS (${expression})${stored ? " PERSISTED" : ""}`,
    },
    constraints: { ...standard.constraints, singleCascadePath: true },
    uniques: { ...standard.uniques, singleNull: true, equalNulls: "native" },
    indexes: { ...standard.indexes, partial: "where", include: true },
    identifiers: { quotes: ["[", "]"], reserved: RESERVED, maxLength: 128 },
    // Pas de RESTRICT (NO ACTION équivalent, mais vérifié immédiatement dans les deux cas).
    actions: {
      delete: ["no action", "cascade", "set null", "set default"],
      update: ["no action", "cascade", "set null", "set default"],
      implicit: [],
    },
    expressions: {
      booleanLiterals: false,
      // localtimestamp : heure locale ; utc_timestamp : heure UTC sans fuseau (O-39, O-42).
      dates: {
        current_date: "CAST(GETDATE() AS DATE)",
        current_time: "CAST(GETDATE() AS TIME)",
        current_timestamp: "CURRENT_TIMESTAMP",
        localtimestamp: "SYSDATETIME()",
        localtimestamp_seconds: "CAST(GETDATE() AS DATETIME2(0))",
        utc_timestamp: "SYSUTCDATETIME()",
      },
      functions: { current_user: "CURRENT_USER", uuid: "NEWID()", uuid_sequential: "NEWSEQUENTIALID()" },
    },
    collations: {
      sensitive: "COLLATE Latin1_General_100_CS_AS",
      binary: "COLLATE Latin1_General_BIN2",
      insensitive: (klass) => ({
        kind: "emit",
        sql: klass === "ci" ? "COLLATE Latin1_General_100_CI_AS" : "COLLATE Latin1_General_100_CI_AI",
      }),
    },
  };
}
