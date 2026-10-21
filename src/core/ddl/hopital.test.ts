import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, describe, expect, it } from "vitest";
import type { Dbms } from "../dbms/dbms";
import { toLogicalModel } from "../mld/transform";
import { emptyDocument } from "../model/factory";
import type { DdlOptions } from "../model/settings";
import { reverseEngineer } from "../reverse/build";
import { catalogOf, type Difference, diffCatalogs } from "../testing/catalog";
import { byCodeUnit } from "../testing/order";
import { generateDdl, type Loss } from "./generate";

/**
 * Itération 8 (override O-39) : script Oracle réel (fixtures/hopital_oracle.sql) → PostgreSQL 18.
 * fixtures/hopital_pg_v1.sql : sortie d'avant ces travaux (témoin négatif).
 */

const SOURCE = readFileSync("fixtures/hopital_oracle.sql", "utf8");
const V1 = readFileSync("fixtures/hopital_pg_v1.sql", "utf8");

function generate(dbms: Dbms = "postgresql", version: string | undefined = "18", options: Partial<DdlOptions> = {}) {
  const { doc } = reverseEngineer(SOURCE, emptyDocument());
  const result = generateDdl(toLogicalModel(doc), { dbms, version }, options);
  if (!result.ok) {
    throw new Error(result.error);
  }
  return result;
}

const body = (sql: string) => sql.replace(/^(--.*\n)+\n/, "");
const table = (sql: string, name: string) =>
  body(sql)
    .split(/;\s*\n/)
    .find((s) => new RegExp(`^CREATE TABLE "?${name}"?\\(`, "i").test(s.trim()))!;

/** Entrées du rapport annoncées en tête du script (pour un script dont on n'a que le texte). */
const announced = (sql: string): Loss[] =>
  (sql.match(/^-- {3}• .*$/gm) ?? []).map((line) => {
    const [where, ...rest] = line.replace(/^-- {3}• /, "").split(" — ");
    const [t, column] = where!.split(".");
    return { category: "type", table: t!, column, message: rest.join(" — ") };
  });

/** Écarts source → sortie que le rapport ne justifie pas (même table, catégorie compatible, même colonne). */
function unjustified(differences: Difference[], losses: Loss[]): Difference[] {
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

// Une seule instance PGlite (démarrage coûteux), schéma remis à zéro à chaque essai.
let shared: PGlite | undefined;
afterAll(async () => shared?.close());

async function withPg<T>(sql: string, run: (pg: PGlite) => Promise<T>): Promise<T> {
  shared ??= new PGlite();
  await shared.exec("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  await shared.exec(sql);
  return run(shared);
}

const rejects = async (pg: PGlite, sql: string) => {
  try {
    await pg.exec(sql);
    return null;
  } catch (e) {
    return (e as Error).message;
  }
};

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

describe("P1 — traductions", () => {
  it("8. INTERVAL DAY(p) TO SECOND(s) → INTERVAL DAY TO SECOND(s), précision des jours signalée", () => {
    const { sql, losses } = generate();
    expect(table(sql, "sejour")).toContain("duree_prevue INTERVAL DAY TO SECOND(0)");
    expect(losses).toContainEqual(
      expect.objectContaining({ column: "duree_prevue", message: expect.stringContaining("précision des jours") }),
    );
  });

  it("9. DEFAULT : SYSTIMESTAMP → CURRENT_TIMESTAMP, USER → CURRENT_USER, SYS_GUID() → gen_random_uuid() (rapport)", () => {
    const { sql, losses } = generate();
    expect(table(sql, "Patient")).toContain("cree_le TIMESTAMPTZ(3) DEFAULT CURRENT_TIMESTAMP NOT NULL");
    expect(table(sql, "Patient")).toContain("cree_par VARCHAR(128) DEFAULT CURRENT_USER NOT NULL");
    expect(losses).toContainEqual(
      expect.objectContaining({
        category: "default",
        column: "id",
        message: expect.stringContaining("gen_random_uuid()"),
      }),
    );
  });

  it("10. colonne virtuelle date_entree + duree_prevue → GENERATED ALWAYS AS (…) VIRTUAL", async () => {
    const { sql } = generate();
    expect(table(sql, "sejour")).toMatch(
      /date_sortie_prevue TIMESTAMP\(0\) GENERATED ALWAYS AS \(\(?date_entree \+ duree_prevue\)?\) VIRTUAL/,
    );
    await withPg(sql, async (pg) => {
      await pg.exec("INSERT INTO service (code_service, libelle) VALUES ('C', 'c');");
      await pg.exec(`INSERT INTO "Patient" (nir, nom, date_naissance) VALUES ('1', 'Z', '1980-01-01');`);
      const { rows } = await pg.query<{ fin: string }>(
        `INSERT INTO sejour (patient_id, code_service, date_entree, duree_prevue) SELECT id, 'C', '2026-10-14 10:00', INTERVAL '3 days 2 hours' FROM "Patient" RETURNING date_sortie_prevue::text AS fin;`,
      );
      expect(rows[0]!.fin).toBe("2026-10-17 12:00:00");
    });
  });

  it("11. états : NOVALIDATE → ADD … NOT VALID ; DEFERRABLE conservé sur FK ; CHECK différable → immédiat + rapport", async () => {
    const { sql, losses } = generate();
    expect(sql).toContain(
      "ALTER TABLE intervenir ADD CONSTRAINT ck_intervenir_super CHECK (superviseur IS NULL OR superviseur <> matricule) NOT VALID;",
    );
    expect(table(sql, "sejour")).toContain(
      "CONSTRAINT ck_sejour_dates CHECK (date_sortie IS NULL OR date_sortie >= date_entree),",
    );
    expect(losses).toContainEqual(
      expect.objectContaining({
        table: "sejour",
        category: "check",
        message: expect.stringContaining("ck_sejour_dates différable"),
      }),
    );
    await withPg(sql, async (pg) => {
      // Différée : le chef peut être posé avant que le personnel existe, dans la transaction.
      await pg.exec(
        "BEGIN; INSERT INTO service (code_service, libelle, chef_id) VALUES ('A', 'a', 1000); INSERT INTO personnel (nom, fonction, code_service) VALUES ('N', 'ADMIN', 'A'); COMMIT;",
      );
    });
  });

  it("12. UNIQUE composite avec colonne facultative → NULLS NOT DISTINCT ; rien sinon", async () => {
    const { sql } = generate();
    expect(table(sql, "service")).toContain(
      "CONSTRAINT uq_service_libelle UNIQUE NULLS NOT DISTINCT(service_parent, libelle)",
    );
    expect(table(sql, "Patient")).toContain("CONSTRAINT uq_patient_nir UNIQUE(nir)");
    await withPg(sql, async (pg) => {
      await pg.exec("INSERT INTO service (code_service, libelle) VALUES ('A', 'Accueil');");
      expect(await rejects(pg, "INSERT INTO service (code_service, libelle) VALUES ('B', 'Accueil');")).toMatch(
        /uq_service_libelle/,
      );
    });
  });

  it("13. précision des TIMESTAMP conservée", () => {
    const { sql } = generate();
    expect(table(sql, "intervenir")).toContain("debut TIMESTAMP(0)");
    expect(table(sql, "Patient")).toContain("cree_le TIMESTAMPTZ(3)");
  });

  it("14. rapport : ON NULL, partitionnement, stockage (une ligne), BYTE / NLS, chaîne vide ; pas de faux positif couvert par un CHECK", () => {
    const { sql, losses } = generate();
    const message = (text: string) => expect.objectContaining({ message: expect.stringContaining(text) });
    expect(losses).toContainEqual(
      expect.objectContaining({ table: "Personnel", column: "matricule", message: expect.stringContaining("ON NULL") }),
    );
    expect(losses).toContainEqual(message("clé de partition"));
    expect(sql.match(/^-- {3}• clauses de stockage.*$/gm)).toEqual([
      "--   • clauses de stockage (USING INDEX, TABLESPACE, PCTFREE, STORAGE, LOGGING, LOB) abandonnées : sans effet sur les données : service, Personnel",
    ]);
    expect(losses).toContainEqual(
      expect.objectContaining({ column: "nom", table: "Personnel", message: expect.stringContaining("BYTE") }),
    );
    expect(losses).toContainEqual(
      expect.objectContaining({ column: "email", message: expect.stringContaining("NLS_LENGTH_SEMANTICS") }),
    );
    expect(losses.some((l) => l.column === "prenom" && /NLS|BYTE/.test(l.message))).toBe(false); // VARCHAR2(80 CHAR)
    // Chaîne vide : CHECK (col <> '') sur les textes NOT NULL ; '' ≠ NULL signalé sur les facultatifs.
    expect(table(sql, "Personnel")).toContain("nom VARCHAR(80) NOT NULL CHECK (nom <> '')");
    expect(table(sql, "Personnel")).toMatch(
      /fonction VARCHAR\(20\) NOT NULL CONSTRAINT ck_personnel_fonction CHECK \(fonction IN \('MEDECIN', 'INFIRMIER', 'ADMIN'\)\),/,
    );
    expect(losses).toContainEqual(
      expect.objectContaining({ column: "prenom", message: expect.stringContaining("'' vaut NULL") }),
    );
    const none = generate("postgresql", "18", { emptyStrings: "none" });
    expect(none.sql).not.toContain("<> ''");
    expect(none.losses).toContainEqual(
      expect.objectContaining({
        column: "nom",
        table: "Personnel",
        message: expect.stringContaining("'' est acceptée"),
      }),
    );
    // Faux positifs supprimés : NUMBER(2) / NUMBER(1) couverts par un CHECK ; NUMBER(4) sans CHECK signalé.
    expect(losses.some((l) => l.column === "etage" || l.column === "est_cadre")).toBe(false);
    expect(losses).toContainEqual(
      expect.objectContaining({ column: "capacite", message: expect.stringContaining("plage de valeurs élargie") }),
    );
  });
});

describe("itération 9 — finitions (O-40)", () => {
  it("1. aucune perte de plage ou de longueur sur une clé étrangère : seule la clé référencée porte l'entrée", () => {
    const { losses } = generate();
    const widened = losses
      .filter((l) => /plage de valeurs élargie|NUMBER → BIGINT|BYTE|NLS_LENGTH/.test(l.message))
      .map((l) => `${l.table}.${l.column}`);
    expect(widened.sort(byCodeUnit)).toEqual(
      [
        "Patient.nir",
        "Patient.nom",
        "Patient.cree_par",
        "Personnel.email",
        "Personnel.matricule",
        "Personnel.nom",
        "sejour.motif",
        "sejour.sejour_id",
        "service.capacite",
      ].sort(),
    );
    // Généralisé : UNSIGNED MySQL en mode CHECK, sur les clés étrangères de la médiathèque.
    const mysql = readFileSync("fixtures/mediatheque_mysql.sql", "utf8");
    const result = generateDdl(
      toLogicalModel(reverseEngineer(mysql, emptyDocument()).doc),
      { dbms: "postgresql", version: "18" },
      { unsigned: "check" },
    );
    expect(result.ok && result.losses.filter((l) => l.category === "unsigned").map((l) => l.column)).not.toContain(
      "adherent_id",
    );
  });

  it("2. pas de NLS / BYTE sur une colonne bornée par un CHECK IN de valeurs ASCII", () => {
    const { losses } = generate();
    const nls = losses.filter((l) => /NLS_LENGTH|BYTE/.test(l.message)).map((l) => l.column);
    // actif IN ('O', 'N'), fonction IN ('MEDECIN', …), type IN ('consult', …), sexe IN ('M', 'F', 'X').
    for (const column of ["actif", "fonction", "type", "sexe"]) {
      expect(nls).not.toContain(column);
    }
    expect(nls).toEqual(expect.arrayContaining(["email", "nir", "motif"]));
  });

  it("3. chaîne vide : « stockée » ou « rejetée par le CHECK existant »", () => {
    const { losses } = generate();
    const message = (column: string) => losses.find((l) => l.column === column && /''/.test(l.message))?.message;
    expect(message("prenom")).toMatch(/stockée telle quelle/);
    expect(message("sexe")).toMatch(/rejetée par le CHECK existant/);
  });

  it("4. option « fidélité stricte » : CHECK de plage sur les NUMBER(p) élargis hors clés étrangères (désactivée par défaut)", async () => {
    expect(generate().sql).not.toMatch(/BETWEEN -9999/);
    const strict = generate("postgresql", "18", { strictRanges: true });
    expect(table(strict.sql, "service")).toContain(
      "capacite SMALLINT DEFAULT 0 NOT NULL CHECK (capacite BETWEEN -9999 AND 9999)",
    );
    expect(table(strict.sql, "Personnel")).toContain("CHECK (matricule BETWEEN -9999999999 AND 9999999999)");
    expect(table(strict.sql, "service")).toMatch(/chef_id BIGINT,/); // clé étrangère : rien
    expect(strict.losses.some((l) => /plage de valeurs élargie/.test(l.message))).toBe(false);
    const differences = diffCatalogs(catalogOf(SOURCE, "oracle"), catalogOf(strict.sql, "postgresql"), true);
    expect(unjustified(differences, strict.losses)).toEqual([]);
    await withPg(strict.sql, async (pg) => {
      expect(
        await rejects(pg, "INSERT INTO service (code_service, libelle, capacite) VALUES ('A', 'a', 10000);"),
      ).toMatch(/check constraint/);
    });
  });

  it("5. séquence traduite : ALTER SEQUENCE … OWNED BY table.colonne", async () => {
    const { sql } = generate();
    expect(sql).toContain("ALTER SEQUENCE seq_sejour OWNED BY sejour.sejour_id;");
    await withPg(sql, async (pg) => {
      const { rows } = await pg.query<{ owner: string }>(
        "SELECT d.refobjid::regclass::text || '.' || a.attname AS owner FROM pg_depend d JOIN pg_attribute a ON a.attrelid = d.refobjid AND a.attnum = d.refobjsubid WHERE d.objid = 'seq_sejour'::regclass AND d.deptype = 'a';",
      );
      expect(rows[0]!.owner).toBe("sejour.sejour_id");
    });
    // Relu : toujours une valeur de séquence, pas un compteur.
    expect(
      catalogOf(sql, "postgresql")
        .find((t) => t.name === "sejour")!
        .columns.find((c) => c.name === "sejour_id"),
    ).toMatchObject({ sequence: "seq_sejour", autoIncrement: false });
  });
});

describe("autres cibles : toute différence est au rapport", () => {
  for (const [dbms, version] of [
    ["postgresql", "14"],
    ["mysql", "8.4"],
    ["sqlserver", "2022"],
    ["sqlite", undefined],
  ] as const) {
    it(`${dbms} ${version ?? ""}`, () => {
      const { sql, losses } = generate(dbms, version);
      const differences = diffCatalogs(catalogOf(SOURCE, "oracle"), catalogOf(sql, dbms), true, dbms);
      expect(unjustified(differences, losses)).toEqual([]);
    });
  }
});
