import { isAtLeast } from "../../dbms/versions";
import { type Dialect, standard } from "./dialect";

function family(dbms: "mysql" | "mariadb", version: string | undefined): Dialect {
  // MySQL 5.7 : ni expression entre parenthèses en DEFAULT, ni index sur expression (8.0.13+).
  const mysql57 = dbms === "mysql" && version === "5.7";
  return {
    ...standard,
    dbms,
    types: {
      ...standard.types,
      nativeDomains: true,
      unsigned: true,
      tinyintBoolean: true,
      yearRange: false,
      unboundedDecimal: { precision: 65, scale: 30 },
      // TEXT dans une clé : longueur de préfixe obligatoire.
      boundedText: ({ keyed }) => (keyed ? 255 : undefined),
      free: { rowversion: "BINARY(8)", uuid: dbms === "mariadb" ? "UUID" : "CHAR(36)", json: "JSON", intervals: false },
    },
    counters: { ...standard.counters, startOption: (start) => ` AUTO_INCREMENT=${start}`, nullTakesNextValue: true },
    columns: {
      ...standard.columns,
      onUpdate: true,
      // Pas de défaut littéral sur TEXT / BLOB / JSON / GEOMETRY ; expression entre parenthèses depuis 8.0.13.
      defaultFor: (rendered, type) =>
        !/^(\w*text|\w*blob|json|geometry)\b/i.test(type)
          ? rendered
          : mysql57
            ? null
            : rendered.startsWith("(")
              ? rendered
              : `(${rendered})`,
    },
    uniques: { ...standard.uniques, methods: true },
    indexes: {
      ...standard.indexes,
      // Pas d'index sur expression en MariaDB.
      expressions: dbms === "mysql" && !mysql57,
      parenthesizedExpressions: dbms === "mysql",
      nativeKinds: true,
      nativePrefixes: true,
      method: { position: "after", accepts: () => true },
    },
    comments: "inline",
    trigger: (body) => `DELIMITER $$\n${body}$$\nDELIMITER ;`,
  };
}

export const mysql = (version: string | undefined) => family("mysql", version);

export function mariadb(version: string | undefined): Dialect {
  const base = family("mariadb", version);
  return isAtLeast("mariadb", version, "10.3")
    ? {
        ...base,
        sequences: {
          next: (name) => `NEXTVAL(${name})`,
          valueType: () => undefined,
          noCycle: "NO CYCLE",
          ownedBy: false,
        },
      }
    : base;
}
