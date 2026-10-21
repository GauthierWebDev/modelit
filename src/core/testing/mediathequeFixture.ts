import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import type { Dbms } from "../dbms/dbms";
import { generateDdl, type Loss } from "../ddl/generate";
import { toLogicalModel } from "../mld/transform";
import { emptyDocument } from "../model/factory";
import type { DdlOptions } from "../model/settings";
import { reverseEngineer } from "../reverse/build";
import type { Difference } from "./catalog";

/**
 * Fixture de l'itération 3 (override O-35) : script MySQL réel (fixtures/mediatheque_mysql.sql) → PostgreSQL 18.
 * fixtures/mediatheque_pg_v1.sql : sortie d'avant ces travaux (témoin négatif).
 */
export const SOURCE = readFileSync("fixtures/mediatheque_mysql.sql", "utf8");
export const V1 = readFileSync("fixtures/mediatheque_pg_v1.sql", "utf8");

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
    .find((s) => new RegExp(`^CREATE TABLE ["\`\\[]?${name}["\`\\]]?\\(`).test(s.trim()))!;

/** Entrées du rapport annoncées en tête du script (pour un script dont on n'a que le texte). */
export const announced = (sql: string): Loss[] =>
  (sql.match(/^-- {3}• .*$/gm) ?? []).map((line) => {
    const [where, ...rest] = line.replace(/^-- {3}• /, "").split(" — ");
    const [tableName, column] = where!.split(".");
    return { category: "type", table: tableName!, column, message: rest.join(" — ") };
  });

/** Écarts source → sortie que le rapport ne justifie pas (même table, catégorie compatible, même colonne). */
export function unjustified(differences: Difference[], losses: Loss[], strictCategories = true): Difference[] {
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
    // O-39
    emptyString: ["domain"],
    state: ["check", "index", "action"],
    physical: ["physical"],
    sequence: ["default", "autoIncrement"],
  };
  const same = (a?: string, b?: string) => a === undefined || b === undefined || a.toLowerCase() === b.toLowerCase();
  return differences.filter(
    (d) =>
      !losses.some(
        (l) =>
          (!strictCategories || categories[d.category]?.includes(l.category)) &&
          [{ table: d.table, column: d.column }, ...(d.references ?? [])].some(
            (r) => l.table.toLowerCase() === r.table.toLowerCase() && same(r.column, l.column),
          ),
      ),
  );
}

export async function execute(sql: string): Promise<string | null> {
  const pg = new PGlite();
  try {
    await pg.exec(sql);
    return null;
  } catch (e) {
    return (e as Error).message;
  } finally {
    await pg.close();
  }
}
