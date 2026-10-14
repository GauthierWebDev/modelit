/**
 * Types de données conceptuels, indépendants du SGBD.
 * La traduction en type SQL natif se fait dans `core/dbms`.
 */

export type TextEncoding = "ascii" | "unicode" | "binary";
export type TextLength = "variable" | "fixed" | "large";
export type IntegerBits = 8 | 16 | 32 | 64;

export type DataType =
  | { kind: "text"; encoding: TextEncoding; length: TextLength; size?: number; collation?: string }
  | { kind: "integer"; bits: IntegerBits }
  /** Décimal exact ; sans précision : nombre décimal libre (Oracle NUMBER, PostgreSQL NUMERIC) (O-39). Échelle négative permise (arrondi à gauche de la virgule). */
  | { kind: "decimal"; precision?: number; scale: number }
  | { kind: "real"; precision: "single" | "double" }
  | { kind: "money" }
  /** Entier auto-incrémenté ; 64 bits si précisé (BIGSERIAL, BIGINT AUTO_INCREMENT…). */
  | { kind: "counter"; bits?: 64 }
  | { kind: "date" }
  | { kind: "time" }
  /** `precision` : chiffres des fractions de seconde, si elle est écrite (TIMESTAMP(3)) ; Oracle DATE : 0 (O-39). */
  | { kind: "datetime"; withTimeZone: boolean; precision?: number }
  | { kind: "boolean" }
  | { kind: "xml" }
  | { kind: "geometry" }
  | { kind: "geography" }
  | { kind: "free"; sql: string };

export type DataTypeKind = DataType["kind"];

/** Valeur par défaut proposée quand l'utilisateur choisit une famille de type. */
export function defaultDataType(kind: DataTypeKind): DataType {
  switch (kind) {
    case "text":
      return { kind, encoding: "ascii", length: "variable", size: 50 };
    case "integer":
      return { kind, bits: 32 };
    case "decimal":
      return { kind, precision: 15, scale: 2 };
    case "real":
      return { kind, precision: "double" };
    case "datetime":
      return { kind, withTimeZone: false };
    case "free":
      return { kind, sql: "" };
    default:
      return { kind };
  }
}

/** Familles de types, dans l'ordre de présentation (libellés : traduits par l'interface). */
export type DataTypeGroup = "text" | "numeric" | "datetime" | "other";

export const DATA_TYPE_KINDS: { kind: DataTypeKind; group: DataTypeGroup }[] = [
  { kind: "text", group: "text" },
  { kind: "integer", group: "numeric" },
  { kind: "decimal", group: "numeric" },
  { kind: "real", group: "numeric" },
  { kind: "money", group: "numeric" },
  { kind: "counter", group: "numeric" },
  { kind: "date", group: "datetime" },
  { kind: "time", group: "datetime" },
  { kind: "datetime", group: "datetime" },
  { kind: "boolean", group: "other" },
  { kind: "xml", group: "other" },
  { kind: "geometry", group: "other" },
  { kind: "geography", group: "other" },
  { kind: "free", group: "other" },
];
