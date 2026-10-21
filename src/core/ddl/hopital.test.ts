import { describe, expect, it } from "vitest";
import { toLogicalModel } from "../mld/transform";
import { emptyDocument } from "../model/factory";
import { reverseEngineer } from "../reverse/build";
import { catalogOf, diffCatalogs } from "../testing/catalog";
import { announced, generate, rejects, SOURCE, table, unjustified, V1 } from "../testing/hopitalFixture";
import { sharedPg } from "../testing/pglite";
import { generateDdl } from "./generate";

/**
 * Itération 8 (override O-39) : script Oracle réel (fixtures/hopital_oracle.sql) → PostgreSQL 18.
 * fixtures/hopital_pg_v1.sql : sortie d'avant ces travaux (témoin négatif).
 */

const withPg = sharedPg();

// ---------------------------------------------------------------------------------------------

describe("critères d'acceptation", () => {
  it("s'exécute sur PostgreSQL 18 ; INSERT dans sejour sans sejour_id → identifiant généré", async () => {
    await withPg(generate().sql, async (pg) => {
      await pg.exec("INSERT INTO service (code_service, libelle) VALUES ('CHIR', 'Chirurgie');");
      await pg.exec(
        `INSERT INTO "Patient" (nir, nom, date_naissance) VALUES ('123456789012345', 'Zoé', '1980-01-01');`,
      );
      const { rows } = await pg.query<{ sejour_id: number }>(
        `INSERT INTO sejour (patient_id, code_service, date_entree) SELECT id, 'CHIR', '2026-10-14 10:00' FROM "Patient" RETURNING sejour_id;`,
      );
      expect(rows[0]!.sejour_id).toBe(1);
    });
  });

  it("re-parse de la sortie : chaque écart avec la source figure au rapport (zéro écart non justifié)", () => {
    const { sql, losses } = generate();
    const differences = diffCatalogs(catalogOf(SOURCE, "oracle"), catalogOf(sql, "postgresql"), true);
    expect(unjustified(differences, losses)).toEqual([]);
  });

  it("témoin négatif : la v1 laisse des écarts non justifiés (perdus en silence)", () => {
    const differences = diffCatalogs(catalogOf(SOURCE, "oracle"), catalogOf(V1, "postgresql"), true);
    const silent = unjustified(differences, announced(V1)).map((d) => `${d.table}.${d.column ?? ""} ${d.category}`);
    expect(silent).toEqual(
      // Noms non quotés : repliés en majuscules par Oracle.
      expect.arrayContaining([
        "SERVICE.BUDGET type", // NUMBER(12,-3) → NUMERIC(12,3)
        "INTERVENIR. state", // ck_intervenir_cout DISABLE régénérée active
        "PERSONNEL. unique", // UNIQUE INDEX (LOWER(email)) disparu
        "SEJOUR.SEJOUR_ID sequence", // séquence + déclencheur disparus
        "PERSONNEL.SALAIRE comment", // COMMENT q'[…]' disparu
        "PERSONNEL.service_id column", // 0,1 / 0,1 : clé déplacée vers personnel
        "SERVICE.CHEF_ID column",
        "PERSONNEL.DATE_EMBAUCHE type", // DATE (date et heure) → DATE
        "SERVICE.CAPACITE range",
      ]),
    );
  });

  it("non-régression : la v1 utilisait BIT VARYING, DOUBLE PRECISION pour NUMBER, et personnel.service_id", () => {
    expect(V1).toMatch(/BIT VARYING/);
    const { sql } = generate();
    expect(sql).not.toMatch(/BIT VARYING|DOUBLE PRECISION.*sejour_id|service_id/);
  });
});

describe("P0 — corruption sémantique", () => {
  it("1. DATE Oracle → TIMESTAMP(0) ; DEFAULT SYSDATE → LOCALTIMESTAMP(0) ; option DATE → DATE signalée", async () => {
    const { sql } = generate();
    expect(table(sql, "Personnel")).toContain("date_embauche TIMESTAMP(0) DEFAULT LOCALTIMESTAMP(0) NOT NULL");
    expect(table(sql, "sejour")).toContain("date_sortie_prevue TIMESTAMP(0) GENERATED ALWAYS AS");
    const dates = generate("postgresql", "18", { oracleDates: "date" });
    expect(table(dates.sql, "Personnel")).toContain("date_embauche DATE DEFAULT CURRENT_DATE NOT NULL");
    expect(dates.losses).toContainEqual(
      expect.objectContaining({
        table: "Personnel",
        column: "date_embauche",
        message: expect.stringContaining("l'heure est perdue"),
      }),
    );
    await withPg(dates.sql, async () => undefined);
  });

  it("2. échelle négative conservée : NUMBER(12,-3) → NUMERIC(12,-3)", async () => {
    const { sql } = generate();
    expect(table(sql, "service")).toContain("budget NUMERIC(12,-3)");
    await withPg(sql, async (pg) => {
      await pg.exec("INSERT INTO service (code_service, libelle, budget) VALUES ('A', 'a', 1234567);");
      expect((await pg.query<{ budget: string }>("SELECT budget FROM service")).rows[0]!.budget).toBe("1235000");
    });
    // Avant PostgreSQL 15 : élargi, signalé.
    const pg14 = generate("postgresql", "14");
    expect(table(pg14.sql, "service")).toContain("budget NUMERIC(15)");
    expect(pg14.losses).toContainEqual(
      expect.objectContaining({ column: "budget", message: expect.stringContaining("échelle négative") }),
    );
  });
});

describe("P0 — corruption sémantique", () => {
  it("3. NUMBER : SMALLINT / INTEGER / BIGINT selon p ; NUMBER alimenté par séquence → BIGINT, même type pour ses FK ; jamais de flottant", () => {
    const { sql, losses } = generate();
    expect(table(sql, "service")).toContain("etage SMALLINT");
    expect(table(sql, "service")).toContain("capacite SMALLINT");
    expect(table(sql, "service")).toContain("chef_id BIGINT");
    expect(table(sql, "Personnel")).toContain("matricule BIGINT GENERATED BY DEFAULT AS IDENTITY (START WITH 1000)");
    expect(table(sql, "sejour")).toContain("sejour_id BIGINT DEFAULT nextval('seq_sejour')");
    expect(table(sql, "intervenir")).toContain("sejour_id BIGINT");
    expect(table(sql, "intervenir")).toContain("cout NUMERIC(8,2)");
    expect(sql.match(/^.*DOUBLE PRECISION.*$/gm)).toEqual(["   salaire DOUBLE PRECISION,"]); // BINARY_DOUBLE seulement
    expect(losses).toContainEqual(
      expect.objectContaining({
        table: "sejour",
        column: "sejour_id",
        message: expect.stringContaining("NUMBER → BIGINT"),
      }),
    );
    // La clé étrangère intervenir.sejour_id a le type de sejour.sejour_id, qui seule porte l'entrée (O-40).
    expect(losses.some((l) => l.table === "intervenir" && l.column === "sejour_id")).toBe(false);
  });

  it("4. RAW(16) DEFAULT SYS_GUID() → UUID (approximation signalée) ; jamais BIT VARYING", () => {
    const { sql, losses } = generate();
    expect(table(sql, "Patient")).toContain("id UUID DEFAULT gen_random_uuid()");
    expect(table(sql, "sejour")).toContain("patient_id UUID NOT NULL");
    expect(losses).toContainEqual(
      expect.objectContaining({ table: "Patient", column: "id", message: expect.stringContaining("approximation") }),
    );
    // RAW(n) ordinaire → BYTEA.
    const { doc } = reverseEngineer("CREATE TABLE t (id NUMBER(5) PRIMARY KEY, h RAW(32));", emptyDocument(), "oracle");
    const raw = generateDdl(toLogicalModel(doc), { dbms: "postgresql", version: "18" });
    expect(raw.ok && raw.sql).toContain("h BYTEA");
  });
});

describe("P0 — corruption sémantique", () => {
  it("5. contrainte DISABLE : en commentaire, jamais active ni NOT VALID ; au rapport", () => {
    const { sql, losses } = generate();
    expect(sql).toContain("-- CONSTRAINT ck_intervenir_cout CHECK (cout >= 0) -- désactivée");
    expect(sql).not.toMatch(/^\s*CONSTRAINT ck_intervenir_cout/m);
    expect(sql).not.toMatch(/ck_intervenir_cout.*NOT VALID/);
    expect(losses).toContainEqual(
      expect.objectContaining({
        table: "intervenir",
        category: "check",
        message: expect.stringContaining("ck_intervenir_cout"),
      }),
    );
  });

  it("6. 0,1 / 0,1 : la clé reste service.chef_id → personnel, DEFERRABLE conservé", () => {
    const { sql } = generate();
    expect(sql).toContain(
      "ALTER TABLE service ADD CONSTRAINT fk_service_chef FOREIGN KEY(chef_id) REFERENCES Personnel(matricule) DEFERRABLE INITIALLY DEFERRED;",
    );
    expect(table(sql, "service")).toContain("CONSTRAINT uq_service_chef UNIQUE(chef_id)");
    expect(table(sql, "Personnel")).not.toMatch(/service_id|chef/);
  });
});

describe("P0 — corruption sémantique", () => {
  it("7. index uniques sur expression et conditionnel, séquence + déclencheur, COMMENT q'[…]' et identifiants quotés", async () => {
    const { sql, losses } = generate();
    expect(sql).toContain("CREATE UNIQUE INDEX ux_personnel_email ON Personnel(LOWER(email));");
    expect(sql).toContain("CREATE UNIQUE INDEX ux_sejour_en_cours ON sejour(patient_id) WHERE date_sortie IS NULL;");
    expect(sql).toMatch(/^CREATE SEQUENCE seq_sejour START WITH 1 INCREMENT BY 1 CACHE 1 NO CYCLE;$/m);
    expect(losses.some((l) => l.category === "trigger")).toBe(false);
    expect(sql).toContain(
      `COMMENT ON COLUMN Personnel.salaire IS 'Brut annuel; ni "primes" ni heures sup'' (cf. RH)';`,
    );
    expect(sql).toContain(`COMMENT ON COLUMN "Patient"."Note libre" IS 'Texte libre -- ne pas /* parser */';`);
    await withPg(sql, async (pg) => {
      await pg.exec("INSERT INTO service (code_service, libelle) VALUES ('CHIR', 'Chirurgie');");
      await pg.exec(
        "INSERT INTO personnel (nom, fonction, code_service, email) VALUES ('A', 'ADMIN', 'CHIR', 'Jo@X.fr');",
      );
      expect(
        await rejects(
          pg,
          "INSERT INTO personnel (nom, fonction, code_service, email) VALUES ('B', 'ADMIN', 'CHIR', 'jo@x.FR');",
        ),
      ).toMatch(/ux_personnel_email/);
      await pg.exec(
        `INSERT INTO "Patient" (nir, nom, date_naissance) VALUES ('123456789012345', 'Zoé', '1980-01-01');`,
      );
      const stay = `INSERT INTO sejour (patient_id, code_service, date_entree, date_sortie) SELECT id, 'CHIR', '2026-01-01', %s FROM "Patient";`;
      await pg.exec(stay.replace("%s", "'2026-01-05'"));
      await pg.exec(stay.replace("%s", "'2026-02-05'"));
      await pg.exec(stay.replace("%s", "NULL"));
      expect(await rejects(pg, stay.replace("%s", "NULL"))).toMatch(/ux_sejour_en_cours/);
    });
    // Déclencheur sans WHEN : il écrasait toute valeur fournie — signalé autrement.
    const always = SOURCE.replace("  WHEN (NEW.sejour_id IS NULL)\n", "");
    const { doc } = reverseEngineer(always, emptyDocument());
    const result = generateDdl(toLogicalModel(doc), { dbms: "postgresql", version: "18" });
    expect(result.ok && result.losses).toContainEqual(
      expect.objectContaining({ column: "sejour_id", message: expect.stringContaining("n'est plus écrasée") }),
    );
  });
});
