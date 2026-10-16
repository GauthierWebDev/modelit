import { isAtLeast } from "../../dbms/versions";
import { standard, type Dialect } from "./dialect";

export function sqlserver(version: string | undefined): Dialect {
  return {
    ...standard,
    dbms: "sqlserver",
    schemas: { existing: "dbo", create: (name, quoted) => `IF SCHEMA_ID(N'${name}') IS NULL EXEC(N'CREATE SCHEMA ${quoted}');` },
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
      ? { next: (name) => `NEXT VALUE FOR ${name}`, valueType: (type) => (type === "INTEGER" ? "INT" : type), noCache: "NO CACHE", noCycle: "NO CYCLE", ownedBy: false }
      : null,
    // Colonne calculée sans type déclaré (déduit de l'expression).
    generated: { virtual: true, stored: true, typed: false, clause: (expression, stored) => `AS (${expression})${stored ? " PERSISTED" : ""}` },
    constraints: { ...standard.constraints, singleCascadePath: true },
    uniques: { ...standard.uniques, singleNull: true, equalNulls: "native" },
    indexes: { ...standard.indexes, partial: "where", include: true },
  };
}
