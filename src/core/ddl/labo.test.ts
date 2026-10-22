import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import type { Dbms } from "../dbms/dbms";
import { catalogOf, type Difference, diffCatalogs } from "../testing/catalog";
import { generate, laboDoc, pgProblems, reverse, SOURCE, sqliteIntrospect } from "../testing/laboFixture";
import { byCodeUnit } from "../testing/order";
import type { Loss } from "./generate";

/**
 * Aller-retour LDD → MCD → LDD sur le script réel du laboratoire (override O-29).
 * `fixtures/labo_sqlite.sql` : cycle chercheur ↔ Laboratoire, réflexives, FK composites,
 * colonnes partagées, contraintes nommées, CHECK, DEFAULT, index, nom quoté.
 */

describe("aller-retour même dialecte (critère 1)", () => {
  it("SQLite → MCD → SQLite : catalogue normalisé identique", () => {
    const { sql } = generate(laboDoc(), "sqlite");
    expect(diffCatalogs(catalogOf(SOURCE, "sqlite"), catalogOf(sql, "sqlite"))).toEqual([]);
  });

  it("le script regénéré est un point fixe (re-parse → regénération identique)", () => {
    const first = generate(laboDoc(), "sqlite");
    const second = generate(reverse(first.sql).doc, "sqlite");
    expect(second).toEqual(first);
  });

  it("aucune perte annoncée vers le même dialecte", () => {
    expect(generate(laboDoc(), "sqlite").losses).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------

describe("validation PostgreSQL : témoin négatif sur l'ancienne sortie", () => {
  it("la sortie actuelle n'a aucun problème", async () => {
    expect(await pgProblems(generate(laboDoc(), "postgresql", "16").sql)).toEqual([]);
  });

  it("l'ancienne sortie (fixtures/labo_pg_regenere.sql) est rejetée", async () => {
    const problems = await pgProblems(readFileSync("fixtures/labo_pg_regenere.sql", "utf8"));
    expect(problems).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^exécution : .*chercheur.* does not exist/),
        "ordre : Laboratoire référence chercheur avant sa création",
        expect.stringMatching(/^non annoncé : phase\.id_projet_2 column/),
        // CHECK (grade IN (…)) perdu : c'est le domaine de grade (O-35).
        expect.stringMatching(/^non annoncé : chercheur\.grade domain/),
        expect.stringMatching(/^non annoncé : chercheur\.id_mentor action ON DELETE set null → no action/),
        expect.stringMatching(/^non annoncé : Laboratoire unique/),
        "non annoncé : projet name FK fk_projet_resp → undefined",
      ]),
    );
  });
});

describe("exécution réelle (critère 2)", () => {
  it("SQLite en mémoire : le script regénéré s'exécute et SQLite y voit la même structure que la source", () => {
    const { sql } = generate(laboDoc(), "sqlite");
    expect(sqliteIntrospect(sql)).toEqual(sqliteIntrospect(SOURCE));
  });

  it("SQLite : contraintes actives (CHECK, UNIQUE, cascade, SET NULL, RESTRICT)", () => {
    const db = new DatabaseSync(":memory:");
    db.exec("PRAGMA foreign_keys = ON;");
    db.exec(generate(laboDoc(), "sqlite").sql);
    db.exec(`
      PRAGMA foreign_keys = OFF;
      INSERT INTO chercheur (id_chercheur, nom, email, labo_code, labo_site) VALUES (1, 'Curie', 'mc@x', 'L1', 'Paris');
      INSERT INTO Laboratoire VALUES ('L1', 'Paris', 'Labo 1', 1000, 1);
      PRAGMA foreign_keys = ON;
      INSERT INTO chercheur (id_chercheur, nom, email, id_mentor) VALUES (2, 'Joliot', 'fj@x', 1);
      INSERT INTO projet VALUES (10, 'Projet', 'P', '2024-01-01', NULL, 'L1', 'Paris', 1, 2);
      INSERT INTO phase VALUES (10, 1, 'Étude', 4, NULL), (10, 2, 'Réalisation', 8, 1);
      INSERT INTO participer (id_chercheur, id_projet, num_phase, code_labo, site, taux_implication) VALUES (2, 10, 2, 'L1', 'Paris', 0.5);
    `);
    expect(() => db.exec("INSERT INTO chercheur (nom, email, grade) VALUES ('X', 'x@x', 'stagiaire')")).toThrow(
      /CHECK/,
    );
    expect(() => db.exec("INSERT INTO chercheur (nom, email) VALUES ('Y', 'mc@x')")).toThrow(/UNIQUE/);
    expect(() => db.exec("DELETE FROM chercheur WHERE id_chercheur = 1")).toThrow(/FOREIGN KEY/); // RESTRICT (directeur)
    expect(db.prepare("SELECT role, date_affectation IS NOT NULL AS dated FROM participer").get()).toEqual({
      role: "contributeur",
      dated: 1,
    });
    db.exec("DELETE FROM phase WHERE num_phase = 2");
    expect(db.prepare("SELECT count(*) AS n FROM participer").get()).toEqual({ n: 0 }); // CASCADE
    db.close();
  });
});

describe("exécution réelle (critère 2)", () => {
  it("PostgreSQL (PGlite) : le script s'exécute ; clés, actions, UNIQUE, CHECK et index présents", async () => {
    const { sql, losses } = generate(laboDoc(), "postgresql", "16");
    expect(losses).toEqual([]);
    const pg = new PGlite();
    await pg.exec(sql);
    const constraints = await pg.query<{ tbl: string; conname: string; contype: string; del: string; upd: string }>(`
      SELECT conrelid::regclass::text AS tbl, conname, contype, confdeltype AS del, confupdtype AS upd
      FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace WHERE n.nspname = 'public'`);
    const { rows } = constraints;
    const count = (type: string) => rows.filter((r) => r.contype === type).length;
    expect(count("f")).toBe(11);
    expect(count("p")).toBe(5);
    expect(count("u")).toBe(3); // email, uq_projet_acronyme, id_directeur
    expect(count("c")).toBe(6);
    for (const name of [
      "pk_projet",
      "uq_projet_acronyme",
      "ck_projet_dates",
      "ck_resp_distincts",
      "fk_projet_labo",
      "fk_projet_resp",
      "fk_projet_coresp",
      "fk_chercheur_labo",
    ]) {
      expect(rows.some((r) => r.conname === name)).toBe(true);
    }
    const directeur = rows.find((r) => r.tbl === '"Laboratoire"' && r.contype === "f")!;
    expect([directeur.del, directeur.upd]).toEqual(["r", "c"]); // RESTRICT, CASCADE
    expect(
      rows
        .filter((r) => r.tbl === "chercheur" && r.contype === "f")
        .map((r) => r.del)
        .sort(byCodeUnit),
    ).toEqual(["a", "n"]); // NO ACTION, SET NULL
    const index = await pg.query<{ indexname: string }>(
      "SELECT indexname FROM pg_indexes WHERE indexname = 'ix_participer_labo'",
    );
    expect(index.rows).toHaveLength(1);
    // Comportement : SET NULL sur le mentor, défaut CURRENT_DATE.
    await pg.exec(`
      BEGIN;
      INSERT INTO chercheur (id_chercheur, nom, email) VALUES (1, 'Curie', 'mc@x'), (2, 'Joliot', 'fj@x');
      UPDATE chercheur SET id_mentor = 1 WHERE id_chercheur = 2;
      INSERT INTO "Laboratoire" VALUES ('L1', 'Paris', 'Labo', 0, 2);
      COMMIT;
      DELETE FROM chercheur WHERE id_chercheur = 1;`);
    expect((await pg.query("SELECT id_mentor FROM chercheur")).rows).toEqual([{ id_mentor: null }]);
    await pg.close();
  });
});

// ---------------------------------------------------------------------------------------------

/** Une différence est couverte si le rapport cite la même table, la même catégorie et, s'il y a lieu, la même colonne. */
function uncovered(differences: Difference[], losses: Loss[]): Difference[] {
  const category: Partial<Record<Difference["category"], Loss["category"][]>> = {
    type: ["type", "autoIncrement"],
    autoIncrement: ["autoIncrement", "type"],
    default: ["default"],
    action: ["action"],
    check: ["check"],
    name: ["name"],
    // O-39
    range: ["type", "unsigned"],
    unique: ["index"],
    index: ["index"],
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
          category[d.category]?.includes(l.category) &&
          [{ table: d.table, column: d.column }, ...(d.references ?? [])].some(
            (r) => l.table.toLowerCase() === r.table.toLowerCase() && same(r.column, l.column),
          ),
      ),
  );
}

describe("inter-dialectes (critère 3) : toute différence avec la source figure au rapport de pertes", () => {
  it.each<[Dbms, string | undefined]>([
    ["postgresql", "16"],
    ["postgresql", undefined],
    ["mysql", "8.4"],
    ["mariadb", undefined],
    ["sqlserver", "2022"],
    ["oracle", "23ai"],
    ["oracle", "11g"],
    ["db2", undefined],
  ])("%s %s", (dbms, version) => {
    const { sql, losses } = generate(laboDoc(), dbms, version);
    const differences = diffCatalogs(catalogOf(SOURCE, "sqlite"), catalogOf(sql, dbms), true);
    expect(uncovered(differences, losses)).toEqual([]);
    // Le rapport est aussi en tête du script.
    if (losses.length > 0) {
      expect(sql.startsWith("-- ")).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------------------------
