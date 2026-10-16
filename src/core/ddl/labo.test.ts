import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import type { Dbms } from "../dbms/dbms";
import { toLogicalModel } from "../mld/transform";
import type { ModelDocument } from "../model/document";
import { emptyDocument } from "../model/factory";
import type { DdlOptions } from "../model/settings";
import { reverseEngineer } from "../reverse/build";
import { model } from "../testing/builder";
import { catalogOf, type Difference, diffCatalogs } from "../testing/catalog";
import { generateDdl, type Loss } from "./generate";

/**
 * Aller-retour LDD → MCD → LDD sur le script réel du laboratoire (override O-29).
 * `fixtures/labo_sqlite.sql` : cycle chercheur ↔ Laboratoire, réflexives, FK composites,
 * colonnes partagées, contraintes nommées, CHECK, DEFAULT, index, nom quoté.
 */

const SOURCE = readFileSync("fixtures/labo_sqlite.sql", "utf8");

function reverse(sql = SOURCE) {
  return reverseEngineer(sql, emptyDocument());
}

function generate(doc: ModelDocument, dbms: Dbms, version?: string, options: Partial<DdlOptions> = {}) {
  const result = generateDdl(toLogicalModel(doc), { dbms, version }, options);
  if (!result.ok) throw new Error(result.error);
  return result;
}

const laboDoc = () => reverse().doc;

const statements = (sql: string) =>
  sql
    .split(/;\s*\n/)
    .map((s) => s.replace(/^\s*--.*$/gm, "").trim())
    .filter(Boolean);

/** Script sans le rapport de pertes en tête. */
const body = (sql: string) => sql.replace(/^(--.*\n)+\n/, "");

const createTable = (sql: string, table: string) =>
  statements(sql).find((s) => new RegExp(`^CREATE TABLE ["\`\\[]?${table}["\`\\]]?\\(`, "i").test(s))!;

// ---------------------------------------------------------------------------------------------

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

/** Structure lue par SQLite lui-même (PRAGMA), indépendante de notre parseur. */
function sqliteIntrospect(sql: string) {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec(sql);
  const tables = (
    db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .all() as { name: string }[]
  ).map((t) => t.name);
  const result = tables.map((table) => {
    const pk = (db.prepare(`PRAGMA table_info("${table}")`).all() as { name: string; pk: number }[])
      .filter((c) => c.pk)
      .sort((a, b) => a.pk - b.pk)
      .map((c) => c.name);
    const columns = (db.prepare(`PRAGMA table_info("${table}")`).all() as Record<string, unknown>[]).map((c) => ({
      name: c.name,
      type: String(c.type).replace(/\s+/g, "").toUpperCase(),
      notnull: c.notnull,
      dflt: c.dflt_value,
      pk: c.pk,
    }));
    const fks = (db.prepare(`PRAGMA foreign_key_list("${table}")`).all() as Record<string, unknown>[]).map((f) => {
      const referencedPk = (
        db.prepare(`PRAGMA table_info("${String(f.table)}")`).all() as { name: string; pk: number }[]
      )
        .filter((c) => c.pk)
        .sort((a, b) => a.pk - b.pk);
      return {
        id: f.id,
        seq: f.seq,
        table: f.table,
        from: f.from,
        to: f.to ?? referencedPk[Number(f.seq)]!.name,
        onUpdate: f.on_update,
        onDelete: f.on_delete,
      };
    });
    const groups = new Map<unknown, typeof fks>();
    for (const f of fks) groups.set(f.id, [...(groups.get(f.id) ?? []), f]);
    const groupedFks = [...groups.values()].map((group) => ({
      table: group[0]!.table,
      from: group.map((f) => f.from),
      to: group.map((f) => f.to),
      onUpdate: group[0]!.onUpdate,
      onDelete: group[0]!.onDelete,
    }));
    const indexes = (
      db.prepare(`PRAGMA index_list("${table}")`).all() as { name: string; unique: number; origin: string }[]
    ).map((i) => ({
      unique: i.unique,
      origin: i.origin,
      columns: (db.prepare(`PRAGMA index_info("${i.name}")`).all() as { name: string }[]).map((c) => c.name),
      name: i.origin === "c" || !i.name.startsWith("sqlite_autoindex") ? i.name : undefined,
    }));
    const sort = <T>(list: T[]) => [...list].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    return { table, pk, columns, fks: sort(groupedFks), indexes: sort(indexes) };
  });
  db.close();
  return result;
}

/**
 * Problèmes d'un script PostgreSQL au regard de la source : exécution refusée par PostgreSQL
 * (PGlite), table créée avant une table qu'elle référence en ligne, et toute différence de
 * catalogue non annoncée par le rapport de pertes de l'en-tête. Vide = script fidèle.
 */
async function pgProblems(sql: string): Promise<string[]> {
  const problems: string[] = [];
  const pg = new PGlite();
  try {
    await pg.exec(sql);
  } catch (e) {
    problems.push(`exécution : ${String((e as Error).message)}`);
  } finally {
    await pg.close();
  }
  const created: string[] = [];
  for (const statement of statements(sql)) {
    const create = /^CREATE TABLE ("?)(\w+)\1\(/i.exec(statement);
    if (!create) continue;
    for (const [, ref] of statement.matchAll(/REFERENCES "?(\w+)"?\s*\(/gi)) {
      if (ref!.toLowerCase() !== create[2]!.toLowerCase() && !created.includes(ref!.toLowerCase()))
        problems.push(`ordre : ${create[2]} référence ${ref} avant sa création`);
    }
    created.push(create[2]!.toLowerCase());
  }
  const announced = sql.match(/^--   • .*$/gm) ?? [];
  for (const d of diffCatalogs(catalogOf(SOURCE, "sqlite"), catalogOf(sql, "postgresql"), true)) {
    const where = [d.table, d.column].filter(Boolean).join(".");
    if (!announced.some((line) => line.toLowerCase().includes(where.toLowerCase())))
      problems.push(`non annoncé : ${where} ${d.category} ${d.detail}`);
  }
  return problems;
}

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

  it("PostgreSQL (PGlite) : le script s'exécute ; clés, actions, UNIQUE, CHECK et index présents", async () => {
    const { sql, losses } = generate(laboDoc(), "postgresql", "16");
    expect(losses).toEqual([]);
    const pg = new PGlite();
    await pg.exec(sql);
    const constraints = await pg.query<{ tbl: string; conname: string; contype: string; del: string; upd: string }>(`
      SELECT conrelid::regclass::text AS tbl, conname, contype, confdeltype AS del, confupdtype AS upd
      FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace WHERE n.nspname = 'public'`);
    const rows = constraints.rows;
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
        .sort(),
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
    if (losses.length) expect(sql.startsWith(`-- `)).toBe(true);
  });
});

// ---------------------------------------------------------------------------------------------

/**
 * Associations binaires issues d'une clé étrangère de `child` vers `parent` : la patte de
 * `child` (1,1 ou 0,1, porteuse des actions) et celle de `parent` (côté référencé).
 */
function linksBetween(doc: ModelDocument, child: string, parent: string) {
  const id = (name: string) => doc.entities.find((e) => (e.logicalName ?? e.name) === name)!.id;
  const [c, p] = [id(child), id(parent)];
  return doc.associations
    .map((a) => doc.links.filter((l) => l.associationId === a.id))
    .filter((links) => links.length === 2)
    .map(([a, b]) => (a!.entityId === p && b!.entityId === c && b!.cardinality.max === 1 ? [b!, a!] : [a!, b!]))
    .filter(
      ([x, y]) =>
        x!.entityId === c &&
        y!.entityId === p &&
        x!.cardinality.max === 1 &&
        (c !== p || x!.foreignKeyNames === undefined),
    )
    .map(([x, y]) => ({ child: x!, parent: y! }));
}

describe("P0.1 — ordre de création et clés étrangères circulaires", () => {
  it("tables triées ; la FK qui ferme le cycle passe en ALTER TABLE ; les réflexives restent en ligne", () => {
    const { sql } = generate(laboDoc(), "postgresql", "16");
    const created: string[] = [];
    for (const statement of statements(sql)) {
      const create = /^CREATE TABLE ("?)(\w+)\1\(/.exec(statement);
      if (!create) continue;
      const table = create[2]!;
      for (const [, ref] of statement.matchAll(/REFERENCES "?(\w+)"?\(/g))
        expect(ref === table || created.includes(ref!)).toBe(true);
      created.push(table);
    }
    // Comme dans la source : chercheur d'abord, sa référence en avant vers Laboratoire différée.
    expect(created).toEqual(["chercheur", "Laboratoire", "projet", "phase", "participer"]);
    const alters = statements(sql).filter((s) => s.startsWith("ALTER TABLE"));
    expect(alters).toEqual([
      'ALTER TABLE chercheur ADD CONSTRAINT fk_chercheur_labo FOREIGN KEY(labo_code, labo_site) REFERENCES "Laboratoire"(code_labo, site)',
    ]);
    expect(createTable(sql, "chercheur")).toContain(
      "FOREIGN KEY(id_mentor) REFERENCES chercheur(id_chercheur) ON DELETE SET NULL",
    );
    expect(createTable(sql, "phase")).toContain("REFERENCES phase(id_projet, num_phase)");
  });

  it("option « toutes les FK en ALTER TABLE en fin de script »", () => {
    const { sql } = generate(laboDoc(), "postgresql", "16", { foreignKeysInAlter: true });
    const creates = statements(sql).filter((s) => s.startsWith("CREATE TABLE"));
    expect(creates.every((s) => !s.includes("FOREIGN KEY"))).toBe(true);
    expect(statements(sql).filter((s) => s.startsWith("ALTER TABLE"))).toHaveLength(11);
    expect(sql).toContain(
      "ALTER TABLE projet ADD CONSTRAINT fk_projet_resp FOREIGN KEY(id_responsable) REFERENCES chercheur(id_chercheur);",
    );
  });

  it("option ignorée en SQLite (pas d'ALTER TABLE … ADD CONSTRAINT), et signalée", () => {
    const { sql, losses } = generate(laboDoc(), "sqlite", undefined, { foreignKeysInAlter: true });
    expect(body(sql)).not.toContain("ALTER TABLE");
    expect(losses.map((l) => l.category)).toEqual(["option"]);
  });

  it("parseur : FK déclarées par ALTER TABLE et références avant déclaration", () => {
    const { doc, report } = reverse(`
      CREATE TABLE a (id INTEGER PRIMARY KEY, b_id INTEGER NOT NULL REFERENCES b(id));
      CREATE TABLE b (id INTEGER PRIMARY KEY, a_id INTEGER);
      ALTER TABLE b ADD CONSTRAINT fk_b_a FOREIGN KEY (a_id) REFERENCES a(id) ON DELETE SET NULL;`);
    expect(report.warnings).toEqual([]);
    expect(linksBetween(doc, "a", "b")[0]!.child.cardinality).toEqual({ min: 1, max: 1 });
    const [ba] = linksBetween(doc, "b", "a");
    expect(ba!.child).toMatchObject({
      onDelete: "set null",
      foreignKeyConstraintName: "fk_b_a",
      cardinality: { min: 0, max: 1 },
    });
    expect(statements(generate(doc, "postgresql", "16").sql).filter((s) => s.startsWith("ALTER"))).toHaveLength(1);
  });
});

describe("P0.2 — UNIQUE sur les colonnes d'une FK ⇒ cardinalité max 1 côté référencé", () => {
  it("Laboratoire.id_directeur NOT NULL UNIQUE → 1,1 / 0,1, UNIQUE regénéré", () => {
    const doc = laboDoc();
    const link = linksBetween(doc, "Laboratoire", "chercheur").find((l) => l.child.onDelete === "restrict");
    expect(link!.child.cardinality).toEqual({ min: 1, max: 1 });
    expect(link!.parent.cardinality).toEqual({ min: 0, max: 1 });
    expect(createTable(generate(doc, "postgresql", "16").sql, "Laboratoire")).toContain(
      "id_directeur INTEGER NOT NULL UNIQUE",
    );
  });

  it("FK nullable + UNIQUE → 0,1 ; une association 1:1 du MCD émet le UNIQUE", () => {
    const { doc } = reverse(
      "CREATE TABLE p (id INTEGER PRIMARY KEY); CREATE TABLE c (id INTEGER PRIMARY KEY, p_id INTEGER UNIQUE REFERENCES p(id));",
    );
    const [link] = linksBetween(doc, "c", "p");
    expect(link!.child.cardinality).toEqual({ min: 0, max: 1 });
    expect(link!.parent.cardinality).toEqual({ min: 0, max: 1 });
    const built = model()
      .entity("CHERCHEUR", ["id*"])
      .entity("LABO", ["code*"])
      .association("DIRIGER", ["CHERCHEUR 0,1", "LABO 1,1"])
      .build();
    expect(createTable(generate(built, "postgresql", "16").sql, "LABO")).toMatch(/\bid\b.* NOT NULL UNIQUE,/);
  });

  it("un UNIQUE composite contenant la FK et d'autres colonnes ne déclenche pas la règle", () => {
    const [link] = linksBetween(laboDoc(), "projet", "Laboratoire");
    expect(link!.parent.cardinality.max).toBe("n");
  });
});

describe("P1.3 — colonnes partagées entre clés", () => {
  it("phase : avertissement, annotation, colonne id_projet réutilisée (pas de id_projet_2)", () => {
    const { doc, report } = reverse();
    expect(report.warnings).toEqual([expect.stringContaining("« phase »")]);
    const table = toLogicalModel(doc).tables.find((t) => t.name === "phase")!;
    expect(table.columns.map((c) => c.name)).toEqual([
      "id_projet",
      "num_phase",
      "libelle",
      "duree_semaines",
      "num_phase_precedente",
    ]);
    expect(table.foreignKeys.find((fk) => fk.referencedTable === "phase")!.columns).toEqual([
      "id_projet",
      "num_phase_precedente",
    ]);
  });

  it("sans annotation : comportement Merise standard (colonne dupliquée)", () => {
    const doc = laboDoc();
    for (const link of doc.links) delete link.sharedColumns;
    const table = toLogicalModel(doc).tables.find((t) => t.name === "phase")!;
    expect(table.columns.some((c) => c.name === "id_projet_2")).toBe(true);
  });
});

describe("P1.4 — actions référentielles et capacités par dialecte", () => {
  it("PostgreSQL : toutes conservées, RESTRICT distinct de NO ACTION", () => {
    const { sql, losses } = generate(laboDoc(), "postgresql", "16");
    expect(losses).toEqual([]);
    expect(sql).toContain("ON DELETE RESTRICT ON UPDATE CASCADE");
    expect(sql).toContain("ON DELETE SET NULL");
    expect(createTable(sql, "phase")).toContain("REFERENCES projet(id_projet) ON DELETE CASCADE");
  });

  it("Oracle : pas de ON UPDATE ni de RESTRICT → abandon signalé", () => {
    const { sql, losses } = generate(laboDoc(), "oracle", "23ai");
    expect(body(sql)).not.toContain("ON UPDATE");
    expect(body(sql)).not.toContain("RESTRICT");
    expect(sql).toContain("ON DELETE SET NULL");
    expect(losses.filter((l) => l.category === "action").map((l) => [l.table, l.column])).toEqual([
      ["Laboratoire", "id_directeur"],
      ["Laboratoire", "id_directeur"],
    ]);
    expect(sql).toMatch(/^-- .*\n(--   • .*\n)*--   • Laboratoire\.id_directeur — ON DELETE RESTRICT/);
  });

  it("SQL Server : RESTRICT → NO ACTION ; chemins de cascade multiples ou cycliques refusés", () => {
    const { sql, losses } = generate(laboDoc(), "sqlserver", "2022");
    expect(body(sql)).not.toContain("RESTRICT");
    expect(sql).toContain("ON DELETE NO ACTION ON UPDATE CASCADE");
    // réflexive SET NULL : cycle
    expect(createTable(sql, "chercheur")).not.toContain("SET NULL");
    const actions = losses.filter((l) => l.category === "action");
    expect(actions.some((l) => l.table === "chercheur" && l.column === "id_mentor")).toBe(true);
    expect(actions.some((l) => l.table === "Laboratoire" && l.message.includes("RESTRICT"))).toBe(true);
  });

  it("MySQL : SET DEFAULT dégradé et signalé", () => {
    const doc = laboDoc();
    doc.links.find((l) => l.onDelete === "set null")!.onDelete = "set default";
    const { losses } = generate(doc, "mysql", "8.4");
    expect(losses).toEqual([expect.objectContaining({ category: "action", table: "chercheur", column: "id_mentor" })]);
  });
});

describe("P1.5 — tout UNIQUE devient un identifiant alternatif et est regénéré", () => {
  it.each<[Dbms, string | undefined]>([
    ["postgresql", "16"],
    ["mysql", "8.4"],
    ["sqlserver", "2022"],
    ["oracle", "23ai"],
    ["sqlite", undefined],
  ])("%s", (dbms, version) => {
    const doc = laboDoc();
    const projet = doc.entities.find((e) => e.name === "projet")!;
    expect(projet.alternateKeys).toEqual([{ name: "uq_projet_acronyme", members: expect.any(Array) }]);
    expect(projet.alternateKeys![0]!.members).toHaveLength(3);
    const { sql } = generate(doc, dbms, version);
    expect(createTable(sql, "chercheur")).toMatch(/email (\S+|VARCHAR2\(\d+ CHAR\)) NOT NULL UNIQUE/);
    expect(createTable(sql, "projet")).toMatch(/CONSTRAINT uq_projet_acronyme UNIQUE\(acronyme, code_labo, site\)/i);
    expect(createTable(sql, "Laboratoire")).toMatch(/id_directeur \S+ NOT NULL UNIQUE/);
  });
});

describe("P1.6 — casse et guillemets", () => {
  it("nom quoté à l'origine : délimiteurs selon le dialecte, si le repli de casse le perdrait", () => {
    const doc = laboDoc();
    expect(doc.entities.find((e) => e.name === "Laboratoire")!.caseSensitive).toBe(true);
    expect(generate(doc, "postgresql", "16").sql).toContain('CREATE TABLE "Laboratoire"(');
    expect(generate(doc, "oracle", "23ai").sql).toContain('CREATE TABLE "Laboratoire"(');
    expect(generate(doc, "mysql", "8.4").sql).toContain("CREATE TABLE Laboratoire(");
    expect(generate(doc, "sqlserver", "2022").sql).toContain("CREATE TABLE Laboratoire(");
  });

  it("mots réservés et caractères spéciaux", () => {
    const { doc } = reverse(`CREATE TABLE t (id INTEGER PRIMARY KEY, "order" INTEGER, "date de fin" DATE, role TEXT)`);
    const line = (dbms: Dbms) => createTable(generate(doc, dbms).sql, "t");
    expect(line("postgresql")).toContain('"order" INTEGER');
    expect(line("postgresql")).toContain('"date de fin" DATE');
    expect(line("postgresql")).toMatch(/\brole TEXT/);
    expect(line("mysql")).toContain("`order` INT");
    expect(line("sqlserver")).toContain("[order] INT");
    expect(line("sqlserver")).toContain("[date de fin] DATE");
  });
});

describe("cas à protéger (non-régression)", () => {
  it("REFERENCES projet sans liste de colonnes → clé primaire de projet", () => {
    const table = toLogicalModel(laboDoc()).tables.find((t) => t.name === "phase")!;
    expect(table.foreignKeys.find((fk) => fk.referencedTable === "projet")).toMatchObject({
      columns: ["id_projet"],
      referencedColumns: ["id_projet"],
      onDelete: "cascade",
    });
  });

  it("colonnes de FK au nom différent de la colonne référencée (labo_code → code_labo)", () => {
    const table = toLogicalModel(laboDoc()).tables.find((t) => t.name === "chercheur")!;
    expect(table.foreignKeys.find((fk) => fk.referencedTable === "Laboratoire")).toMatchObject({
      name: "fk_chercheur_labo",
      columns: ["labo_code", "labo_site"],
      referencedColumns: ["code_labo", "site"],
    });
  });

  it("deux FK vers la même table (responsable, co-responsable)", () => {
    const doc = laboDoc();
    expect(linksBetween(doc, "projet", "chercheur")).toHaveLength(2);
    const table = toLogicalModel(doc).tables.find((t) => t.name === "projet")!;
    expect(
      table.foreignKeys.filter((fk) => fk.referencedTable === "chercheur").map((fk) => [fk.name, fk.columns[0]]),
    ).toEqual([
      ["fk_projet_resp", "id_responsable"],
      ["fk_projet_coresp", "id_coresponsable"],
    ]);
    expect(table.columns.find((c) => c.name === "id_coresponsable")!.notNull).toBe(false);
  });

  it("entité faible phase : identifiant relatif à projet", () => {
    const [link] = linksBetween(laboDoc(), "phase", "projet");
    expect(link!.child).toMatchObject({ relativeId: true, cardinality: { min: 1, max: 1 } });
  });

  it("participer : PK = FK simple + FK composite ; FK vers Laboratoire hors PK conservée NOT NULL", () => {
    const table = toLogicalModel(laboDoc()).tables.find((t) => t.name === "participer")!;
    expect(table.primaryKey).toEqual(["id_chercheur", "id_projet", "num_phase"]);
    expect(table.columns.map((c) => c.name)).toEqual([
      "id_chercheur",
      "id_projet",
      "num_phase",
      "code_labo",
      "site",
      "role",
      "taux_implication",
      "date_affectation",
    ]);
    expect(table.columns.filter((c) => c.name === "code_labo" || c.name === "site").every((c) => c.notNull)).toBe(true);
    expect(table.foreignKeys.map((fk) => fk.referencedTable).sort()).toEqual(["Laboratoire", "chercheur", "phase"]);
  });
});
