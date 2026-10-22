import { describe, expect, it } from "vitest";
import {
  docker,
  expected,
  MEDIATHEQUE,
  MSSQL_PASSWORD,
  normalizeExpected,
  observed,
  rows,
  running,
  script,
} from "../testing/sgbdHarness";

/**
 * Exécution réelle des scripts générés sur MySQL, SQL Server et Oracle (override O-29, critère 2).
 * Opt-in : `scripts/sgbd.sh up && scripts/sgbd.sh wait && pnpm test:sgbd`.
 * Vérifie que le script passe sans erreur et que le SGBD contient exactement les contraintes
 * écrites (clés primaires et étrangères, UNIQUE, CHECK) avec leurs actions référentielles.
 */

describe.runIf(process.env.SGBD_DOCKER)("exécution réelle sur SGBD (Docker)", () => {
  it.runIf(running("merise-mysql"))("MySQL 8.4", () => {
    const sql = script("mysql", "8.4");
    const mysql = (input: string, db = "") =>
      docker(["exec", "-i", "merise-mysql", "mysql", "-uroot", "-proot", "-N", "-B", ...(db ? [db] : [])], input);
    mysql("DROP DATABASE IF EXISTS labo; CREATE DATABASE labo;");
    mysql(sql, "labo");
    const constraints = rows(
      mysql("SELECT CONSTRAINT_TYPE FROM information_schema.TABLE_CONSTRAINTS WHERE TABLE_SCHEMA = 'labo';"),
    );
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
});

describe.runIf(process.env.SGBD_DOCKER)("exécution réelle sur SGBD (Docker)", () => {
  it.runIf(running("merise-mssql"))("SQL Server 2022", () => {
    const sql = script("sqlserver", "2022");
    const sqlcmd = (input: string, db = "master") =>
      docker(
        [
          "exec",
          "-i",
          "merise-mssql",
          "/opt/mssql-tools18/bin/sqlcmd",
          "-C",
          "-S",
          "localhost",
          "-U",
          "sa",
          "-P",
          MSSQL_PASSWORD,
          "-d",
          db,
          "-b",
          "-h",
          "-1",
          "-W",
          "-s",
          "|",
          "-i",
          "/dev/stdin",
        ],
        input,
      );
    sqlcmd("SET NOCOUNT ON; DROP DATABASE IF EXISTS labo;\nGO\nCREATE DATABASE labo;\nGO\n");
    sqlcmd(sql, "labo");
    const constraints = rows(
      sqlcmd("SET NOCOUNT ON; SELECT type FROM sys.objects WHERE type IN ('PK', 'F', 'UQ', 'C');", "labo"),
    );
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
});

describe.runIf(process.env.SGBD_DOCKER)("exécution réelle sur SGBD (Docker)", () => {
  it.runIf(running("merise-oracle"))("Oracle 23ai", () => {
    const sql = script("oracle", "23ai");
    const sqlplus = (input: string, user = "system/oracle") =>
      docker(
        ["exec", "-i", "merise-oracle", "sqlplus", "-s", `${user}@localhost/FREEPDB1`],
        `WHENEVER SQLERROR EXIT FAILURE\nSET SQLBLANKLINES ON\nSET HEADING OFF\nSET FEEDBACK OFF\nSET PAGESIZE 0\nSET LINESIZE 400\nSET COLSEP '|'\n${input}\nEXIT\n`,
      );
    sqlplus(
      "DROP USER IF EXISTS labo CASCADE;\nCREATE USER labo IDENTIFIED BY labo QUOTA UNLIMITED ON users;\nGRANT CREATE SESSION, CREATE TABLE, CREATE SEQUENCE TO labo;",
    );
    sqlplus(sql, "labo/labo");
    // Les NOT NULL sont aussi des contraintes C pour Oracle : écartées.
    const constraints = rows(
      sqlplus(
        "SELECT constraint_type FROM user_constraints WHERE NOT (constraint_type = 'C' AND search_condition_vc LIKE '% IS NOT NULL');",
        "labo/labo",
      ),
    );
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

describe.runIf(process.env.SGBD_DOCKER)("MySQL 8.4 : médiathèque (Docker)", () => {
  const mysql = (input: string, db = "") =>
    docker(["exec", "-i", "merise-mysql", "mysql", "-uroot", "-proot", "-N", "-B", ...(db ? [db] : [])], input);

  it.runIf(running("merise-mysql"))("la source et sa régénération MySQL s'exécutent", () => {
    mysql(MEDIATHEQUE); // crée et remplit la base « mediatheque »
    mysql("DROP DATABASE IF EXISTS mediatheque_regen; CREATE DATABASE mediatheque_regen;");
    mysql(script("mysql", "8.4", MEDIATHEQUE), "mediatheque_regen");
    const count = (db: string) =>
      mysql(`SELECT count(*) FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = '${db}';`).trim();
    expect(count("mediatheque_regen")).toBe(count("mediatheque"));
  });
});
