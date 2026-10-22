import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import { toLogicalModel } from "../mld/transform";
import { emptyDocument } from "../model/factory";
import { reverseEngineer } from "../reverse/build";
import { catalogOf, diffCatalogs } from "../testing/catalog";
import { announced, execute, generate, SOURCE, table, unjustified, V1 } from "../testing/mediathequeFixture";
import { generateDdl } from "./generate";

/**
 * Itération 3 (override O-35) : script MySQL réel (fixtures/mediatheque_mysql.sql) → PostgreSQL 18.
 * fixtures/mediatheque_pg_v1.sql : sortie d'avant ces travaux (témoin négatif).
 */

// ---------------------------------------------------------------------------------------------

describe("critères d'acceptation", () => {
  // Premier test du fichier : deux démarrages de PGlite et la génération à froid (≈ 5 s, suite complète).
  it("la sortie s'exécute sur PostgreSQL 18 (PGlite 18) ; la v1 échouait", { timeout: 15_000 }, async () => {
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
      if (l.column && !/,/.test(l.column)) {
        expect(create).toMatch(new RegExp(`\\b${l.column}\\b`));
      }
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
    if (!result.ok) {
      throw new Error(result.error);
    }
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
    if (!result.ok) {
      throw new Error(result.error);
    }
    expect(result.sql).not.toMatch(/COLLATE/);
    expect(result.losses).toContainEqual(expect.objectContaining({ category: "collation", column: "nom" }));
  });
});

describe("P0 — le script s'exécute", () => {
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
    if (!result.ok) {
      throw new Error(result.error);
    }
    expect(table(result.sql, "oeuvre")).toContain("annee SMALLINT CHECK (annee BETWEEN 1901 AND 2155)");
  });
});

describe("P0 — le script s'exécute", () => {
  it("3. un CHECK devenu incompatible avec le type de sa colonne est signalé (et non émis)", () => {
    const sql = SOURCE.replace("annee            YEAR,", "annee            VARCHAR(4),");
    const result = generateDdl(toLogicalModel(reverseEngineer(sql, emptyDocument()).doc), {
      dbms: "postgresql",
      version: "18",
    });
    if (!result.ok) {
      throw new Error(result.error);
    }
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
});

describe("P1 — pertes sémantiques", () => {
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
