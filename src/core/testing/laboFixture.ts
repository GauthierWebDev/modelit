import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { PGlite } from "@electric-sql/pglite";
import type { Dbms } from "../dbms/dbms";
import { generateDdl } from "../ddl/generate";
import { toLogicalModel } from "../mld/transform";
import type { ModelDocument } from "../model/document";
import { emptyDocument } from "../model/factory";
import type { DdlOptions } from "../model/settings";
import { reverseEngineer } from "../reverse/build";
import { catalogOf, diffCatalogs } from "./catalog";

/**
 * Fixture de l'aller-retour LDD → MCD → LDD sur le script réel du laboratoire (override O-29).
 * `fixtures/labo_sqlite.sql` : cycle chercheur ↔ Laboratoire, réflexives, FK composites,
 * colonnes partagées, contraintes nommées, CHECK, DEFAULT, index, nom quoté.
 */
export const SOURCE = readFileSync("fixtures/labo_sqlite.sql", "utf8");

export function reverse(sql = SOURCE) {
  return reverseEngineer(sql, emptyDocument());
}

export function generate(doc: ModelDocument, dbms: Dbms, version?: string, options: Partial<DdlOptions> = {}) {
  const result = generateDdl(toLogicalModel(doc), { dbms, version }, options);
  if (!result.ok) {
    throw new Error(result.error);
  }
  return result;
}

export const laboDoc = () => reverse().doc;

export const statements = (sql: string) =>
  sql
    .split(/;\s*\n/)
    .map((s) => s.replace(/^\s*--.*$/gm, "").trim())
    .filter(Boolean);

/** Script sans le rapport de pertes en tête. */
export const body = (sql: string) => sql.replace(/^(--.*\n)+\n/, "");

export const createTable = (sql: string, table: string) =>
  statements(sql).find((s) => new RegExp(`^CREATE TABLE ["\`\\[]?${table}["\`\\]]?\\(`, "i").test(s))!;

/** Structure lue par SQLite lui-même (PRAGMA), indépendante de notre parseur. */
export function sqliteIntrospect(sql: string) {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(sql);
  const tables = (
    db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .all() as { name: string }[]
  ).map((t) => t.name);
  const result = tables.map((table) => tableStructure(db, table));
  db.close();
  return result;
}

/** Clé primaire, colonnes, clés étrangères (groupées par contrainte) et index d'une table. */
function tableStructure(db: DatabaseSync, table: string) {
  const pk = (db.prepare(`PRAGMA table_info("${table}")`).all() as { name: string; pk: number }[])
    .filter((c) => c.pk)
    .sort((a, b) => a.pk - b.pk)
    .map((c) => c.name);
  const columns = (db.prepare(`PRAGMA table_info("${table}")`).all() as Record<string, unknown>[]).map((c) => ({
    name: c.name,
    type: String(c.type).replace(/\s+/g, "").toUpperCase(),
    notnull: c.notnull,
    dflt: c.dflt_value,
    pk: c.pk,
  }));
  const groupedFks = foreignKeys(db, table);
  const indexes = indexList(db, table);
  const sort = <T>(list: T[]) => [...list].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return { table, pk, columns, fks: sort(groupedFks), indexes: sort(indexes) };
}

/** Clés étrangères d'une table, une entrée par contrainte (colonnes dans l'ordre). */
function foreignKeys(db: DatabaseSync, table: string) {
  const fks = (db.prepare(`PRAGMA foreign_key_list("${table}")`).all() as Record<string, unknown>[]).map((f) => {
    const referencedPk = (db.prepare(`PRAGMA table_info("${String(f.table)}")`).all() as { name: string; pk: number }[])
      .filter((c) => c.pk)
      .sort((a, b) => a.pk - b.pk);
    return {
      id: f.id,
      seq: f.seq,
      table: f.table,
      from: f.from,
      to: f.to ?? referencedPk[Number(f.seq)]!.name,
      onUpdate: f.on_update,
      onDelete: f.on_delete,
    };
  });
  const groups = new Map<unknown, typeof fks>();
  for (const f of fks) {
    groups.set(f.id, [...(groups.get(f.id) ?? []), f]);
  }
  return [...groups.values()].map((group) => ({
    table: group[0]!.table,
    from: group.map((f) => f.from),
    to: group.map((f) => f.to),
    onUpdate: group[0]!.onUpdate,
    onDelete: group[0]!.onDelete,
  }));
}

/** Index d'une table ; nom gardé s'il n'est pas engendré par SQLite. */
function indexList(db: DatabaseSync, table: string) {
  return (db.prepare(`PRAGMA index_list("${table}")`).all() as { name: string; unique: number; origin: string }[]).map(
    (i) => ({
      unique: i.unique,
      origin: i.origin,
      columns: (db.prepare(`PRAGMA index_info("${i.name}")`).all() as { name: string }[]).map((c) => c.name),
      name: i.origin === "c" || !i.name.startsWith("sqlite_autoindex") ? i.name : undefined,
    }),
  );
}

/**
 * Problèmes d'un script PostgreSQL au regard de la source : exécution refusée par PostgreSQL
 * (PGlite), table créée avant une table qu'elle référence en ligne, et toute différence de
 * catalogue non annoncée par le rapport de pertes de l'en-tête. Vide = script fidèle.
 */
export async function pgProblems(sql: string): Promise<string[]> {
  const problems: string[] = [];
  const pg = new PGlite();
  try {
    await pg.exec(sql);
  } catch (e) {
    problems.push(`exécution : ${String((e as Error).message)}`);
  } finally {
    await pg.close();
  }
  const created: string[] = [];
  for (const statement of statements(sql)) {
    const create = /^CREATE TABLE ("?)(\w+)\1\(/i.exec(statement);
    if (!create) {
      continue;
    }
    for (const [, ref] of statement.matchAll(/REFERENCES "?(\w+)"?\s*\(/gi)) {
      if (ref!.toLowerCase() !== create[2]!.toLowerCase() && !created.includes(ref!.toLowerCase())) {
        problems.push(`ordre : ${create[2]} référence ${ref} avant sa création`);
      }
    }
    created.push(create[2]!.toLowerCase());
  }
  const announced = sql.match(/^-- {3}• .*$/gm) ?? [];
  for (const d of diffCatalogs(catalogOf(SOURCE, "sqlite"), catalogOf(sql, "postgresql"), true)) {
    const where = [d.table, d.column].filter(Boolean).join(".");
    if (!announced.some((line) => line.toLowerCase().includes(where.toLowerCase()))) {
      problems.push(`non annoncé : ${where} ${d.category} ${d.detail}`);
    }
  }
  return problems;
}
