import { isAtLeast } from "../../dbms/versions";
import { ALL_ACTIONS, type Dialect, reservedWords, standard } from "./dialect";

/** Mots réservés propres au SGBD (les mots communs sont ajoutés par `reservedWords`). */
const RESERVED =
  reservedWords(`analyse analyze array asymmetric authorization binary collation concurrently current_catalog current_role
current_schema deferrable do freeze ilike initially isnull lateral limit localtime localtimestamp natural notnull offset
only overlaps placing returning session_user similar symmetric system_user tablesample variadic verbose window`);

/** Collations ICU non déterministes créées en tête de script (O-38). */
export const PG_COLLATIONS: Record<"ci" | "ai_ci", { name: string; locale: string }> = {
  ci: { name: "merise_ci", locale: "und-u-ks-level2" },
  ai_ci: { name: "merise_ai_ci", locale: "und-u-ks-level1" },
};

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
    identifiers: { quotes: ['"', '"'], folding: "lower", reserved: RESERVED, maxLength: 63 },
    actions: { delete: ALL_ACTIONS, update: ALL_ACTIONS, implicit: [] },
    expressions: {
      booleanLiterals: true,
      dates: {
        current_date: "CURRENT_DATE",
        current_time: "CURRENT_TIME",
        current_timestamp: "CURRENT_TIMESTAMP",
        localtimestamp: "LOCALTIMESTAMP",
        localtimestamp_seconds: "LOCALTIMESTAMP(0)",
        utc_timestamp: "(now() AT TIME ZONE 'UTC')",
      },
      // uuid_sequential : UUID croissant (NEWSEQUENTIALID) — uuidv7() à partir de PostgreSQL 18 (O-42).
      functions: {
        current_user: "CURRENT_USER",
        uuid: since("13") ? "gen_random_uuid()" : null,
        uuid_sequential: since("18") ? "uuidv7()" : since("13") ? "gen_random_uuid()" : null,
      },
    },
    collations: {
      sensitive: "",
      binary: 'COLLATE "C"',
      insensitive: (klass) => {
        // Collation ICU non déterministe (PostgreSQL 12+) ; LIKE dessus seulement à partir de 18.
        if (!since("12")) {
          return { kind: "dropped" };
        }
        const { name, locale } = PG_COLLATIONS[klass];
        return {
          kind: "emit",
          sql: `COLLATE ${name}`,
          preamble: `CREATE COLLATION IF NOT EXISTS ${name} (provider = icu, locale = '${locale}', deterministic = false);`,
          ...(since("18") ? {} : { approximation: "like" }),
        };
      },
    },
  };
}
