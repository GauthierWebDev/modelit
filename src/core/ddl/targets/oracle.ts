import { isAtLeast } from "../../dbms/versions";
import { standard, type Dialect } from "./dialect";

export function oracle(version: string | undefined): Dialect {
  return {
    ...standard,
    dbms: "oracle",
    types: {
      ...standard.types,
      unboundedDecimal: "native",
      negativeScale: true,
      // LOB interdits dans les CHECK et les clés.
      boundedText: ({ compared, keyed }) => (compared || keyed ? 4000 : undefined),
      emptyStringIsNull: true,
      textLength: (sql) => sql.replace(/^(VARCHAR2|CHAR)\((\d+)\)$/, "$1($2 CHAR)"),
      free: { rowversion: "RAW(8)", uuid: "RAW(16)", json: "CLOB", intervals: false },
    },
    counters: {
      ...standard.counters,
      keepSourceType: (sql, source) =>
        /^NUMBER\(\d+\)/.test(sql) && /^number\s*(\(\s*\d+\s*\))?$/i.test(source.trim()) ? sql.replace(/^NUMBER\(\d+\)/, source.trim()) : sql,
      onNullIdentity: true,
    },
    sequences: isAtLeast("oracle", version, "12c")
      ? { next: (name) => `${name}.NEXTVAL`, valueType: () => undefined, noCache: "NOCACHE", noCycle: "NOCYCLE", ownedBy: false }
      : null,
    generated: { ...standard.generated!, stored: false },
    constraints: {
      ...standard.constraints,
      deferrable: () => true,
      notValidated: () => true,
      notValidatedSuffix: " ENABLE NOVALIDATE",
    },
    uniques: { ...standard.uniques, equalNulls: "composite" },
    indexes: {
      ...standard.indexes,
      expressions: true,
      // Pas d'index partiel : motif CASE WHEN cond THEN col END (les clés NULL ne sont pas indexées).
      partial: "case",
      prefix: (ref, n) => `substr(${ref}, 1, ${n})`,
    },
    comments: "statement",
  };
}
