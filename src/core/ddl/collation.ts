import { isAtLeast } from "../dbms/versions";
import type { SqlDialect } from "../model/physical";
import type { Target } from "./dialects";

/**
 * Traduction des collations de colonne (overrides O-35, O-37).
 *
 * Une collation est ramenée à sa classe de comparaison, seule notion portable :
 *  - `binary`    : octet par octet / point de code (`*_bin`, `C`, `BINARY`, `*_BIN2`) ;
 *  - `sensitive` : sensible à la casse et aux accents (`*_cs`, `*_as_cs`) — comportement par défaut
 *                  d'une collation déterministe ;
 *  - `ci`        : insensible à la casse, sensible aux accents (`*_as_ci`, `*_CI_AS`) ;
 *  - `ai_ci`     : insensible à la casse et aux accents (`*_ci` de MySQL — general_ci, unicode_ci,
 *                  0900_ai_ci —, `*_CI_AI`).
 * Une autre collation (langue, tri particulier) n'est émise que vers le même SGBD.
 * Jamais un nom inconnu de la cible.
 */

export type CollationClass = "binary" | "sensitive" | "ci" | "ai_ci" | "other";

/** Collations ICU non déterministes créées en tête de script PostgreSQL. */
export const PG_COLLATIONS: Record<"ci" | "ai_ci", { name: string; locale: string }> = {
  ci: { name: "merise_ci", locale: "und-u-ks-level2" },
  ai_ci: { name: "merise_ai_ci", locale: "und-u-ks-level1" },
};

export type CollationResult =
  /** Clause à écrire (vide : comportement par défaut de la cible) ; `preamble` : à créer avant. */
  | { kind: "emit"; sql: string; preamble?: string; approximation?: string }
  /** Non transposable : rien n'est écrit, la perte est signalée. */
  | { kind: "dropped" };

const sameFamily = (a: SqlDialect, b: string) => (a === "mariadb" ? "mysql" : a) === (b === "mariadb" ? "mysql" : b);

/** Collation binaire (comparaison octet par octet), quel que soit le SGBD d'origine. */
export function isBinaryCollation(name: string): boolean {
  return collationClass(name) === "binary";
}

/**
 * Classe d'une collation. `declared` : collations créées par le script (PostgreSQL
 * CREATE COLLATION), lues par leur locale ICU (`ks-level1` / `ks-level2`).
 */
export function collationClass(name: string, declared?: Map<string, Record<string, string>>): CollationClass {
  const n = name.replace(/^"|"$/g, "").toLowerCase();
  if (n === "c" || n === "posix" || n === "binary" || n === "ucs_basic" || n.endsWith("_bin") || n.endsWith("_bin2"))
    return "binary";
  const icu = declared?.get(n);
  if (icu && icu.deterministic === "false") {
    if (/ks-level1/.test(icu.locale ?? "")) return "ai_ci";
    if (/ks-level2/.test(icu.locale ?? "")) return "ci";
  }
  if (n === PG_COLLATIONS.ai_ci.name) return "ai_ci";
  if (n === PG_COLLATIONS.ci.name) return "ci";
  // SQL Server : …_CI_AI, …_CI_AS, …_CS_AS
  if (/_ci_ai\b/.test(n)) return "ai_ci";
  if (/_ci_as\b/.test(n)) return "ci";
  if (/_cs_as\b/.test(n)) return "sensitive";
  // Oracle : BINARY_AI, BINARY_CI
  if (n === "binary_ai") return "ai_ci";
  if (n === "binary_ci") return "ci";
  // SQLite : NOCASE (ASCII seulement)
  if (n === "nocase") return "ci";
  // MySQL / MariaDB : …_as_ci, …_ci (insensible aux accents par défaut), …_cs, …_as_cs
  if (n.endsWith("_as_ci")) return "ci";
  if (n.endsWith("_ci")) return "ai_ci";
  if (n.endsWith("_cs")) return "sensitive";
  return "other";
}

/** Classe appliquée sans collation déclarée (`undefined` : inconnue, propre à l'installation). */
export function defaultCollationClass(dialect: SqlDialect): CollationClass | undefined {
  switch (dialect) {
    case "postgresql":
    case "db2":
      return "sensitive";
    case "oracle":
    case "sqlite":
      return "binary";
    case "mysql":
      return "ai_ci"; // utf8mb4_0900_ai_ci
    case "sqlserver":
      return "ci"; // SQL_Latin1_General_CP1_CI_AS
    default:
      return undefined;
  }
}

/**
 * Collation insensible à la casse mais propre à une langue (ex. utf8mb4_tr_0900_ai_ci,
 * latin1_swedish_ci) : traduite par la collation générique de sa classe, avec une approximation.
 */
function languageSpecific(name: string): boolean {
  const n = name.toLowerCase();
  if (!/_ci$|_ci_a[is]\b/.test(n)) return false;
  return (
    !/^(utf8mb4|utf8mb3|utf8|latin1|ascii|ucs2|utf16|utf32)_(general|unicode|unicode_520|0900_ai|0900_as)_ci$/.test(
      n,
    ) && !/^(sql_)?latin1_general(_\d+)?_ci_a[is]$/.test(n)
  );
}

export function translateCollation(
  name: string,
  source: SqlDialect | undefined,
  target: Target,
  icu = true,
): CollationResult {
  const klass = collationClass(name);
  // Serveur sans ICU (option) : collation déterministe par défaut, comparaisons sensibles (O-38).
  if (
    !icu &&
    target.dbms === "postgresql" &&
    (klass === "ci" || klass === "ai_ci") &&
    !(source && sameFamily(source, target.dbms))
  ) {
    return { kind: "emit", sql: "", approximation: "deterministic" };
  }
  const result = translateClass(name, source, target);
  if (
    result.kind === "emit" &&
    !result.approximation &&
    !(source && sameFamily(source, target.dbms)) &&
    languageSpecific(name)
  ) {
    return { ...result, approximation: "language" };
  }
  return result;
}

function translateClass(name: string, source: SqlDialect | undefined, target: Target): CollationResult {
  const { dbms, version } = target;
  if (source && sameFamily(source, dbms)) return { kind: "emit", sql: `COLLATE ${name}` };
  const klass = collationClass(name);
  if (klass === "other") return { kind: "dropped" };
  if (klass === "sensitive") {
    // Comportement par défaut des collations déterministes (PostgreSQL, Oracle, DB2, SQLite).
    if (dbms === "mysql" || dbms === "mariadb") return { kind: "emit", sql: "COLLATE utf8mb4_0900_as_cs" };
    if (dbms === "sqlserver") return { kind: "emit", sql: "COLLATE Latin1_General_100_CS_AS" };
    return { kind: "emit", sql: "" };
  }
  if (klass === "binary") {
    switch (dbms) {
      case "postgresql":
        return { kind: "emit", sql: 'COLLATE "C"' };
      case "mysql":
      case "mariadb":
        return { kind: "emit", sql: "COLLATE utf8mb4_bin" };
      case "sqlserver":
        return { kind: "emit", sql: "COLLATE Latin1_General_BIN2" };
      case "oracle":
        return { kind: "emit", sql: "" }; // comparaison binaire : comportement par défaut (NLS_COMP = BINARY)
      case "sqlite":
        return { kind: "emit", sql: "" }; // BINARY : collation par défaut de SQLite
      default:
        return { kind: "dropped" };
    }
  }
  // Insensible à la casse (et aux accents) : ci / ai_ci.
  switch (dbms) {
    case "postgresql": {
      // Collation ICU non déterministe (PostgreSQL 12+) ; LIKE dessus seulement à partir de 18.
      if (!isAtLeast("postgresql", version, "12")) return { kind: "dropped" };
      const { name: pgName, locale } = PG_COLLATIONS[klass];
      return {
        kind: "emit",
        sql: `COLLATE ${pgName}`,
        preamble: `CREATE COLLATION IF NOT EXISTS ${pgName} (provider = icu, locale = '${locale}', deterministic = false);`,
        ...(isAtLeast("postgresql", version, "18") ? {} : { approximation: "like" }),
      };
    }
    case "mysql":
      return { kind: "emit", sql: klass === "ci" ? "COLLATE utf8mb4_0900_as_ci" : "COLLATE utf8mb4_0900_ai_ci" };
    case "mariadb":
      return klass === "ai_ci"
        ? { kind: "emit", sql: "COLLATE utf8mb4_unicode_ci" }
        : { kind: "emit", sql: "COLLATE utf8mb4_unicode_ci", approximation: "accents" };
    case "sqlserver":
      return {
        kind: "emit",
        sql: klass === "ci" ? "COLLATE Latin1_General_100_CI_AS" : "COLLATE Latin1_General_100_CI_AI",
      };
    case "sqlite":
      // NOCASE : casse ASCII seulement, accents distingués.
      return { kind: "emit", sql: "COLLATE NOCASE", approximation: "nocase" };
    default:
      return { kind: "dropped" };
  }
}
