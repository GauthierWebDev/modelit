import { ALL_ACTIONS, type Dialect, reservedWords, standard } from "./dialect";

/** Mots réservés propres au SGBD (les mots communs sont ajoutés par `reservedWords`). */
const RESERVED = reservedWords(
  "abort autoincrement commit deferrable escape except index isnull limit notnull raise transaction",
);

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
  // Pas d'ALTER TABLE … ADD CONSTRAINT : les références vers des tables créées plus loin sont admises.
  constraints: { ...standard.constraints, deferrable: (kind) => kind === "foreign", alterForeignKey: false },
  indexes: { ...standard.indexes, expressions: true, partial: "where", prefix: (ref, n) => `substr(${ref}, 1, ${n})` },
  identifiers: { quotes: ['"', '"'], reserved: RESERVED, maxLength: Infinity },
  actions: { delete: ALL_ACTIONS, update: ALL_ACTIONS, implicit: [] },
  expressions: {
    booleanLiterals: true,
    dates: {
      current_date: "CURRENT_DATE",
      current_time: "CURRENT_TIME",
      current_timestamp: "CURRENT_TIMESTAMP",
      localtimestamp: "(datetime('now', 'localtime'))",
      localtimestamp_seconds: "(datetime('now', 'localtime'))",
      utc_timestamp: "CURRENT_TIMESTAMP", // SQLite : CURRENT_TIMESTAMP est en UTC
    },
    functions: { current_user: null, uuid: null, uuid_sequential: null },
  },
  collations: {
    sensitive: "",
    // BINARY : collation par défaut de SQLite.
    binary: "",
    // NOCASE : casse ASCII seulement, accents distingués.
    insensitive: () => ({ kind: "emit", sql: "COLLATE NOCASE", approximation: "nocase" }),
  },
});
