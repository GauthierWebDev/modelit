import { isAtLeast } from "../../dbms/versions";
import { type Dialect, standard } from "./dialect";

/** Méthodes d'index de PostgreSQL autres que B-tree (non uniques). */
const METHODS = ["hash", "gin", "gist", "brin", "spgist"];

export function postgresql(version: string | undefined): Dialect {
  const since = (v: string) => isAtLeast("postgresql", version, v);
  return {
    ...standard,
    dbms: "postgresql",
    schemas: { omitted: "public", create: (_, quoted) => `CREATE SCHEMA IF NOT EXISTS ${quoted};` },
    types: {
      ...standard.types,
      enumTypes: true,
      setArrays: true,
      unboundedDecimal: "native",
      negativeScale: since("15"),
      // Binaire borné → BYTEA, jamais BIT / BIT VARYING (des bits, pas des octets) (O-39).
      boundedBinary: "BYTEA",
      postgis: true,
      nondeterministicCollations: true,
      // JSONB, comme le JSON de MySQL (forme binaire normalisée, comparable, indexable) (O-37).
      free: { rowversion: "BYTEA", uuid: "UUID", json: "JSONB", intervals: true },
    },
    sequences: {
      next: (name) => `nextval('${name.replaceAll("'", "''")}')`,
      valueType: (type) => (type === "TINYINT" ? undefined : type),
      noCycle: "NO CYCLE",
      ownedBy: true,
    },
    generated: { ...standard.generated!, virtual: since("18") },
    constraints: {
      ...standard.constraints,
      strictCheckTyping: true,
      regex: true,
      // Les CHECK ne se diffèrent pas.
      deferrable: (kind) => kind !== "check",
      notValidated: (kind) => kind === "check" || kind === "foreign",
    },
    uniques: { ...standard.uniques, equalNulls: { clause: since("15") ? " NULLS NOT DISTINCT" : null }, include: true },
    indexes: {
      ...standard.indexes,
      expressions: true,
      partial: "where",
      fulltextGin: true,
      prefix: (ref, n) => `left(${ref}, ${n})`,
      method: { position: "before", accepts: (method, unique) => !unique && METHODS.includes(method) },
      include: since("11"),
    },
    comments: "statement",
    partitioning: true,
  };
}
