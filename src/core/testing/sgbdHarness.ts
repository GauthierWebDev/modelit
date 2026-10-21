import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import type { Dbms } from "../dbms/dbms";
import { generateDdl } from "../ddl/generate";
import { toLogicalModel } from "../mld/transform";
import { emptyDocument } from "../model/factory";
import { reverseEngineer } from "../reverse/build";
import { parseSql } from "../reverse/parse";
import { catalogOf } from "./catalog";
import { byCodeUnit } from "./order";

/** Scripts et accès aux SGBD de test dans Docker (`pnpm test:sgbd`, override O-29, critère 2). */

export const MSSQL_PASSWORD = "ModelIt-2026";
export const SOURCE = readFileSync("fixtures/labo_sqlite.sql", "utf8");
export const MEDIATHEQUE = readFileSync("fixtures/mediatheque_mysql.sql", "utf8");
export const HOPITAL = readFileSync("fixtures/hopital_oracle.sql", "utf8");
export const AERO = readFileSync("fixtures/aero_sqlserver.sql", "utf8");

export function script(dbms: Dbms, version: string, source = SOURCE) {
  const result = generateDdl(toLogicalModel(reverseEngineer(source, emptyDocument()).doc), { dbms, version });
  if (!result.ok) {
    throw new Error(result.error);
  }
  return result.sql;
}

export const docker = (args: string[], input?: string) =>
  execFileSync("docker", args, { input, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });

/**
 * SGBD exigés (CI : `SGBD_REQUIRED=postgres,mysql`) : leurs tests s'exécutent même si le conteneur
 * ne répond pas — et échouent alors, au lieu d'être ignorés en silence.
 */
export const REQUIRED = new Set(
  (process.env.SGBD_REQUIRED ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
);

export const running = (name: string) => {
  if (REQUIRED.has(name.replace(/^merise-/, ""))) {
    return true;
  }
  try {
    return docker(["inspect", "-f", "{{.State.Running}}", name]).trim() === "true";
  } catch {
    return false;
  }
};

export interface Observed {
  counts: Record<"primary" | "foreign" | "unique" | "check", number>;
  /** « table(colonnes) → ON DELETE x ON UPDATE y », triés. */
  actions: string[];
}

/** Ce que le script demande, d'après son propre catalogue. */
export function expected(sql: string, dbms: Dbms): Observed {
  const catalog = catalogOf(sql, dbms);
  return {
    counts: {
      primary: catalog.filter((t) => t.primaryKey.columns.length).length,
      foreign: catalog.reduce((n, t) => n + t.foreignKeys.length, 0),
      unique: catalog.reduce((n, t) => n + t.uniques.length, 0),
      // CHECK écrits dans le script (le catalogue range ceux de domaine parmi les propriétés des colonnes).
      check: parseSql(sql).tables.reduce((n, t) => n + t.checks.length + t.columns.filter((c) => c.check).length, 0),
    },
    actions: catalog
      .flatMap((t) =>
        t.foreignKeys.map(
          (fk) => `${t.name.toLowerCase()}(${fk.columns.join(",").toLowerCase()}) ${fk.onDelete} ${fk.onUpdate}`,
        ),
      )
      .sort(),
  };
}

export const rows = (text: string) =>
  text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !/^-+$/.test(l) && !/rows? (affected|selected)/i.test(l))
    .map((l) => l.split(/\s*\|\s*|\t/));

export function observed(constraints: string[][], actions: string[][]): Observed {
  const count = (types: string[]) => constraints.filter(([type]) => types.includes(type!.toUpperCase())).length;
  // Absence de clause : NO ACTION (Oracle et SQL Server n'ont pas de RESTRICT distinct).
  const action = (a: string) =>
    a
      .toLowerCase()
      .replace(/_/g, " ")
      .replace(/^restrict$/, "no action");
  return {
    counts: {
      primary: count(["PRIMARY KEY", "P", "PK"]),
      foreign: count(["FOREIGN KEY", "R", "F"]),
      unique: count(["UNIQUE", "U", "UQ"]),
      check: count(["CHECK", "C"]),
    },
    actions: actions
      .map(
        ([table, columns, del, upd]) =>
          `${table!.toLowerCase()}(${columns!.toLowerCase()}) ${action(del!)} ${action(upd!)}`,
      )
      .sort(byCodeUnit),
  };
}

export const normalizeExpected = (e: Observed): Observed => ({
  ...e,
  actions: e.actions.map((a) => a.replace(/\brestrict\b/g, "no action")),
});
