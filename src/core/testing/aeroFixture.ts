import { readFileSync } from "node:fs";
import type { Dbms } from "../dbms/dbms";
import { generateDdl, type Loss } from "../ddl/generate";
import { toLogicalModel } from "../mld/transform";
import { emptyDocument } from "../model/factory";
import type { DdlOptions } from "../model/settings";
import { reverseEngineer } from "../reverse/build";
import type { Difference } from "./catalog";

/** Itération 10 (override O-41) : script SQL Server réel (fixtures/aero_sqlserver.sql) → MCD → PostgreSQL 18. */

export const SOURCE = readFileSync("fixtures/aero_sqlserver.sql", "utf8");
export const { doc, report } = reverseEngineer(SOURCE, emptyDocument());
export const entity = (name: string) => doc.entities.find((e) => e.name === name)!;
export const attribute = (owner: string, name: string) =>
  [...doc.entities, ...doc.associations].find((e) => e.name === owner)!.attributes.find((a) => a.name === name)!;
export const issues = toLogicalModel(doc).issues.map((i) => i.message);

export function generate(
  dbms: Dbms = "postgresql",
  version: string | undefined = "18",
  options: Partial<DdlOptions> = {},
) {
  const result = generateDdl(toLogicalModel(doc), { dbms, version }, options);
  if (!result.ok) {
    throw new Error(result.error);
  }
  return result;
}

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
    comment: ["comment"],
    trigger: ["trigger"],
    index: ["index", "physical"],
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
