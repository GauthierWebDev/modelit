import { type Dialect, standard } from "./dialect";

/** SQLite : affinités de types, clé primaire de compteur en ligne. */
export const sqlite = (): Dialect => ({
  ...standard,
  dbms: "sqlite",
  types: {
    ...standard.types,
    unboundedDecimal: "native",
    affinities: true,
    free: { rowversion: "BLOB", uuid: "TEXT", json: "TEXT", intervals: false },
  },
  // NULL est admis dans une clé primaire qui n'est pas INTEGER PRIMARY KEY : NOT NULL explicite.
  columns: { ...standard.columns, inlineCounterKey: true, primaryKeyNotNull: true },
  constraints: { ...standard.constraints, deferrable: (kind) => kind === "foreign" },
  indexes: { ...standard.indexes, expressions: true, partial: "where", prefix: (ref, n) => `substr(${ref}, 1, ${n})` },
});
