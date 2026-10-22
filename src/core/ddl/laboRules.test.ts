import { describe, expect, it } from "vitest";
import type { Dbms } from "../dbms/dbms";
import { toLogicalModel } from "../mld/transform";
import type { ModelDocument } from "../model/document";
import { model } from "../testing/builder";
import { body, createTable, generate, laboDoc, reverse, statements } from "../testing/laboFixture";

/**
 * Aller-retour sur le script du laboratoire (override O-29), suite : règles P0 et P1 de la
 * rétroconception et de la génération, cas à protéger.
 */

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
      if (!create) {
        continue;
      }
      const table = create[2]!;
      for (const [, ref] of statement.matchAll(/REFERENCES "?(\w+)"?\(/g)) {
        expect(ref === table || created.includes(ref!)).toBe(true);
      }
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
    for (const link of doc.links) {
      delete link.sharedColumns;
    }
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
    expect(sql).toMatch(/^-- .*\n(-- {3}• .*\n)*-- {3}• Laboratoire\.id_directeur — ON DELETE RESTRICT/);
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
