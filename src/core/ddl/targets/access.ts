import { type Dialect, standard } from "./dialect";

export const access = (): Dialect => ({
  ...standard,
  dbms: "access",
  counters: {
    ...standard.counters,
    narrowOnly: "COUNTER",
    seed: (sql, start, step) => (/^COUNTER$/i.test(sql) ? `COUNTER(${start ?? 1}, ${step ?? 1})` : undefined),
  },
  generated: null,
});
