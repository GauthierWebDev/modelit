import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import type { Dbms } from "../dbms/dbms";
import { toLogicalModel } from "../mld/transform";
import { emptyDocument } from "../model/factory";
import type { DdlOptions } from "../model/settings";
import { reverseEngineer } from "../reverse/build";
import { catalogOf, type Difference, diffCatalogs } from "../testing/catalog";
import { generateDdl, type Loss } from "./generate";

/**
 * Itération 3 (override O-35) : script MySQL réel (fixtures/mediatheque_mysql.sql) → PostgreSQL 18.
 * fixtures/mediatheque_pg_v1.sql : sortie d'avant ces travaux (témoin négatif).
 */

const SOURCE = readFileSync("fixtures/mediatheque_mysql.sql", "utf8");
const V1 = readFileSync("fixtures/mediatheque_pg_v1.sql", "utf8");

function generate(dbms: Dbms = "postgresql", version: string | undefined = "18", options: Partial<DdlOptions> = {}) {
  const { doc } = reverseEngineer(SOURCE, emptyDocument());
  const result = generateDdl(toLogicalModel(doc), { dbms, version }, options);
  if (!result.ok) throw new Error(result.error);
  return result;
}

const body = (sql: string) => sql.replace(/^(--.*\n)+\n/, "");
const table = (sql: string, name: string) =>
  body(sql)
    .split(/;\s*\n/)
    .find((s) => new RegExp(`^CREATE TABLE ["\`\\[]?${name}["\`\\]]?\\(`).test(s.trim()))!;

/** Entrées du rapport annoncées en tête du script (pour un script dont on n'a que le texte). */
const announced = (sql: string): Loss[] =>
  (sql.match(/^-- {3}• .*$/gm) ?? []).map((line) => {
    const [where, ...rest] = line.replace(/^-- {3}• /, "").split(" — ");
    const [tableName, column] = where!.split(".");
    return { category: "type", table: tableName!, column, message: rest.join(" — ") };
  });

/** Écarts source → sortie que le rapport ne justifie pas (même table, catégorie compatible, même colonne). */
function unjustified(differences: Difference[], losses: Loss[], strictCategories = true): Difference[] {
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
    // O-39
    emptyString: ["domain"],
    state: ["check", "index", "action"],
    physical: ["physical"],
    sequence: ["default", "autoIncrement"],
  };
  const same = (a?: string, b?: string) => a === undefined || b === undefined || a.toLowerCase() === b.toLowerCase();
  return differences.filter(
    (d) =>
      !losses.some(
        (l) =>
          (!strictCategories || categories[d.category]?.includes(l.category)) &&
          [{ table: d.table, column: d.column }, ...(d.references ?? [])].some(
            (r) => l.table.toLowerCase() === r.table.toLowerCase() && same(r.column, l.column),
          ),
      ),
  );
}

async function execute(sql: string): Promise<string | null> {
  const pg = new PGlite();
  try {
    await pg.exec(sql);
    return null;
  } catch (e) {
    return (e as Error).message;
  } finally {
    await pg.close();
  }
}

// ---------------------------------------------------------------------------------------------

describe("critères d'acceptation", () => {
  it("la sortie s'exécute sur PostgreSQL 18 (PGlite 18) ; la v1 échouait", async () => {
    expect(await execute(generate().sql)).toBeNull();
    expect(await execute(V1)).toMatch(/boolean but default expression is of type integer/);
  });

  it("re-parse de la sortie : chaque écart avec la source figure au rapport (zéro écart non justifié)", () => {
    const { sql, losses } = generate();
    const differences = diffCatalogs(catalogOf(SOURCE, "mysql"), catalogOf(sql, "postgresql"), true);
    expect(unjustified(differences, losses)).toEqual([]);
  });

  it("témoin négatif : la v1 laisse des écarts non justifiés (perdus en silence)", () => {
    const differences = diffCatalogs(catalogOf(SOURCE, "mysql"), catalogOf(V1, "postgresql"), true);
    // La v1 n'annonçait que des pertes de type.
    const silent = unjustified(differences, announced(V1)).map((d) => `${d.table}.${d.column ?? ""} ${d.category}`);
    expect(silent).toEqual(
      expect.arrayContaining([
        "oeuvre. foreignKey", // isbn_originale → oeuvre(isbn) remplacée par oeuvre_id → id_oeuvre
        "adherent. unique", // UNIQUE (email(100)) élargi à la colonne entière
        "Exemplaire. unique", // UNIQUE USING HASH disparu
        "emprunt. trigger",
        "adherent.maj_le onUpdate",
        "oeuvre.prix_ttc generated",
        "oeuvre.prix_ht comment",
        "adherent.id autoIncrement", // AUTO_INCREMENT = 1000
      ]),
    );
  });

  it("le rapport décrit ce qui est émis : ni fausse collation, ni « pas d'équivalent » pour ENUM", () => {
    const { sql, losses } = generate();
    expect(sql).not.toMatch(/ascii_bin|utf8mb4_bin/);
    expect(losses.some((l) => /ENUM.*pas d'équivalent|pas d'équivalent.*ENUM/.test(l.message))).toBe(false);
    expect(losses.some((l) => /COLLATE/.test(l.message))).toBe(false);
    // Chaque entrée nomme une table de la sortie, et la colonne citée existe.
    for (const l of losses) {
      const create = table(sql, l.table);
      expect(create, l.message).toBeDefined();
      if (l.column && !/,/.test(l.column)) expect(create).toMatch(new RegExp(`\\b${l.column}\\b`));
    }
  });
});

// ---------------------------------------------------------------------------------------------

describe("P0 — le script s'exécute", () => {
  it('1. collations : *_bin → COLLATE "C" ; jamais un nom inconnu de la cible', () => {
    const { sql } = generate();
    expect(table(sql, "oeuvre")).toContain('isbn CHAR(13) COLLATE "C" NOT NULL');
    expect(table(sql, "emprunt")).toContain('remarque VARCHAR(500) COLLATE "C"');
  });

  it("1. collation propre à une langue : collation générique, approximation signalée (O-37)", () => {
    const sql = SOURCE.replace(
      "CHARACTER SET ascii COLLATE ascii_bin NOT NULL",
      "COLLATE utf8mb4_tr_0900_ai_ci NOT NULL",
    );
    const result = generateDdl(toLogicalModel(reverseEngineer(sql, emptyDocument()).doc), {
      dbms: "postgresql",
      version: "18",
    });
    if (!result.ok) throw new Error(result.error);
    expect(table(result.sql, "oeuvre")).toContain("isbn CHAR(13) COLLATE merise_ai_ci NOT NULL");
    expect(result.losses).toContainEqual(
      expect.objectContaining({
        category: "collation",
        table: "oeuvre",
        column: "isbn",
        message: expect.stringContaining("langue"),
      }),
    );
  });

  it("1. collation sans équivalent (PostgreSQL → MySQL) : rien d'émis, entrée au rapport", () => {
    const pg = 'CREATE TABLE t (id INTEGER PRIMARY KEY, nom VARCHAR(20) COLLATE "de-DE-x-icu");';
    const result = generateDdl(toLogicalModel(reverseEngineer(pg, emptyDocument()).doc), {
      dbms: "mysql",
      version: "8.4",
    });
    if (!result.ok) throw new Error(result.error);
    expect(result.sql).not.toMatch(/COLLATE/);
    expect(result.losses).toContainEqual(expect.objectContaining({ category: "collation", column: "nom" }));
  });

  it("1. collations _ci / _ai de la base et des tables → collation ICU non déterministe (O-37)", () => {
    const { sql, losses } = generate();
    expect(sql).toContain(
      "CREATE COLLATION IF NOT EXISTS merise_ai_ci (provider = icu, locale = 'und-u-ks-level1', deterministic = false);",
    );
    // Base : utf8mb4_unicode_ci (insensible à la casse et aux accents) ; colonnes *_bin : "C".
    expect(table(sql, "adherent")).toContain("email VARCHAR(255) COLLATE merise_ai_ci NOT NULL");
    expect(table(sql, "adherent_premium")).not.toContain("COLLATE"); // aucune colonne de texte
    expect(table(sql, "oeuvre")).toContain('isbn CHAR(13) COLLATE "C" NOT NULL');
    expect(losses.filter((l) => l.category === "collation")).toEqual([]);
    // Avant PostgreSQL 18 : LIKE impossible sur ces colonnes, signalé.
    expect(generate("postgresql", "16").losses).toContainEqual(
      expect.objectContaining({ category: "collation", message: expect.stringContaining("LIKE") }),
    );
  });

  it("2. DEFAULT traduit avec le type : TINYINT(1) DEFAULT 0 → BOOLEAN DEFAULT FALSE", () => {
    expect(table(generate().sql, "adherent")).toContain("est_mineur BOOLEAN DEFAULT FALSE NOT NULL");
  });

  it("3. YEAR → SMALLINT + plage 1901–2155, fusionnée avec ck_annee ; le CHECK reste valide (O-38)", async () => {
    const { sql } = generate();
    expect(table(sql, "oeuvre")).toContain(
      "annee SMALLINT CONSTRAINT ck_annee CHECK ((annee IS NULL OR annee >= 1901) AND annee BETWEEN 1901 AND 2155)",
    );
    const pg = new PGlite();
    await pg.exec(sql);
    await expect(
      pg.exec("INSERT INTO oeuvre (isbn, titre, type, annee) VALUES ('1', 'T', 'livre', 2156);"),
    ).rejects.toThrow(/ck_annee/);
    await pg.close();
    // Sans CHECK existant : contrainte propre à la colonne.
    const alone = SOURCE.replace("  CONSTRAINT ck_annee CHECK (annee IS NULL OR annee >= 1901)\n", "").replace(
      "ON DELETE SET NULL,\n) ENGINE = InnoDB",
      "ON DELETE SET NULL\n) ENGINE = InnoDB",
    );
    const result = generateDdl(toLogicalModel(reverseEngineer(alone, emptyDocument()).doc), {
      dbms: "postgresql",
      version: "18",
    });
    if (!result.ok) throw new Error(result.error);
    expect(table(result.sql, "oeuvre")).toContain("annee SMALLINT CHECK (annee BETWEEN 1901 AND 2155)");
  });

  it("3. un CHECK devenu incompatible avec le type de sa colonne est signalé (et non émis)", () => {
    const sql = SOURCE.replace("annee            YEAR,", "annee            VARCHAR(4),");
    const result = generateDdl(toLogicalModel(reverseEngineer(sql, emptyDocument()).doc), {
      dbms: "postgresql",
      version: "18",
    });
    if (!result.ok) throw new Error(result.error);
    expect(result.losses).toContainEqual(
      expect.objectContaining({ category: "check", table: "oeuvre", message: expect.stringContaining("incompatible") }),
    );
    expect(table(result.sql, "oeuvre")).not.toContain("annee >= 1901");
  });
});

describe("P1 — pertes sémantiques", () => {
  it("5. FK vers l'identifiant alternatif conservée : isbn_originale → oeuvre(isbn), même type", () => {
    const create = table(generate().sql, "oeuvre");
    expect(create).toContain('isbn_originale CHAR(13) COLLATE "C"');
    expect(create).toContain(
      "CONSTRAINT fk_oeuvre_vo FOREIGN KEY(isbn_originale) REFERENCES oeuvre(isbn) ON DELETE SET NULL",
    );
    expect(create).not.toContain("oeuvre_id");
  });

  it("6. UNIQUE sur préfixe → index unique sur expression, jamais élargi", () => {
    const { sql } = generate();
    expect(sql).toContain("CREATE UNIQUE INDEX uq_email_prefixe ON adherent(left(email, 100));");
    expect(table(sql, "adherent")).not.toMatch(/UNIQUE\(email\)|email VARCHAR\(255\) NOT NULL UNIQUE/);
  });

  it("6. sans équivalent (SQL Server) : signalé, pas d'UNIQUE sur la colonne entière", () => {
    const { sql, losses } = generate("sqlserver", "2022");
    expect(sql).not.toMatch(/UNIQUE\(email\)|email \S+ NOT NULL UNIQUE/);
    expect(losses).toContainEqual(
      expect.objectContaining({ category: "index", table: "adherent", message: expect.stringContaining("préfixe") }),
    );
  });

  it("7. UNIQUE … USING HASH : le UNIQUE est gardé, seule la méthode est abandonnée (signalé)", () => {
    const { sql, losses } = generate();
    expect(table(sql, "Exemplaire")).toContain("CONSTRAINT uq_code_barre UNIQUE(code_barre)");
    expect(losses).toContainEqual(
      expect.objectContaining({ category: "index", table: "Exemplaire", message: expect.stringContaining("HASH") }),
    );
  });

  it("8. UNSIGNED élargi (par défaut) + CHECK (>= 0) hors clés étrangères ; mêmes types des deux côtés des FK (O-37)", () => {
    const { sql, losses } = generate();
    expect(table(sql, "adherent")).toContain(
      "id BIGINT GENERATED BY DEFAULT AS IDENTITY (START WITH 1000) CHECK (id >= 0)",
    );
    expect(table(sql, "oeuvre")).toContain("id_oeuvre BIGINT GENERATED BY DEFAULT AS IDENTITY CHECK (id_oeuvre >= 0)");
    expect(table(sql, "Exemplaire")).toMatch(/id_oeuvre BIGINT,\s+num_ex INTEGER CHECK \(num_ex >= 0\)/);
    // Clés étrangères : bornées par la colonne référencée, sans CHECK.
    expect(table(sql, "adherent")).toMatch(/parrain_id BIGINT,/);
    expect(table(sql, "emprunt")).toMatch(/adherent_id BIGINT,\s+id_oeuvre BIGINT,\s+num_ex INTEGER,/);
    expect(table(sql, "oeuvre")).toContain("prix_ht NUMERIC(8,2) CHECK (prix_ht >= 0)");
    // niveau BETWEEN 1 AND 3 exclut déjà les négatifs : ni CHECK ajouté, ni perte (faux positif corrigé).
    expect(table(sql, "adherent_premium")).toContain(
      "niveau SMALLINT DEFAULT 1 NOT NULL CONSTRAINT ck_niveau CHECK (niveau BETWEEN 1 AND 3),",
    );
    expect(losses.filter((l) => l.category === "unsigned")).toEqual([]);
  });

  it("8. option « CHECK » : types conservés + CHECK (col >= 0), y compris sur les colonnes de FK", async () => {
    const { sql } = generate("postgresql", "18", { unsigned: "check" });
    expect(table(sql, "adherent")).toMatch(
      /id INTEGER GENERATED BY DEFAULT AS IDENTITY \(START WITH 1000\) CHECK \(id >= 0\)/,
    );
    expect(table(sql, "adherent")).toContain("parrain_id INTEGER CHECK (parrain_id >= 0)");
    expect(table(sql, "emprunt")).toContain("num_ex SMALLINT CHECK (num_ex >= 0)");
    expect(await execute(sql)).toBeNull();
  });

  it("9. nom de contrainte ≠ nom d'index : CONSTRAINT fk_ex_oeuvre FOREIGN KEY ix_ex_oeuvre (…)", () => {
    const create = table(generate().sql, "Exemplaire");
    expect(create).toContain("CONSTRAINT fk_ex_oeuvre FOREIGN KEY(id_oeuvre)");
    expect(create).not.toContain("ix_ex_oeuvre");
  });
});

describe("P2 — équivalents PostgreSQL", () => {
  it("10. ENUM → CHECK (col IN …) (domaine) ; option type énuméré", async () => {
    const { sql, losses } = generate();
    expect(table(sql, "adherent")).toContain(
      "statut VARCHAR(8) COLLATE merise_ai_ci DEFAULT 'actif' NOT NULL CHECK (statut IN ('actif', 'suspendu', 'radié'))",
    );
    // Collation insensible : 'ACTIF' accepté tel quel, MySQL le normalisait en 'actif' (O-38).
    expect(losses).toContainEqual(
      expect.objectContaining({ category: "domain", column: "statut", message: expect.stringContaining("ACTIF") }),
    );
    const typed = generate("postgresql", "18", { enums: "type" });
    expect(typed.sql).toContain("CREATE TYPE adherent_statut AS ENUM ('actif', 'suspendu', 'radié');");
    expect(table(typed.sql, "adherent")).toContain("statut adherent_statut DEFAULT 'actif' NOT NULL");
    expect(await execute(typed.sql)).toBeNull();
    expect(
      unjustified(diffCatalogs(catalogOf(SOURCE, "mysql"), catalogOf(typed.sql, "postgresql"), true), typed.losses),
    ).toEqual([]);
  });

  it("10. SET → TEXT[] + CHECK (<@) ; option texte : signalé", () => {
    expect(table(generate().sql, "adherent")).toContain(
      "centres_interet TEXT[] COLLATE merise_ai_ci CHECK (centres_interet <@ ARRAY['roman', 'bd', 'jeunesse', 'sf', 'essai']::text[])",
    );
    const text = generate("postgresql", "18", { sets: "text" });
    expect(table(text.sql, "adherent")).toMatch(/centres_interet TEXT COLLATE merise_ai_ci,/);
    expect(text.losses).toContainEqual(expect.objectContaining({ category: "domain", column: "centres_interet" }));
  });

  it("11. colonnes générées : STORED, VIRTUAL en 18, expression traduite ; STORED avant 18 (signalé)", () => {
    const { sql } = generate();
    expect(table(sql, "oeuvre")).toContain(
      "prix_ttc NUMERIC(8,2) GENERATED ALWAYS AS (ROUND((prix_ht * 1.055), 2)) STORED",
    );
    expect(table(sql, "emprunt")).toContain(
      "date_retour_prevue DATE GENERATED ALWAYS AS ((date_emprunt::date + 21)) VIRTUAL",
    );
    const pg17 = generate("postgresql", "17");
    expect(table(pg17.sql, "emprunt")).toContain("GENERATED ALWAYS AS ((date_emprunt::date + 21)) STORED");
    expect(pg17.losses).toContainEqual(
      expect.objectContaining({ category: "generated", column: "date_retour_prevue" }),
    );
  });

  it("11. expression non traduisible : colonne ordinaire + rapport", () => {
    const sql = SOURCE.replace("ROUND(prix_ht * 1.055, 2)", "TRUNCATE(prix_ht * 1.055, 2)");
    const result = generateDdl(toLogicalModel(reverseEngineer(sql, emptyDocument()).doc), {
      dbms: "postgresql",
      version: "18",
    });
    if (!result.ok) throw new Error(result.error);
    expect(table(result.sql, "oeuvre")).toMatch(/prix_ttc NUMERIC\(8,2\),/);
    expect(result.losses).toContainEqual(expect.objectContaining({ category: "generated", column: "prix_ttc" }));
  });

  it("12. COMMENT de table et de colonne → COMMENT ON (y compris colonne de FK, chaînes piégées)", () => {
    const { sql } = generate();
    expect(sql).toContain("COMMENT ON TABLE adherent IS 'Adhérents; parrain_id porte un REFERENCES « inline »';");
    expect(sql).toContain(
      "COMMENT ON COLUMN oeuvre.prix_ht IS 'Prix HT -- hors remise; voir /* règle 3 */ l''ancien barème';",
    );
    expect(sql).toContain(`COMMENT ON COLUMN oeuvre.isbn_originale IS 'Traduction de l''œuvre ("VO")';`);
  });

  it("13. AUTO_INCREMENT=1000 → IDENTITY (START WITH 1000)", () => {
    expect(table(generate().sql, "adherent")).toContain("GENERATED BY DEFAULT AS IDENTITY (START WITH 1000)");
  });
});

describe("P2 — rapport exhaustif (14)", () => {
  it("ON UPDATE CURRENT_TIMESTAMP, FULLTEXT, trigger, UNSIGNED, TIMESTAMP MySQL figurent au rapport", () => {
    const { losses } = generate();
    const has = (category: Loss["category"], tableName: string, column?: string) =>
      losses.some(
        (l) => l.category === category && l.table === tableName && (column === undefined || l.column === column),
      );
    expect(has("onUpdate", "adherent", "maj_le")).toBe(true);
    expect(has("index", "oeuvre")).toBe(true); // FULLTEXT → GIN, approximation
    expect(has("trigger", "emprunt")).toBe(true);
    // UNSIGNED : élargi et borné (CHECK >= 0 ou clé étrangère) : plus rien de perdu (O-37).
    expect(has("type", "adherent", "cree_le")).toBe(true); // TIMESTAMP MySQL → TIMESTAMPTZ
  });
});

describe("reliquat du rapport (O-38)", () => {
  it("TINYINT(1) → BOOLEAN et SET → TEXT[] figurent au rapport", () => {
    const { losses } = generate();
    expect(losses).toContainEqual(
      expect.objectContaining({
        category: "type",
        table: "adherent",
        column: "est_mineur",
        message: expect.stringContaining("TINYINT(1)"),
      }),
    );
    expect(losses).toContainEqual(
      expect.objectContaining({
        category: "domain",
        table: "adherent",
        column: "centres_interet",
        message: expect.stringContaining("doublons"),
      }),
    );
  });

  it("option collations « déterministe » (serveur sans ICU) : pas de CREATE COLLATION, perte signalée", async () => {
    const { sql, losses } = generate("postgresql", "18", { collations: "deterministic" });
    expect(sql).not.toContain("CREATE COLLATION");
    expect(sql).not.toContain("merise_ai_ci");
    expect(table(sql, "adherent")).toContain("email VARCHAR(255) NOT NULL");
    expect(table(sql, "oeuvre")).toContain('isbn CHAR(13) COLLATE "C" NOT NULL'); // binaire : inchangé
    expect(losses).toContainEqual(
      expect.objectContaining({ category: "collation", column: "email", message: expect.stringContaining("sans ICU") }),
    );
    // ENUM sous collation déterministe : une autre casse est refusée (MySQL la normalisait).
    expect(losses).toContainEqual(
      expect.objectContaining({ category: "domain", column: "statut", message: expect.stringContaining("refusée") }),
    );
    expect(await execute(sql)).toBeNull();
    expect(unjustified(diffCatalogs(catalogOf(SOURCE, "mysql"), catalogOf(sql, "postgresql"), true), losses)).toEqual(
      [],
    );
  });
});

describe("rapport regroupé (O-37)", () => {
  it("une ligne par perte identique, avec la liste des colonnes ; la liste structurée reste détaillée", () => {
    const { sql, losses } = generate("postgresql", "16");
    const like = losses.filter((l) => l.message.includes("LIKE"));
    expect(like.length).toBeGreaterThan(3);
    const lines = sql.split("\n").filter((l) => l.startsWith("--   • ") && l.includes("LIKE"));
    // Une ligne par collation concernée (message identique), avec toutes ses colonnes.
    expect(lines).toHaveLength(new Set(like.map((l) => l.message)).size);
    expect(lines[0]).toMatch(/: adherent\.num_carte, adherent\.nom, adherent\.email/);
    expect(sql.split("\n").filter((l) => l.startsWith("--   • ")).length).toBeLessThan(losses.length);
  });
});

describe("comportement sur PostgreSQL 18 (PGlite)", () => {
  it("domaines, préfixe unique, colonnes calculées, compteur, défauts", async () => {
    const pg = new PGlite();
    await pg.exec(generate().sql);
    await pg.exec(`INSERT INTO adherent (num_carte, nom, email) VALUES ('C1', 'Ada', '${"a".repeat(100)}x@x');`);
    const row = (
      await pg.query<{ id: number; est_mineur: boolean; statut: string }>("SELECT id, est_mineur, statut FROM adherent")
    ).rows[0]!;
    expect(row).toEqual({ id: 1000, est_mineur: false, statut: "actif" });
    // Préfixe de 100 caractères : même début → refusé.
    await expect(
      pg.exec(`INSERT INTO adherent (num_carte, nom, email) VALUES ('C2', 'Bob', '${"a".repeat(100)}y@y');`),
    ).rejects.toThrow(/uq_email_prefixe/);
    await expect(
      pg.exec("INSERT INTO adherent (num_carte, nom, email, statut) VALUES ('C3', 'Cy', 'c@c', 'inconnu');"),
    ).rejects.toThrow(/check/i);
    await expect(
      pg.exec(
        "INSERT INTO adherent (num_carte, nom, email, centres_interet) VALUES ('C4', 'Di', 'd@d', '{roman,polar}');",
      ),
    ).rejects.toThrow(/check/i);
    await pg.exec("INSERT INTO oeuvre (isbn, titre, type, prix_ht) VALUES ('9782070360000', 'Titre', 'livre', 10.00);");
    expect((await pg.query("SELECT prix_ttc FROM oeuvre")).rows).toEqual([{ prix_ttc: "10.55" }]);
    await pg.exec(`INSERT INTO "Exemplaire" (id_oeuvre, num_ex, code_barre) VALUES (1, 1, 'X1');`);
    await pg.exec(
      "INSERT INTO emprunt (adherent_id, id_oeuvre, num_ex, date_emprunt) VALUES (1000, 1, 1, '2026-01-10 15:00');",
    );
    expect((await pg.query<{ d: string }>("SELECT date_retour_prevue::text AS d FROM emprunt")).rows).toEqual([
      { d: "2026-01-31" },
    ]);
    expect((await pg.query("SELECT col_description('oeuvre'::regclass, 6) AS c")).rows).toEqual([
      { c: "Prix HT -- hors remise; voir /* règle 3 */ l'ancien barème" },
    ]);
    await pg.close();
  });
});

describe("autres cibles : toute différence est au rapport", () => {
  it.each<[Dbms, string | undefined]>([
    ["postgresql", "16"],
    ["sqlserver", "2022"],
    ["oracle", "23ai"],
    ["sqlite", undefined],
  ])("%s %s", (dbms, version) => {
    const { sql, losses } = generate(dbms, version);
    const differences = diffCatalogs(catalogOf(SOURCE, "mysql"), catalogOf(sql, dbms), true, dbms);
    expect(unjustified(differences, losses)).toEqual([]);
  });

  it("MySQL → MySQL : catalogue identique, rien au rapport", () => {
    const { sql, losses } = generate("mysql", "8.4");
    expect(losses).toEqual([]);
    expect(diffCatalogs(catalogOf(SOURCE, "mysql"), catalogOf(sql, "mysql"), true)).toEqual([]);
  });
});
