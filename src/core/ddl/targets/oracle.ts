import { isAtLeast } from "../../dbms/versions";
import { type Dialect, reservedWords, standard } from "./dialect";

/** Mots réservés propres au SGBD (les mots communs sont ajoutés par `reservedWords`). */
const RESERVED =
  reservedWords(`access audit char cluster comment compress connect current date decimal exclusive file float identified
immediate increment index initial integer level lock long maxextents minus mlslabel mode modify noaudit nocompress nowait
number offline online option pctfree prior public raw rename resource revoke row rowid rownum rows session share size
smallint start successful synonym sysdate trigger uid validate varchar varchar2 view whenever`);

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
        /^NUMBER\(\d+\)/.test(sql) && /^number\s*(\(\s*\d+\s*\))?$/i.test(source.trim())
          ? sql.replace(/^NUMBER\(\d+\)/, source.trim())
          : sql,
      onNullIdentity: true,
    },
    sequences: isAtLeast("oracle", version, "12c")
      ? {
          next: (name) => `${name}.NEXTVAL`,
          valueType: () => undefined,
          noCache: "NOCACHE",
          noCycle: "NOCYCLE",
          ownedBy: false,
        }
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
    // 128 octets depuis 12.2 ; 30 avant (11g, 12c 12.1) et par prudence en générique.
    identifiers: {
      quotes: ['"', '"'],
      folding: "upper",
      reserved: RESERVED,
      maxLength: isAtLeast("oracle", version, "18c") ? 128 : 30,
    },
    // ON DELETE CASCADE / SET NULL uniquement ; aucun ON UPDATE.
    actions: { delete: ["cascade", "set null"], update: [], implicit: ["no action"] },
    expressions: {
      booleanLiterals: isAtLeast("oracle", version, "23ai"),
      dates: {
        current_date: "CURRENT_DATE",
        current_time: null,
        current_timestamp: "CURRENT_TIMESTAMP",
        localtimestamp: "LOCALTIMESTAMP",
        localtimestamp_seconds: "SYSDATE",
        utc_timestamp: "SYS_EXTRACT_UTC(SYSTIMESTAMP)",
      },
      functions: { current_user: "USER", uuid: "SYS_GUID()", uuid_sequential: "SYS_GUID()" },
    },
    // Comparaison binaire : comportement par défaut (NLS_COMP = BINARY).
    collations: { ...standard.collations, binary: "" },
  };
}
