import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { toLogicalModel } from "../mld/transform";
import { emptyDocument } from "../model/factory";
import { reverseEngineer } from "../reverse/build";
import { catalogOf, diffCatalogs } from "../testing/catalog";
import { generate, rejects, SOURCE, table, unjustified } from "../testing/hopitalFixture";
import { byCodeUnit } from "../testing/order";
import { sharedPg } from "../testing/pglite";
import { generateDdl } from "./generate";

/**
 * Itération 8 (override O-39), suite : traductions, finitions de l'itération 9 (O-40) et autres SGBD cibles.
 */

const withPg = sharedPg();

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
});

describe("P1 — traductions", () => {
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
});

describe("P1 — traductions", () => {
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
});

describe("itération 9 — finitions (O-40)", () => {
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
