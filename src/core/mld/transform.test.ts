import { describe, expect, it } from "vitest";
import { generateDdl } from "../ddl/generate";
import { createAssociation, createAutoIdentifier, createLink } from "../model/factory";
import { MSG } from "../validation/messages";
import { model } from "../testing/builder";
import { hasErrors, issueMessage } from "./logical";
import { mldPlainText } from "./text";
import { toLogicalModel } from "./transform";

const mld = (m: ReturnType<typeof model>) => mldPlainText(toLogicalModel(m.build()));

describe("passage MCD → MLD", () => {
  it("entité → table", () => {
    expect(mld(model().entity("CLIENT", ["id_client*", "nom"]))).toBe("CLIENT = (_id_client_, nom);");
  });

  it("association 1-n → clé étrangère NOT NULL côté 1, sans table", () => {
    const m = model()
      .entity("CLIENT", ["id_client*"])
      .entity("COMMANDE", ["id_commande*"])
      .association("PASSER", ["CLIENT 0,n", "COMMANDE 1,1"]);
    const logical = toLogicalModel(m.build());
    expect(mldPlainText(logical)).toBe("CLIENT = (_id_client_);\nCOMMANDE = (_id_commande_, #id_client);");
    expect(logical.tables[1]!.columns[1]!.notNull).toBe(true);
  });

  it("cardinalité 0,1 → clé étrangère nullable", () => {
    const logical = toLogicalModel(
      model()
        .entity("SALARIE", ["id_salarie*"])
        .entity("SERVICE", ["id_service*"])
        .association("AFFECTER", ["SALARIE 0,1", "SERVICE 0,n"])
        .build(),
    );
    expect(logical.tables[0]!.columns.find((c) => c.name === "id_service")!.notNull).toBe(false);
  });

  it("association n-n porteuse → table de correspondance", () => {
    expect(
      mld(
        model()
          .entity("COMMANDE", ["id_commande*"])
          .entity("PRODUIT", ["id_produit*"])
          .association("CONTENIR", ["COMMANDE 1,n", "PRODUIT 0,n"], ["quantite"]),
      ),
    ).toContain("CONTENIR = (_#id_commande_, _#id_produit_, quantite);");
  });

  it("association ternaire → clé primaire des 3 clés étrangères", () => {
    const logical = toLogicalModel(
      model()
        .entity("A", ["a*"])
        .entity("B", ["b*"])
        .entity("C", ["c*"])
        .association("R", ["A 0,n", "B 1,n", "C 0,n"])
        .build(),
    );
    expect(logical.tables.find((t) => t.name === "R")!.primaryKey).toEqual(["a", "b", "c"]);
  });

  it("identifiant relatif → clé étrangère dans la clé primaire", () => {
    expect(
      mld(
        model()
          .entity("BATIMENT", ["id_batiment*"])
          .entity("SALLE", ["num_salle*"])
          .association("COMPORTER", ["BATIMENT 0,n", "SALLE 1,1(R)"]),
      ),
    ).toContain("SALLE = (_#id_batiment_, _num_salle_);");
  });

  it("identifiants relatifs circulaires", () => {
    const logical = toLogicalModel(
      model()
        .entity("A", ["a*"])
        .entity("B", ["b*"])
        .association("R1", ["A 1,1(R)", "B 0,n"])
        .association("R2", ["B 1,1(R)", "A 0,n"])
        .build(),
    );
    expect(logical.issues.map((i) => i.message)).toContain(MSG.circularReferences);
  });

  it("entité fictive : pas de table, identifiant dans la clé sans contrainte", () => {
    const logical = toLogicalModel(
      model()
        .entity("SALLE", ["id_salle*"])
        .entity("DATE", ["jour*"], { fictive: true })
        .entity("PROF", ["id_prof*"])
        .association("RESERVER", ["SALLE 0,n", "DATE 0,n", "PROF 0,n"])
        .build(),
    );
    expect(logical.tables.map((t) => t.name)).toEqual(["SALLE", "PROF", "RESERVER"]);
    const reserver = logical.tables[2]!;
    expect(reserver.primaryKey).toEqual(["id_salle", "jour", "id_prof"]);
    expect(reserver.foreignKeys.map((f) => f.referencedTable)).toEqual(["SALLE", "PROF"]);
  });

  it("entité sans identifiant → erreur, SQL bloqué", () => {
    const logical = toLogicalModel(model().entity("CLIENT", ["nom"]).build());
    expect(hasErrors(logical)).toBe(true);
    expect(generateDdl(logical, { dbms: "postgresql" })).toEqual({ ok: false, error: MSG.sqlBlocked });
  });

  it("association à une seule patte", () => {
    const logical = toLogicalModel(model().entity("A", ["a*"]).association("R", ["A 0,n"]).build());
    expect(logical.issues.map((i) => i.message)).toContain(MSG.associationNeedsTwoLegs);
  });

  it("association réflexive n-n : la seconde clé étrangère est suffixée (override O-13)", () => {
    const logical = toLogicalModel(
      model().entity("EMPLOYE", ["id*"]).association("ENCADRER", ["EMPLOYE 0,n", "EMPLOYE 0,n"]).build(),
    );
    expect(hasErrors(logical)).toBe(false);
    expect(mldPlainText(logical)).toContain("ENCADRER = (_#id_, _#id_2_);");
  });
});

describe("script LDD", () => {
  it("tables dans l'ordre des dépendances, types du SGBD, cascades", () => {
    const doc = model()
      .entity("COMMANDE", ["id_commande*"])
      .entity("CLIENT", ["id_client*", "nom"])
      .association("PASSER", ["CLIENT 0,n", "COMMANDE 1,1"])
      .typed("CLIENT", "id_client", { kind: "counter" })
      .typed("CLIENT", "nom", { kind: "text", encoding: "ascii", length: "variable", size: 50 })
      .typed("COMMANDE", "id_commande", { kind: "counter" })
      .build();
    doc.links[1]!.onDelete = "cascade";
    const result = generateDdl(toLogicalModel(doc), { dbms: "postgresql", version: "9.6" });
    expect(result).toEqual({
      ok: true,
      losses: [],
      sql: [
        "CREATE TABLE CLIENT(",
        "   id_client SERIAL,",
        "   nom VARCHAR(50),",
        "   PRIMARY KEY(id_client)",
        ");",
        "",
        "CREATE TABLE COMMANDE(",
        "   id_commande SERIAL,",
        "   id_client INTEGER NOT NULL,",
        "   PRIMARY KEY(id_commande),",
        "   FOREIGN KEY(id_client) REFERENCES CLIENT(id_client) ON DELETE CASCADE",
        ");",
        "",
      ].join("\n"),
    });
  });
});

describe("avertissements", () => {
  it("rubrique non typée : avertissement, SQL non bloqué", () => {
    const logical = toLogicalModel(model().entity("CLIENT", ["id*"]).build());
    expect(logical.issues).toHaveLength(1);
    expect(logical.issues[0]!.severity).toBe("warning");
    expect(generateDdl(logical, { dbms: "sqlite" }).ok).toBe(true);
  });
});

describe("renommage des clés étrangères (override O-07)", () => {
  it("réflexive DF : suffixe par défaut, puis renommage", () => {
    const doc = model().entity("EMPLOYE", ["id*"]).association("ENCADRER", ["EMPLOYE 0,1", "EMPLOYE 0,n"]).build();
    expect(mldPlainText(toLogicalModel(doc))).toBe("EMPLOYE = (_id_, #id_2);");
    const idAttr = doc.entities[0]!.attributes[0]!.id;
    // La clé référence l'entité de la patte 0,n (côté parent).
    doc.links[1]!.foreignKeyNames = { [idAttr]: "id_chef" };
    const logical = toLogicalModel(doc);
    expect(hasErrors(logical)).toBe(false);
    expect(mldPlainText(logical)).toBe("EMPLOYE = (_id_, #id_chef);");
    expect(logical.tables[0]!.foreignKeys[0]).toMatchObject({ columns: ["id_chef"], referencedColumns: ["id"] });
  });

  it("réflexive n-n : deux clés renommées dans la table de correspondance", () => {
    const doc = model().entity("PERSONNE", ["id*"]).association("CONNAITRE", ["PERSONNE 0,n", "PERSONNE 0,n"]).build();
    const idAttr = doc.entities[0]!.attributes[0]!.id;
    doc.links[0]!.foreignKeyNames = { [idAttr]: "id_personne" };
    doc.links[1]!.foreignKeyNames = { [idAttr]: "id_connaissance" };
    expect(mldPlainText(toLogicalModel(doc))).toContain("CONNAITRE = (_#id_personne_, _#id_connaissance_);");
  });

  it("le renommage d'un identifiant relatif se propage aux tables qui référencent l'entité faible", () => {
    const doc = model()
      .entity("BATIMENT", ["id_batiment*"])
      .entity("SALLE", ["num*"])
      .entity("RESA", ["id_resa*"])
      .association("COMPORTER", ["BATIMENT 0,n", "SALLE 1,1(R)"])
      .association("CONCERNER", ["RESA 1,1", "SALLE 0,n"])
      .build();
    const batId = doc.entities[0]!.attributes[0]!.id;
    doc.links[0]!.foreignKeyNames = { [batId]: "batiment" };
    const text = mldPlainText(toLogicalModel(doc));
    expect(text).toContain("SALLE = (_#batiment_, _num_);");
    expect(text).toContain("RESA = (_id_resa_, #batiment, #num);");
  });

  it("chaque colonne migrée indique sa patte et son nom par défaut", () => {
    const doc = model().entity("A", ["a*"]).entity("B", ["b*"]).association("R", ["A 0,n", "B 1,1"]).build();
    const column = toLogicalModel(doc).tables[1]!.columns[1]!;
    expect(column.origin).toEqual({ linkId: doc.links[0]!.id, attributeId: doc.entities[0]!.attributes[0]!.id, defaultName: "a" });
  });
});

describe("nommage des clés (override O-13)", () => {
  const base = () => {
    const doc = model().entity("user", []).entity("post", []).association("ecrire", ["user 0,n", "post 1,1"]).build();
    doc.settings.keys = { primary: "id_<table>", foreign: "<table>_id" };
    for (const e of doc.entities) e.attributes = [createAutoIdentifier("code <entity>", e.name)];
    return doc;
  };

  it("clé primaire « id_<table> » et clé étrangère « <table>_id »", () => {
    expect(mldPlainText(toLogicalModel(base()))).toBe("user = (_id_user_);\npost = (_id_post_, #user_id);");
  });

  it("le nom conceptuel du discriminant automatique est « code <entité> »", () => {
    expect(base().entities[0]!.attributes[0]!.name).toBe("code user");
  });

  it("plusieurs clés étrangères identiques : user_id, user_id_2, user_id_3", () => {
    const doc = base();
    doc.associations = [];
    doc.links = [];
    const user = doc.entities[0]!;
    const m = model().build();
    m.settings.keys = doc.settings.keys;
    m.entities = [user];
    const a = createAssociation("suivre", { x: 0, y: 0 });
    m.associations = [a];
    m.links = [createLink(a.id, user.id), createLink(a.id, user.id), createLink(a.id, user.id)];
    expect(mldPlainText(toLogicalModel(m))).toContain("suivre = (_#user_id_, _#user_id_2_, _#user_id_3_);");
  });

  it("schéma <name> : le nom logique dérive du nom conceptuel", () => {
    const doc = base();
    doc.settings.keys.primary = "<name>";
    expect(mldPlainText(toLogicalModel(doc))).toContain("user = (_code user_);");
  });

  it("clé composée : « <table>_id » retombe sur le nom de la colonne référencée", () => {
    const doc = model()
      .entity("BATIMENT", ["num_bat*"])
      .entity("SALLE", ["num_salle*"])
      .entity("RESA", ["id_resa*"])
      .association("COMPORTER", ["BATIMENT 0,n", "SALLE 1,1(R)"])
      .association("CONCERNER", ["RESA 1,1", "SALLE 0,n"])
      .build();
    doc.settings.keys.foreign = "<table>_id";
    const text = mldPlainText(toLogicalModel(doc));
    expect(text).toContain("SALLE = (_#BATIMENT_id_, _num_salle_);");
    expect(text).toContain("RESA = (_id_resa_, #BATIMENT_id, #num_salle);");
  });
});

describe("contrôles complets du MCD (override O-15)", () => {
  it("noms d'entités en double et rubriques en double", () => {
    const doc = model().entity("A", ["x*", "x"]).entity("A", ["y*"]).build();
    const messages = toLogicalModel(doc).issues.map((i) => i.message);
    expect(messages).toContain(MSG.duplicateEntityName("A"));
    expect(messages).toContain(MSG.duplicateAttributesIn("A"));
    expect(messages).toContain(MSG.duplicateTableConceptual("A"));
  });
});

describe("vocabulaire par couche (override O-24)", () => {
  it("entité sans discriminant : « discriminant » au MCD, « clé primaire » au MLD / MPD", () => {
    const issue = toLogicalModel(model().entity("Client", ["nom"]).build()).issues.find((i) => i.severity === "error")!;
    expect(issueMessage(issue, "conceptual")).toBe(MSG.missingKeyConceptual("Client"));
    expect(issueMessage(issue, "logical")).toBe(MSG.missingKeyLogical("Client"));
  });

  it("aucun message de problème ne parle d'« identifiant »", () => {
    const doc = model()
      .entity("A", ["x", "x"])
      .entity("A", [])
      .entity("B", ["b*"])
      .entity("C", ["c*", "y"])
      .entity("D", [])
      .inherit("B", ["C", "D"])
      .build();
    const texts = toLogicalModel(doc).issues.flatMap((i) => [issueMessage(i, "conceptual"), issueMessage(i, "logical")]);
    expect(texts.length).toBeGreaterThan(4);
    expect(texts.filter((t) => /identifiant/i.test(t))).toEqual([]);
  });
});
