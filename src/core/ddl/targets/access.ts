import { type Dialect, reservedWords, standard } from "./dialect";

/** Mots réservés propres au SGBD (les mots communs sont ajoutés par `reservedWords`). */
const RESERVED =
  reservedWords(`alphanumeric autoincrement binary bit boolean byte char character column container counter currency
database date datetime disallow distinctrow double float float4 float8 general guid ieeedouble ieeesingle ignore
image index int integer integer1 integer2 integer4 level logical long longbinary longtext memo money month note
number numeric oleobject option owneraccess parameters percent pivot real short single smallint string text time
timestamp top transform value varbinary varchar year yesno`);

export const access = (): Dialect => ({
  ...standard,
  dbms: "access",
  counters: {
    ...standard.counters,
    narrowOnly: "COUNTER",
    seed: (sql, start, step) => (/^COUNTER$/i.test(sql) ? `COUNTER(${start ?? 1}, ${step ?? 1})` : undefined),
  },
  generated: null,
  identifiers: { quotes: ["[", "]"], reserved: RESERVED, maxLength: 64 },
  // SQL ANSI-92 : CASCADE et SET NULL.
  actions: { delete: ["cascade", "set null"], update: ["cascade", "set null"], implicit: ["no action"] },
  expressions: {
    booleanLiterals: false,
    dates: {
      current_date: "Date()",
      current_time: "Time()",
      current_timestamp: "Now()",
      localtimestamp: "Now()",
      localtimestamp_seconds: "Now()",
      utc_timestamp: null,
    },
    functions: { current_user: null, uuid: null, uuid_sequential: null },
  },
});
