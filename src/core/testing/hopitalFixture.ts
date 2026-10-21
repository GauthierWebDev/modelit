import { readFileSync } from "node:fs";
import type { PGlite } from "@electric-sql/pglite";
import type { Dbms } from "../dbms/dbms";
import { generateDdl, type Loss } from "../ddl/generate";
import { toLogicalModel } from "../mld/transform";
import { emptyDocument } from "../model/factory";
import type { DdlOptions } from "../model/settings";
import { reverseEngineer } from "../reverse/build";
import type { Difference } from "./catalog";

/**
 * Fixture de l'itération 8 (override O-39) : script Oracle réel (fixtures/hopital_oracle.sql) → PostgreSQL 18.
 * fixtures/hopital_pg_v1.sql : sortie d'avant ces travaux (témoin négatif).
 */
export const SOURCE = readFileSync("fixtures/hopital_oracle.sql", "utf8");
export const V1 = readFileSync("fixtures/hopital_pg_v1.sql", "utf8");

export function generate(
  dbms: Dbms = "postgresql",
  version: string | undefined = "18",
  options: Partial<DdlOptions> = {},
) {
  const { doc } = reverseEngineer(SOURCE, emptyDocument());
  const result = generateDdl(toLogicalModel(doc), { dbms, version }, options);
  if (!result.ok) {
    throw new Error(result.error);
  }
  return result;
}

export const body = (sql: string) => sql.replace(/^(--.*\n)+\n/, "");
export const table = (sql: string, name: string) =>
  body(sql)
    .split(/;\s*\n/)
    .find((s) => new RegExp(`^CREATE TABLE "?${name}"?\\(`, "i").test(s.trim()))!;

/** Entrées du rapport annoncées en tête du script (pour un script dont on n'a que le texte). */
export const announced = (sql: string): Loss[] =>
  (sql.match(/^-- {3}• .*$/gm) ?? []).map((line) => {
    const [where, ...rest] = line.replace(/^-- {3}• /, "").split(" — ");
    const [t, column] = where!.split(".");
    return { category: "type", table: t!, column, message: rest.join(" — ") };
  });

/** Écarts source → sortie que le rapport ne justifie pas (même table, catégorie compatible, même colonne). */
export function unjustified(differences: Difference[], losses: Loss[]): Difference[] {
  const categories: Partial<Record<Difference["category"], Loss["category"][]>> = {
    type: ["type", "autoIncrement", "unsigned", "domain", "generated"],
    range: ["unsigned", "type", "generated"],
    autoIncrement: ["autoIncrement", "type"],
    default: ["default"],
    action: ["action"],
    check: ["check"],
    name: ["name"],
    domain: ["domain"],
    collation: ["collation"],
    generated: ["generated"],
    onUpdate: ["onUpdate"],
    comment: ["comment"],
    trigger: ["trigger"],
    index: ["index"],
    unique: ["index"],
    state: ["check", "index", "action"],
    physical: ["physical"],
    sequence: ["default", "autoIncrement"],
    emptyString: ["domain"],
  };
  const same = (a?: string, b?: string) => a === undefined || b === undefined || a.toLowerCase() === b.toLowerCase();
  return differences.filter(
    (d) =>
      !losses.some(
        (l) =>
          categories[d.category]?.includes(l.category) &&
          [{ table: d.table, column: d.column }, ...(d.references ?? [])].some(
            (r) => l.table.toLowerCase() === r.table.toLowerCase() && same(r.column, l.column),
          ),
      ),
  );
}

export const rejects = async (pg: PGlite, sql: string) => {
  try {
    await pg.exec(sql);
    return null;
  } catch (e) {
    return (e as Error).message;
  }
};
