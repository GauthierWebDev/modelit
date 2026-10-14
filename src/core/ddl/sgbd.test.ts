import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Dbms } from "../dbms/dbms";
import { toLogicalModel } from "../mld/transform";
import { emptyDocument } from "../model/factory";
import { reverseEngineer } from "../reverse/build";
import { parseSql } from "../reverse/parse";
import { catalogOf } from "../testing/catalog";
import { generateDdl } from "./generate";

/**
 * Exécution réelle des scripts générés sur MySQL, SQL Server et Oracle (override O-29, critère 2).
 * Opt-in : `scripts/sgbd.sh up && scripts/sgbd.sh wait && pnpm test:sgbd`.
 * Vérifie que le script passe sans erreur et que le SGBD contient exactement les contraintes
 * écrites (clés primaires et étrangères, UNIQUE, CHECK) avec leurs actions référentielles.
 */

const MSSQL_PASSWORD = "ModelIt-2026";
const SOURCE = readFileSync("fixtures/labo_sqlite.sql", "utf8");
const MEDIATHEQUE = readFileSync("fixtures/mediatheque_mysql.sql", "utf8");
const HOPITAL = readFileSync("fixtures/hopital_oracle.sql", "utf8");
const AERO = readFileSync("fixtures/aero_sqlserver.sql", "utf8");

function script(dbms: Dbms, version: string, source = SOURCE) {
  const result = generateDdl(toLogicalModel(reverseEngineer(source, emptyDocument()).doc), { dbms, version });
  if (!result.ok) throw new Error(result.error);
  return result.sql;
}

const docker = (args: string[], input?: string) => execFileSync("docker", args, { input, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });

/**
 * SGBD exigés (CI : `SGBD_REQUIRED=postgres,mysql`) : leurs tests s'exécutent même si le conteneur
 * ne répond pas — et échouent alors, au lieu d'être ignorés en silence.
 */
const REQUIRED = new Set((process.env.SGBD_REQUIRED ?? "").split(",").map((s) => s.trim()).filter(Boolean));

const running = (name: string) => {
  if (REQUIRED.has(name.replace(/^merise-/, ""))) return true;
  try {
    return docker(["inspect", "-f", "{{.State.Running}}", name]).trim() === "true";
  } catch {
    return false;
  }
};

interface Observed {
  counts: Record<"primary" | "foreign" | "unique" | "check", number>;
  /** « table(colonnes) → ON DELETE x ON UPDATE y », triés. */
  actions: string[];
}

/** Ce que le script demande, d'après son propre catalogue. */
function expected(sql: string, dbms: Dbms): Observed {
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
      .flatMap((t) => t.foreignKeys.map((fk) => `${t.name.toLowerCase()}(${fk.columns.join(",").toLowerCase()}) ${fk.onDelete} ${fk.onUpdate}`))
      .sort(),
  };
}

const rows = (text: string) =>
  text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !/^-+$/.test(l) && !/rows? (affected|selected)/i.test(l))
    .map((l) => l.split(/\s*\|\s*|\t/));

function observed(constraints: string[][], actions: string[][]): Observed {
  const count = (types: string[]) => constraints.filter(([type]) => types.includes(type!.toUpperCase())).length;
  // Absence de clause : NO ACTION (Oracle et SQL Server n'ont pas de RESTRICT distinct).
  const action = (a: string) => a.toLowerCase().replace(/_/g, " ").replace(/^restrict$/, "no action");
  return {
    counts: { primary: count(["PRIMARY KEY", "P", "PK"]), foreign: count(["FOREIGN KEY", "R", "F"]), unique: count(["UNIQUE", "U", "UQ"]), check: count(["CHECK", "C"]) },
    actions: actions.map(([table, columns, del, upd]) => `${table!.toLowerCase()}(${columns!.toLowerCase()}) ${action(del!)} ${action(upd!)}`).sort(),
  };
}

const normalizeExpected = (e: Observed): Observed => ({
  ...e,
  actions: e.actions.map((a) => a.replace(/\brestrict\b/g, "no action")),
});

describe.runIf(process.env.SGBD_DOCKER)("exécution réelle sur SGBD (Docker)", () => {
  it.runIf(running("merise-mysql"))("MySQL 8.4", () => {
    const sql = script("mysql", "8.4");
    const mysql = (input: string, db = "") => docker(["exec", "-i", "merise-mysql", "mysql", "-uroot", "-proot", "-N", "-B", ...(db ? [db] : [])], input);
    mysql("DROP DATABASE IF EXISTS labo; CREATE DATABASE labo;");
    mysql(sql, "labo");
    const constraints = rows(mysql("SELECT CONSTRAINT_TYPE FROM information_schema.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA = 'labo';"));
    const actions = rows(
      mysql(`SELECT r.TABLE_NAME, GROUP_CONCAT(k.COLUMN_NAME ORDER BY k.ORDINAL_POSITION), r.DELETE_RULE, r.UPDATE_RULE
             FROM information_schema.REFERENTIAL_CONSTRAINTS r JOIN information_schema.KEY_COLUMN_USAGE k
               ON k.CONSTRAINT_SCHEMA = r.CONSTRAINT_SCHEMA AND k.CONSTRAINT_NAME = r.CONSTRAINT_NAME AND k.TABLE_NAME = r.TABLE_NAME
             WHERE r.CONSTRAINT_SCHEMA = 'labo' GROUP BY r.TABLE_NAME, r.CONSTRAINT_NAME, r.DELETE_RULE, r.UPDATE_RULE;`),
    );
    // MySQL distingue RESTRICT de NO ACTION dans le catalogue : comparaison exacte.
    const seen = observed(constraints, actions);
    const wanted = expected(sql, "mysql");
    expect(seen.counts).toEqual(wanted.counts);
    expect(seen.actions.map((a) => a.replace(/\brestrict\b/g, "no action"))).toEqual(normalizeExpected(wanted).actions);
  });

  it.runIf(running("merise-mssql"))("SQL Server 2022", () => {
    const sql = script("sqlserver", "2022");
    const sqlcmd = (input: string, db = "master") =>
      docker(["exec", "-i", "merise-mssql", "/opt/mssql-tools18/bin/sqlcmd", "-C", "-S", "localhost", "-U", "sa", "-P", MSSQL_PASSWORD, "-d", db, "-b", "-h", "-1", "-W", "-s", "|", "-i", "/dev/stdin"], input);
    sqlcmd("SET NOCOUNT ON; DROP DATABASE IF EXISTS labo;\nGO\nCREATE DATABASE labo;\nGO\n");
    sqlcmd(sql, "labo");
    const constraints = rows(sqlcmd("SET NOCOUNT ON; SELECT type FROM sys.objects WHERE type IN ('PK', 'F', 'UQ', 'C');", "labo"));
    const actions = rows(
      sqlcmd(
        `SET NOCOUNT ON;
         SELECT OBJECT_NAME(f.parent_object_id), STRING_AGG(COL_NAME(c.parent_object_id, c.parent_column_id), ',') WITHIN GROUP (ORDER BY c.constraint_column_id),
                f.delete_referential_action_desc, f.update_referential_action_desc
         FROM sys.foreign_keys f JOIN sys.foreign_key_columns c ON c.constraint_object_id = f.object_id
         GROUP BY f.object_id, f.parent_object_id, f.delete_referential_action_desc, f.update_referential_action_desc;`,
        "labo",
      ),
    );
    const seen = observed(constraints, actions);
    const wanted = normalizeExpected(expected(sql, "sqlserver"));
    expect(seen.counts).toEqual(wanted.counts);
    expect(seen.actions).toEqual(wanted.actions);
  });

  it.runIf(running("merise-oracle"))("Oracle 23ai", () => {
    const sql = script("oracle", "23ai");
    const sqlplus = (input: string, user = "system/oracle") =>
      docker(["exec", "-i", "merise-oracle", "sqlplus", "-s", `${user}@localhost/FREEPDB1`], `WHENEVER SQLERROR EXIT FAILURE\nSET SQLBLANKLINES ON\nSET HEADING OFF\nSET FEEDBACK OFF\nSET PAGESIZE 0\nSET LINESIZE 400\nSET COLSEP '|'\n${input}\nEXIT\n`);
    sqlplus("DROP USER IF EXISTS labo CASCADE;\nCREATE USER labo IDENTIFIED BY labo QUOTA UNLIMITED ON users;\nGRANT CREATE SESSION, CREATE TABLE, CREATE SEQUENCE TO labo;");
    sqlplus(sql, "labo/labo");
    // Les NOT NULL sont aussi des contraintes C pour Oracle : écartées.
    const constraints = rows(sqlplus("SELECT constraint_type FROM user_constraints WHERE NOT (constraint_type = 'C' AND search_condition_vc LIKE '% IS NOT NULL');", "labo/labo"));
    const actions = rows(
      sqlplus(
        `SELECT c.table_name || '|' || LISTAGG(k.column_name, ',') WITHIN GROUP (ORDER BY k.position) || '|' || c.delete_rule || '|NO ACTION'
         FROM user_constraints c JOIN user_cons_columns k ON k.constraint_name = c.constraint_name
         WHERE c.constraint_type = 'R' GROUP BY c.constraint_name, c.table_name, c.delete_rule;`,
        "labo/labo",
      ),
    );
    const seen = observed(constraints, actions);
    const wanted = normalizeExpected(expected(sql, "oracle"));
    expect(seen.counts).toEqual(wanted.counts);
    expect(seen.actions).toEqual(wanted.actions);
  });
});

/**
 * PostgreSQL 18 réel (override O-35, exécuté en CI) : les scripts générés passent, la sortie
 * d'avant ces travaux (fixtures/mediatheque_pg_v1.sql) échoue.
 */
describe.runIf(process.env.SGBD_DOCKER)("PostgreSQL 18 (Docker)", () => {
  const psql = (input: string, db = "postgres") =>
    docker(["exec", "-i", "merise-postgres", "psql", "-U", "postgres", "-d", db, "-v", "ON_ERROR_STOP=1", "-q", "-t", "-A"], input);
  const fresh = (db: string) => psql(`DROP DATABASE IF EXISTS ${db};\nCREATE DATABASE ${db};`);

  it.runIf(running("merise-postgres"))("version 18", () => {
    expect(psql("SHOW server_version;").trim()).toMatch(/^18\./);
  });

  it.runIf(running("merise-postgres"))("médiathèque (MySQL → PostgreSQL 18) : s'exécute", () => {
    fresh("mediatheque");
    psql(script("postgresql", "18", MEDIATHEQUE), "mediatheque");
    const tables = psql("SELECT count(*) FROM pg_tables WHERE schemaname = 'public';", "mediatheque").trim();
    expect(tables).toBe("5");
    // Colonne virtuelle (PostgreSQL 18) et index unique sur préfixe présents.
    expect(psql("SELECT attgenerated FROM pg_attribute WHERE attrelid = 'emprunt'::regclass AND attname = 'date_retour_prevue';", "mediatheque").trim()).toBe("v");
    expect(psql("SELECT indexdef FROM pg_indexes WHERE indexname = 'uq_email_prefixe';", "mediatheque")).toMatch(/left"?\(\(email\)::text, 100\)/);
  });

  it.runIf(running("merise-postgres"))("collations _ci / _ai → ICU non déterministe : comportement de MySQL (O-37, O-38)", () => {
    fresh("mediatheque_ci");
    psql(script("postgresql", "18", MEDIATHEQUE), "mediatheque_ci");
    // Définition effective : TEXT[] COLLATE merise_ai_ci, et num_carte sous la même collation.
    expect(
      psql(
        "SELECT a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || c.collname FROM pg_attribute a JOIN pg_collation c ON c.oid = a.attcollation WHERE a.attrelid = 'adherent'::regclass AND a.attname IN ('centres_interet', 'num_carte') ORDER BY a.attname;",
        "mediatheque_ci",
      ).trim().split("\n"),
    ).toEqual(["centres_interet:text[]:merise_ai_ci", "num_carte:character(10):merise_ai_ci"]);
    // 'ABC123' puis 'abc123' : la seconde est rejetée (UNIQUE insensible à la casse).
    psql("INSERT INTO adherent (num_carte, nom, email) VALUES ('ABC123', 'Zoé', 'Zoe@Exemple.fr');", "mediatheque_ci");
    expect(() => psql("INSERT INTO adherent (num_carte, nom, email) VALUES ('abc123', 'Autre', 'autre@x.fr');", "mediatheque_ci")).toThrow(/duplicate key.*num_carte/s);
    // CHECK <@ sur TEXT[] COLLATE merise_ai_ci : casse différente acceptée, valeur hors domaine refusée.
    psql("UPDATE adherent SET centres_interet = '{roman,BD}' WHERE num_carte = 'ABC123';", "mediatheque_ci");
    expect(() => psql("UPDATE adherent SET centres_interet = '{roman,polar}' WHERE num_carte = 'ABC123';", "mediatheque_ci")).toThrow(/check constraint/);
    // Recherche insensible à la casse et aux accents, LIKE (PostgreSQL 18).
    expect(psql("SELECT count(*) FROM adherent WHERE email = 'zoe@exemple.fr' AND nom = 'ZOE' AND nom LIKE 'zo%';", "mediatheque_ci").trim()).toBe("1");
  });

  it.runIf(running("merise-postgres"))("hôpital (Oracle → PostgreSQL 18) : s'exécute, séquence, unicités, états des contraintes (O-39)", () => {
    fresh("hopital");
    psql(script("postgresql", "18", HOPITAL), "hopital");
    const run = (sql: string) => psql(sql, "hopital").trim();
    run(`INSERT INTO service (code_service, libelle) VALUES ('CHIR', 'Chirurgie');
         INSERT INTO personnel (nom, fonction, code_service, email) VALUES ('Durand', 'MEDECIN', 'CHIR', 'A.Durand@chu.fr');
         INSERT INTO "Patient" (nir, nom, date_naissance) VALUES ('123456789012345', 'Zoé', '1980-01-01');`);
    // INSERT dans sejour sans sejour_id : identifiant tiré de seq_sejour.
    expect(run(`INSERT INTO sejour (patient_id, code_service, date_entree, duree_prevue) SELECT id, 'CHIR', '2026-10-14 10:00', INTERVAL '2 days' FROM "Patient" RETURNING sejour_id, date_sortie_prevue;`).split("\n")[0]).toBe("1|2026-10-16 10:00:00");
    // Unicité conditionnelle (un seul séjour en cours par patient), sur expression (e-mail sans casse).
    expect(() => run(`INSERT INTO sejour (patient_id, code_service, date_entree) SELECT id, 'CHIR', '2026-10-15' FROM "Patient";`)).toThrow(/ux_sejour_en_cours/);
    expect(() => run("INSERT INTO personnel (nom, fonction, code_service, email) VALUES ('B', 'ADMIN', 'CHIR', 'a.durand@CHU.fr');")).toThrow(/ux_personnel_email/);
    // NULLS NOT DISTINCT, chaîne vide refusée sur NOT NULL, échelle négative.
    expect(() => run("INSERT INTO service (code_service, libelle) VALUES ('X', 'Chirurgie');")).toThrow(/uq_service_libelle/);
    expect(() => run("INSERT INTO service (code_service, libelle) VALUES ('Y', '');")).toThrow(/check constraint/);
    expect(run("UPDATE service SET budget = 1234567 WHERE code_service = 'CHIR' RETURNING budget;").split("\n")[0]).toBe("1235000");
    // États : ck_intervenir_super NOT VALID, ck_intervenir_cout absente (DISABLE), fk_service_chef différée.
    expect(run("SELECT conname || ':' || convalidated FROM pg_constraint WHERE conname LIKE 'ck_intervenir%' ORDER BY 1;").split("\n")).toEqual(["ck_intervenir_super:false", "ck_intervenir_type:true"]);
    expect(run("SELECT condeferrable::text || condeferred::text FROM pg_constraint WHERE conname = 'fk_service_chef';")).toBe("truetrue");
    expect(run("SELECT format_type(atttypid, atttypmod) FROM pg_attribute WHERE attrelid = 'sejour'::regclass AND attname IN ('sejour_id', 'patient_id', 'date_entree', 'duree_prevue') ORDER BY attnum;").split("\n")).toEqual([
      "bigint",
      "uuid",
      "timestamp(0) without time zone",
      "interval day to second(0)",
    ]);
  });

  it.runIf(running("merise-postgres"))("aérien (SQL Server → PostgreSQL 18) sans PostGIS (option de repli) : s'exécute, CI_AS, DEFAULT (O-41, O-42)", () => {
    fresh("aero");
    const result = generateDdl(toLogicalModel(reverseEngineer(AERO, emptyDocument()).doc), { dbms: "postgresql", version: "18" }, { spatial: "wkb" });
    if (!result.ok) throw new Error(result.error);
    psql(result.sql, "aero");
    const run = (sql: string) => psql(sql, "aero").trim();
    run(`INSERT INTO ref.aeroport (code_iata, code_oaci, nom, ville, pays) VALUES ('CDG', 'LFPG', 'Roissy', 'Paris', 'FR'), ('ORY', NULL, 'Orly', 'Paris', 'FR');
         INSERT INTO passager (nom, email) VALUES ('A', 'a@x.fr');`);
    // Hypothèse CI_AS : 'cdg' rejeté si 'CDG' existe ; recherche insensible à la casse ; CHECK à classes.
    expect(() => run("INSERT INTO ref.aeroport (code_iata, code_oaci, nom, ville, pays) VALUES ('cdg', 'LFPX', 'X', 'Paris', 'FR');")).toThrow(/pk_aeroport/);
    expect(run("SELECT count(*) FROM ref.aeroport WHERE ville = 'PARIS';")).toBe("2");
    expect(() => run("INSERT INTO ref.aeroport (code_iata, code_oaci, nom, ville, pays) VALUES ('C1G', 'LFPY', 'X', 'X', 'FR');")).toThrow(/ck_aeroport_iata/);
    run("INSERT INTO ref.aeroport (code_iata, code_oaci, nom, ville, pays) VALUES ('bva', 'LFOB', 'Beauvais', 'Tillé', 'FR');"); // minuscules admises (CI)
    // Un seul NULL admis (SQL Server), conservé.
    expect(() => run("INSERT INTO ref.aeroport (code_iata, nom, ville, pays) VALUES ('LIL', 'Lille', 'Lille', 'FR');")).toThrow(/uq_aeroport_oaci/);
    expect(run("INSERT INTO vol (numero, depart, arrivee, heure_depart, heure_arrivee) VALUES ('AF1', 'CDG', 'ORY', now(), now() + interval '1 hour'), ('AF2', 'ORY', 'cdg', now(), now() + interval '2 hours') RETURNING id_vol;").split("\n")).toEqual(["100", "110"]);
    run("UPDATE vol SET vol_retour = 110 WHERE id_vol = 100;");
    expect(() => run("UPDATE vol SET vol_retour = 110 WHERE id_vol = 110;")).toThrow(/ux_vol_retour/);
    expect(run("SELECT num_client FROM passager;")).toBe("10000");
    // INSERT dans reservation sans reserve_le : DEFAULT (heure UTC) appliqué.
    expect(run("INSERT INTO reservation (id_vol, id_passager, prix) SELECT 100, id_passager, 200 FROM passager RETURNING reserve_le IS NOT NULL, prix_ttc;")).toBe("t|220.000000");
  });

  it.runIf(running("merise-postgis"))("aérien avec PostGIS (option par défaut) : CREATE EXTENSION postgis, GEOGRAPHY (O-42)", () => {
    const postgis = (input: string, db = "postgres") =>
      docker(["exec", "-i", "merise-postgis", "psql", "-U", "postgres", "-d", db, "-v", "ON_ERROR_STOP=1", "-q", "-t", "-A"], input);
    postgis("DROP DATABASE IF EXISTS aero;\nCREATE DATABASE aero;");
    postgis(script("postgresql", "18", AERO), "aero");
    postgis("INSERT INTO ref.aeroport (code_iata, code_oaci, nom, ville, pays, position) VALUES ('CDG', 'LFPG', 'Roissy', 'Paris', 'FR', 'SRID=4326;POINT(2.55 49.0097)');", "aero");
    expect(postgis("SELECT round(ST_Distance(position, 'SRID=4326;POINT(2.3522 48.8566)'::geography) / 1000) FROM ref.aeroport;", "aero").trim()).toBe("22");
  });

  it.runIf(running("merise-postgres"))("option sans ICU : collation déterministe, le script s'exécute (O-38)", () => {
    fresh("mediatheque_det");
    const result = generateDdl(toLogicalModel(reverseEngineer(MEDIATHEQUE, emptyDocument()).doc), { dbms: "postgresql", version: "18" }, { collations: "deterministic" });
    if (!result.ok) throw new Error(result.error);
    psql(result.sql, "mediatheque_det");
    psql("INSERT INTO adherent (num_carte, nom, email) VALUES ('ABC123', 'A', 'a@x'), ('abc123', 'B', 'b@x');", "mediatheque_det");
    expect(psql("SELECT count(*) FROM adherent;", "mediatheque_det").trim()).toBe("2"); // sensible à la casse : annoncé au rapport
  });

  it.runIf(running("merise-postgres"))("témoin négatif : la v1 échoue sur PostgreSQL 18", () => {
    fresh("mediatheque_v1");
    expect(() => psql(readFileSync("fixtures/mediatheque_pg_v1.sql", "utf8"), "mediatheque_v1")).toThrow(/boolean but default expression is of type integer/);
  });

  it.runIf(running("merise-postgres"))("laboratoire (SQLite → PostgreSQL 18) : s'exécute (non-régression)", () => {
    fresh("labo");
    psql(script("postgresql", "18"), "labo");
    expect(psql("SELECT count(*) FROM pg_constraint WHERE contype = 'f';", "labo").trim()).toBe("11");
  });
});

describe.runIf(process.env.SGBD_DOCKER)("MySQL 8.4 : médiathèque (Docker)", () => {
  const mysql = (input: string, db = "") => docker(["exec", "-i", "merise-mysql", "mysql", "-uroot", "-proot", "-N", "-B", ...(db ? [db] : [])], input);

  it.runIf(running("merise-mysql"))("la source et sa régénération MySQL s'exécutent", () => {
    mysql(MEDIATHEQUE); // crée et remplit la base « mediatheque »
    mysql("DROP DATABASE IF EXISTS mediatheque_regen; CREATE DATABASE mediatheque_regen;");
    mysql(script("mysql", "8.4", MEDIATHEQUE), "mediatheque_regen");
    const count = (db: string) => mysql(`SELECT count(*) FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = '${db}';`).trim();
    expect(count("mediatheque_regen")).toBe(count("mediatheque"));
  });
});
