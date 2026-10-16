import { type Dialect, standard } from "./dialect";

export const db2 = (): Dialect => ({
  ...standard,
  dbms: "db2",
  schemas: { create: (_, quoted) => `CREATE SCHEMA IF NOT EXISTS ${quoted};` },
  types: {
    ...standard.types,
    unboundedDecimal: { sql: "DECFLOAT(34)" },
    // LOB interdits dans les CHECK et les clés.
    boundedText: ({ compared, keyed }) => (compared || keyed ? 4000 : undefined),
    free: { rowversion: "BINARY(8)", uuid: "CHAR(36)", json: "CLOB", intervals: false },
  },
  // Colonnes calculées toujours stockées, sans mot-clé STORED.
  generated: {
    virtual: false,
    stored: true,
    typed: true,
    clause: (expression) => `GENERATED ALWAYS AS (${expression})`,
  },
  constraints: { ...standard.constraints, strictCheckTyping: true },
  indexes: { ...standard.indexes, expressions: true },
  comments: "statement",
});
