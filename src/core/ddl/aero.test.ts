import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, describe, expect, it } from "vitest";
import { toLogicalModel } from "../mld/transform";
import { emptyDocument } from "../model/factory";
import { reverseEngineer } from "../reverse/build";
import { parseSql } from "../reverse/parse";
import { tokenize } from "../sql/tokenize";
import { attribute, doc, entity, generate, issues, report, SOURCE, unjustified } from "../testing/aeroFixture";
import { catalogOf, diffCatalogs } from "../testing/catalog";
import { generateDdl } from "./generate";

/** Itération 10 (override O-41) : script SQL Server réel (fixtures/aero_sqlserver.sql) → MCD → PostgreSQL 18. */

let shared: PGlite | undefined;
afterAll(async () => shared?.close());
async function withPg<T>(sql: string, run: (pg: PGlite) => Promise<T>): Promise<T> {
  shared ??= new PGlite();
  await shared.exec("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  await shared.exec(sql);
  return run(shared);
}

// ---------------------------------------------------------------------------------------------

describe("P0 — tokenizer", () => {
  const nested = "/* a /* b */ CREATE TABLE fantome (id int); */ CREATE TABLE t (x int);";

  it("1. commentaires imbriqués : profondeur pour SQL Server et PostgreSQL", () => {
    for (const dialect of ["sqlserver", "postgresql"] as const) {
      const schema = parseSql(nested, dialect);
      expect(schema.tables.map((t) => t.name)).toEqual(["t"]);
      expect(schema.warnings).toEqual([]);
    }
  });

  it("1. premier */ fermant pour MySQL, Oracle et SQLite ; */ orphelin → avertissement", () => {
    for (const dialect of ["mysql", "oracle", "sqlite"] as const) {
      const schema = parseSql(nested, dialect);
      expect(schema.tables.map((t) => t.name)).toEqual(["fantome", "t"]);
      expect(schema.warnings).toEqual(["ligne 1"]);
    }
    const { report: mysql } = reverseEngineer(nested, emptyDocument(), "mysql");
    expect(mysql.warnings).toEqual([expect.stringContaining("*/")]);
  });

  it("1. fixture : pas de table « fantome », aucun avertissement de lecture", () => {
    expect(report.dialect).toBe("sqlserver");
    expect(doc.entities.map((e) => e.name)).not.toContain("fantome");
    expect(report.warnings).toEqual([]);
  });

  it("2. délimiteurs doublés : ]] dans […], \"\" dans \"…\", '' dans '…'", () => {
    const tokens = tokenize(`[Remise [%]]] "a""b" 'l''avion' \`x\`\`y\``, { dialect: "sqlserver" });
    expect(tokens.map((t) => [t.type, t.value])).toEqual([
      ["quoted", "Remise [%]"],
      ["quoted", 'a"b'],
      ["string", "l'avion"],
      ["quoted", "x`y"],
    ]);
    expect(entity("passager").attributes.map((a) => a.name)).toContain("Remise [%]");
    expect(attribute("passager", "Remise [%]").comment).toBe("Remise en %; plafonnée à 100 -- cf. [CGV] /* art. 4 */");
  });
});

describe("P1 — sémantique", () => {
  it("3. index unique filtré « c IS NOT NULL » = UNIQUE ordinaire : réflexive « retour » en 0,1 / 0,1", () => {
    const retour = doc.associations.find((a) => a.name === "retour")!;
    expect(
      doc.links.filter((l) => l.associationId === retour.id).map((l) => `${l.cardinality.min},${l.cardinality.max}`),
    ).toEqual(["0,1", "0,1"]);
    expect(entity("vol").alternateKeys).toContainEqual(
      expect.objectContaining({ name: "ux_vol_retour", nulls: "distinct" }),
    );
    expect(issues.some((m) => /« vol » : unicité conditionnelle/.test(m))).toBe(false);
    // Vers PostgreSQL : UNIQUE ordinaire (plusieurs NULL admis) ; vers SQL Server : le même index filtré.
    expect(generate().sql).toContain("CONSTRAINT ux_vol_retour UNIQUE(vol_retour)");
    expect(generate("sqlserver", "2022").sql).toContain(
      "CREATE UNIQUE INDEX ux_vol_retour ON dbo.vol(vol_retour) WHERE vol_retour IS NOT NULL;",
    );
  });

  it("3. avertissement d'unicité conditionnelle : la colonne indexée, pas la clé primaire", () => {
    expect(issues).toContainEqual(
      "« reservation » : unicité conditionnelle (id_vol (reservation), siege), seulement si siege IS NOT NULL AND annule = 0 — le MCD ne l'exprime pas",
    );
  });
});

describe("P1 — sémantique", () => {
  it("4. colonnes calculées : dérivées, persistées ou non, type déduit de l'expression", () => {
    expect(attribute("vol", "duree")).toMatchObject({
      type: { kind: "integer", bits: 32 },
      generated: { expression: "DATEDIFF(MINUTE, heure_depart, heure_arrivee)", stored: false },
    });
    // MONEY × 1.10 : décimal prioritaire sur le monétaire → DECIMAL(19+3+1, 4+2).
    expect(attribute("reservation", "prix_ttc")).toMatchObject({
      type: { kind: "decimal", precision: 23, scale: 6 },
      generated: { expression: "prix * 1.10", stored: true },
    });
    // Type non déductible : avertissement non bloquant invitant à le saisir.
    const { doc: other } = reverseEngineer(
      "CREATE TABLE t (id INT PRIMARY KEY, c AS dbo.f(id));",
      emptyDocument(),
      "sqlserver",
    );
    const model = toLogicalModel(other);
    expect(model.issues).toContainEqual(
      expect.objectContaining({
        severity: "warning",
        message: expect.stringContaining("« c » de « t » n'a pas de type : il n'a pas pu être déduit"),
      }),
    );
    expect(generateDdl(model, { dbms: "postgresql", version: "18" }).ok).toBe(true);
  });

  it("5. avertissements : NOCHECK, un seul NULL admis, type spatial, ROWVERSION", () => {
    expect(issues).toEqual(
      expect.arrayContaining([
        // Vocabulaire du dialecte source (O-42).
        "« passager » : contrainte ck_passager_remise désactivée (NOCHECK CONSTRAINT) dans la source — elle n'y était pas appliquée",
        "« vol » : contrainte ck_vol_horaires non validée (WITH NOCHECK) — des lignes existantes peuvent ne pas la respecter",
        expect.stringMatching(/« aeroport » : identifiant alternatif sur code_oaci, facultatif — un seul NULL admis/),
        expect.stringMatching(/« passager » : identifiant alternatif sur email, facultatif — un seul NULL admis/),
        expect.stringMatching(/« aeroport\.position » \(GEOGRAPHY\) : type spatial.*PostGIS/),
        expect.stringMatching(/« avion\.version » \(ROWVERSION\) : .*sans équivalent/),
      ]),
    );
  });
});

/** Script de repli (sans PostGIS) exécuté : unicité, CHECK, IDENTITY, DEFAULT et TINYINT respectés. */
async function exerciseFallbackScript(pg: PGlite) {
  // Un seul NULL admis (SQL Server), conservé : un second aéroport sans code OACI est refusé.
  await pg.exec(
    "INSERT INTO ref.aeroport (code_iata, code_oaci, nom, ville, pays) VALUES ('CDG', 'LFPG', 'Roissy', 'Paris', 'FR'), ('ORY', NULL, 'Orly', 'Paris', 'FR');",
  );
  await expect(
    pg.exec("INSERT INTO ref.aeroport (code_iata, nom, ville, pays) VALUES ('BVA', 'Beauvais', 'Tillé', 'FR');"),
  ).rejects.toThrow(/uq_aeroport_oaci/);
  // CHECK traduit : code IATA de 3 lettres (LEN, LIKE '%[^A-Z]%').
  await expect(
    pg.exec(
      "INSERT INTO ref.aeroport (code_iata, code_oaci, nom, ville, pays) VALUES ('C1G', 'LFXX', 'X', 'X', 'FR');",
    ),
  ).rejects.toThrow(/ck_aeroport_iata/);
  await pg.exec("INSERT INTO passager (nom) VALUES ('A');");
  const { rows } = await pg.query<{ num_client: number }>("SELECT num_client FROM passager;");
  expect(rows[0]!.num_client).toBe(10_000);
  // IDENTITY(100, 10) → GENERATED ALWAYS : valeur fournie refusée.
  await pg.exec(
    "INSERT INTO vol (numero, depart, arrivee, heure_depart, heure_arrivee) VALUES ('AF1', 'CDG', 'ORY', now(), now() + interval '1 hour'), ('AF2', 'ORY', 'CDG', now(), now() + interval '2 hours');",
  );
  expect((await pg.query<{ id_vol: number }>("SELECT id_vol FROM vol ORDER BY 1;")).rows.map((r) => r.id_vol)).toEqual([
    100, 110,
  ]);
  await expect(
    pg.exec(
      "INSERT INTO vol (id_vol, numero, depart, arrivee, heure_depart, heure_arrivee) VALUES (5, 'AF3', 'CDG', 'ORY', now(), now());",
    ),
  ).rejects.toThrow(/non-DEFAULT value|GENERATED ALWAYS/i);
  // INSERT dans reservation sans reserve_le : la valeur par défaut (heure UTC) est appliquée.
  await pg.exec("INSERT INTO reservation (id_vol, id_passager, prix) SELECT 100, id_passager, 200 FROM passager;");
  const { rows: resa } = await pg.query<{ prix_ttc: string; reserve_le: Date | null }>(
    "SELECT prix_ttc::text, reserve_le FROM reservation;",
  );
  expect(resa[0]!.prix_ttc).toBe("220.000000");
  expect(resa[0]!.reserve_le).not.toBeNull();
  // TINYINT : 0 à 255, même si le CHECK (<= 100) d'origine est désactivé.
  await expect(pg.exec('UPDATE passager SET "Remise [%]" = 300;')).rejects.toThrow(/check constraint/);
  await pg.exec('UPDATE passager SET "Remise [%]" = 150;'); // ck_passager_remise désactivée (NOCHECK CONSTRAINT)
  // ISJSON → IS JSON.
  await expect(pg.exec("UPDATE passager SET preferences = '{oups';")).rejects.toThrow(/ck_passager_json/);
}

describe("critères d'acceptation", () => {
  it("sans PostGIS (option de repli) : le script s'exécute ; DEFAULT de reserve_le appliqué ; un seul NULL conservé", async () => {
    const { sql, losses } = generate("postgresql", "18", { spatial: "wkb" });
    expect(sql).not.toContain("postgis");
    expect(losses).toContainEqual(
      expect.objectContaining({
        table: "aeroport",
        column: "position",
        message: expect.stringContaining("GEOGRAPHY → BYTEA (WKB)"),
      }),
    );
    await withPg(sql, exerciseFallbackScript);
    // Repli WKT.
    const wkt = generate("postgresql", "18", { spatial: "wkt" });
    expect(wkt.sql).toContain("position TEXT");
  });

  it("toute différence entre la source et la sortie figure au rapport", () => {
    const { sql, losses } = generate();
    const differences = diffCatalogs(catalogOf(SOURCE, "sqlserver"), catalogOf(sql, "postgresql"), true);
    expect(unjustified(differences, losses)).toEqual([]);
  });

  it("non-régression : commentaires des fixtures MySQL (non imbriqués) et Oracle", () => {
    for (const [file, dialect, tables] of [
      ["fixtures/mediatheque_mysql.sql", "mysql", 5],
      ["fixtures/hopital_oracle.sql", "oracle", 5],
    ] as const) {
      const schema = parseSql(readFileSync(file, "utf8"), dialect);
      expect(schema.tables).toHaveLength(tables);
      expect(schema.warnings).toEqual([]);
    }
  });
});
