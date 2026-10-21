import { describe, expect, it } from "vitest";
import { toLogicalModel } from "../mld/transform";
import { emptyDocument } from "../model/factory";
import { reverseEngineer } from "../reverse/build";
import { doc, generate, issues } from "../testing/aeroFixture";
import { generateDdl } from "./generate";

/** Itération 11 (override O-42) : script SQL Server de la fixture aero → PostgreSQL 18. */

/** Script PostgreSQL 18 généré depuis la fixture SQL Server, et ses extraits. */
function pg18Script() {
  const { sql, losses } = generate();
  const create = (name: string) => {
    const chunk = sql.split(/;\s*\n/).find((x) => new RegExp(`^CREATE TABLE (ref\\.)?${name}\\(`, "m").test(x))!;
    return chunk.slice(chunk.indexOf("CREATE TABLE"));
  };
  const lines = sql.match(/^-- {3}• .*$/gm) ?? [];
  return { sql, losses, create, lines };
}

describe("itération 11 — SQL Server → PostgreSQL 18 (O-42)", () => {
  const { sql, losses, create } = pg18Script();

  it("1. types spatiaux : CREATE EXTENSION postgis en tête de script (option par défaut)", () => {
    expect(sql.split("\n\n").find((x) => !x.startsWith("--"))).toBe("CREATE EXTENSION IF NOT EXISTS postgis;");
    expect(create("aeroport")).toContain("position GEOGRAPHY");
  });

  it("2. MONEY → NUMERIC(19,4), SMALLMONEY → NUMERIC(10,4), jamais MONEY", () => {
    expect(create("reservation")).toContain("prix NUMERIC(19,4) NOT NULL");
    expect(sql).not.toMatch(/\bMONEY\b/);
    expect(losses.some((l) => /MONEY/.test(l.message))).toBe(false);
    const { doc: small } = reverseEngineer(
      "CREATE TABLE t (id INT PRIMARY KEY, m SMALLMONEY);",
      emptyDocument(),
      "sqlserver",
    );
    const result = generateDdl(toLogicalModel(small), { dbms: "postgresql", version: "18" });
    expect(result.ok && result.sql).toContain("m NUMERIC(10,4)");
  });

  it("3. DEFAULT : SYSUTCDATETIME / GETUTCDATE → heure UTC, GETDATE / SYSDATETIME → LOCALTIMESTAMP, SYSDATETIMEOFFSET → CURRENT_TIMESTAMP", () => {
    expect(create("reservation")).toContain("reserve_le TIMESTAMP(3) DEFAULT (now() AT TIME ZONE 'UTC') NOT NULL");
    expect(create("passager")).toContain("cree_le TIMESTAMP(3) DEFAULT LOCALTIMESTAMP NOT NULL");
    const { doc: other } = reverseEngineer(
      "CREATE TABLE t (id INT PRIMARY KEY, a DATETIME2 DEFAULT SYSDATETIME(), b DATETIME DEFAULT GETUTCDATE(), c DATETIMEOFFSET DEFAULT SYSDATETIMEOFFSET());",
      emptyDocument(),
      "sqlserver",
    );
    const result = generateDdl(toLogicalModel(other), { dbms: "postgresql", version: "18" });
    expect(result.ok && result.sql).toContain("a TIMESTAMP DEFAULT LOCALTIMESTAMP");
    expect(result.ok && result.sql).toContain("b TIMESTAMP(3) DEFAULT (now() AT TIME ZONE 'UTC')");
    expect(result.ok && result.sql).toContain("c TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP");
  });
});

describe("itération 11 — SQL Server → PostgreSQL 18 (O-42)", () => {
  const { sql, create, lines } = pg18Script();

  it("3. règle générale : un DEFAULT abandonné sur une colonne NOT NULL est une entrée P0 explicite", () => {
    const { doc: other } = reverseEngineer(
      "CREATE TABLE t (id INT PRIMARY KEY, a VARCHAR(10) NOT NULL DEFAULT dbo.f());",
      emptyDocument(),
      "sqlserver",
    );
    const result = generateDdl(toLogicalModel(other), { dbms: "postgresql", version: "18" });
    expect(result.ok && result.losses).toContainEqual(
      expect.objectContaining({
        priority: "P0",
        column: "a",
        message: expect.stringContaining("un INSERT sans valeur"),
      }),
    );
    expect(result.ok && result.sql).toMatch(/^-- {3}• \[P0\] t\.a — DEFAULT/m);
  });

  it("4. collation par défaut supposée CI_AS → ICU und-u-ks-level2 ; *_CS_AS déterministe ; hypothèse au rapport", () => {
    expect(sql).toContain(
      "CREATE COLLATION IF NOT EXISTS merise_ci (provider = icu, locale = 'und-u-ks-level2', deterministic = false);",
    );
    expect(create("aeroport")).toContain("code_iata CHAR(3) COLLATE merise_ci");
    expect(create("vol")).toContain("numero VARCHAR(7) NOT NULL"); // Latin1_General_CS_AS
    expect(lines).toContain(
      "--   • hypothèse : collation par défaut de la base SQL Server Latin1_General_CI_AS (absente du script), appliquée aux textes sans collation déclarée",
    );
    const csas = generate("postgresql", "18", { sqlServerCollation: "cs_as" });
    expect(csas.sql).not.toContain("merise_ci");
  });

  it("5. schémas : CREATE SCHEMA ref (créé par EXEC dynamique), tables et séquences qualifiées ; dbo → public (option)", () => {
    expect(sql).toContain("CREATE SCHEMA IF NOT EXISTS ref;");
    expect(sql).toContain("CREATE SEQUENCE ref.seq_client AS INTEGER START WITH 10000 INCREMENT BY 1 CACHE 1;");
    expect(sql).toContain("CREATE TABLE ref.aeroport(");
    expect(sql).toContain("REFERENCES ref.aeroport(code_iata)");
    expect(sql).toContain("DEFAULT nextval('ref.seq_client')");
    expect(sql).toContain("CREATE TABLE vol(");
    const dbo = generate("postgresql", "18", { dboSchema: "dbo" });
    expect(dbo.sql).toContain("CREATE SCHEMA IF NOT EXISTS dbo;");
    expect(dbo.sql).toContain("CREATE TABLE dbo.vol(");
  });
});

describe("itération 11 — SQL Server → PostgreSQL 18 (O-42)", () => {
  const { sql, losses, create, lines } = pg18Script();

  it('6. CHECK : LEN → char_length, LIKE à classes → expression rationnelle (~*, COLLATE "C"), ISJSON → IS JSON', () => {
    expect(create("aeroport")).toContain(
      `CONSTRAINT ck_aeroport_iata CHECK (char_length(code_iata) = 3 AND code_iata COLLATE "C" !~* '^.*[^A-Z].*$')`,
    );
    expect(create("passager")).toContain("CONSTRAINT ck_passager_json CHECK (preferences IS JSON)");
    expect(losses.some((l) => l.category === "check" && /len|ISJSON/i.test(l.message))).toBe(false);
  });

  it("7. TINYINT → SMALLINT + CHECK (BETWEEN 0 AND 255), même avec un autre CHECK (désactivé)", () => {
    expect(create("passager")).toContain(
      `"Remise [%]" SMALLINT DEFAULT 0 NOT NULL CHECK ("Remise [%]" BETWEEN 0 AND 255)`,
    );
  });

  it("8. rapport : DATETIMEOFFSET, DATETIME (1/300 s), NOT FOR REPLICATION, ROWGUIDCOL (une ligne chacun)", () => {
    expect(lines).toEqual(
      expect.arrayContaining([
        expect.stringMatching(
          /DATETIMEOFFSET → TIMESTAMPTZ\(0\) : le décalage horaire d'origine est perdu.* : vol\.heure_depart, vol\.heure_arrivee$/,
        ),
        expect.stringMatching(/passager\.cree_le — DATETIME → TIMESTAMP\(3\) : arrondi d'origine au 1\/300 s/),
        expect.stringMatching(/vol\.id_vol — NOT FOR REPLICATION/),
        expect.stringMatching(/passager\.id_passager — ROWGUIDCOL/),
      ]),
    );
  });

  it("9. NEWSEQUENTIALID() → uuidv7() en PostgreSQL 18, gen_random_uuid() avant (signalé)", () => {
    expect(create("passager")).toContain("id_passager UUID DEFAULT uuidv7()");
    expect(losses.some((l) => /NEWSEQUENTIALID/.test(l.message))).toBe(false);
    const pg17 = generate("postgresql", "17");
    expect(pg17.sql).toContain("id_passager UUID DEFAULT gen_random_uuid()");
    expect(pg17.losses).toContainEqual(
      expect.objectContaining({ column: "id_passager", message: expect.stringContaining("NEWSEQUENTIALID()") }),
    );
  });

  it("10. INCLUDE conservé (PostgreSQL 11+), plus classé en stockage", () => {
    expect(sql).toContain(
      "CREATE UNIQUE INDEX ux_resa_siege ON reservation(id_vol, siege) INCLUDE (classe) WHERE siege IS NOT NULL AND annule = FALSE;",
    );
    expect(lines.find((l) => /clauses de stockage/.test(l))).not.toMatch(/INCLUDE/);
  });

  it("11. IDENTITY(100, 10) → GENERATED ALWAYS AS IDENTITY (START WITH 100 INCREMENT BY 10)", () => {
    expect(create("vol")).toContain("id_vol INTEGER GENERATED ALWAYS AS IDENTITY (START WITH 100 INCREMENT BY 10)");
  });
});

describe("itération 11 — SQL Server → PostgreSQL 18 (O-42)", () => {
  const { sql, lines } = pg18Script();

  it("12. vocabulaire du dialecte source dans le rapport et le script (NOCHECK CONSTRAINT)", () => {
    expect(lines).toContain(
      "--   • passager — contrainte ck_passager_remise désactivée (NOCHECK CONSTRAINT) dans la source : émise en commentaire, non appliquée",
    );
    expect(sql).toContain(
      `-- CONSTRAINT ck_passager_remise CHECK ("Remise [%]" <= 100) -- désactivée (NOCHECK CONSTRAINT) dans la source : non appliquée`,
    );
  });

  it("13. index filtré à autre terme que IS NOT NULL : unicité conditionnelle, pas d'identifiant alternatif", () => {
    const reservation = doc.associations.find((a) => a.name === "reservation")!;
    expect(reservation.alternateKeys).toEqual([
      expect.objectContaining({ name: "ux_resa_siege", where: expect.anything() }),
    ]);
    expect(issues).toContainEqual(expect.stringContaining("« reservation » : unicité conditionnelle"));
  });
});
