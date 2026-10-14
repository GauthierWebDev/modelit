import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { toLogicalModel } from "../mld/transform";
import { emptyDocument } from "../model/factory";
import { reverseEngineer } from "./build";

/** Itération 5 (override O-36) : MCD reconstruit à partir de la fixture médiathèque. */

const SOURCE = readFileSync("fixtures/mediatheque_mysql.sql", "utf8");
const { doc } = reverseEngineer(SOURCE, emptyDocument());
const entity = (name: string) => doc.entities.find((e) => e.name === name)!;
const association = (name: string) => doc.associations.find((a) => a.name === name);
const legs = (name: string) =>
  doc.links
    .filter((l) => l.associationId === association(name)?.id)
    .map((l) => ({ entity: doc.entities.find((e) => e.id === l.entityId)!.name, cardinality: `${l.cardinality.min},${l.cardinality.max}`, role: l.role }));

describe("MCD de la médiathèque (O-36)", () => {
  it("1. adherent_premium : entité spécialisée d'adherent (plus une 1:1 à identifiant relatif)", () => {
    expect(doc.inheritances).toHaveLength(1);
    const inheritance = doc.inheritances[0]!;
    expect(inheritance.parentId).toBe(entity("adherent").id);
    const child = doc.inheritanceLinks.find((l) => l.inheritanceId === inheritance.id && l.entityId === entity("adherent_premium").id)!;
    expect(child).toMatchObject({ foreignKeyConstraintName: "fk_premium_adherent", onDelete: "cascade", onUpdate: "cascade" });
    expect(Object.values(child.foreignKeyNames ?? {})).toEqual(["adherent_id"]);
    // MLD inchangé : adherent_premium = (#adherent_id, …)
    const table = toLogicalModel(doc).tables.find((t) => t.name === "adherent_premium")!;
    expect(table.primaryKey).toEqual(["adherent_id"]);
    expect(table.foreignKeys.find((fk) => fk.referencedTable === "adherent")).toMatchObject({ columns: ["adherent_id"], referencedColumns: ["id"] });
  });

  it("2. noms : contrainte, puis colonne, sauf s'ils se réduisent à une table reliée ou à son abréviation (O-37)", () => {
    expect(doc.associations.map((a) => a.name).sort()).toEqual(
      ["favori", "reco", "vo", "parrain", "emprunt_Exemplaire", "emprunt_adherent", "Exemplaire_oeuvre"].sort(),
    );
  });

  it("3. rôles des réflexives : occurrence référencée, sur la patte 0,n ; patte 0,1 sans rôle (O-37)", () => {
    expect(legs("parrain")).toEqual(
      expect.arrayContaining([
        { entity: "adherent", cardinality: "0,n", role: "parrain" },
        { entity: "adherent", cardinality: "0,1", role: undefined },
      ]),
    );
    expect(legs("vo")).toEqual(
      expect.arrayContaining([
        { entity: "oeuvre", cardinality: "0,n", role: "originale" },
        { entity: "oeuvre", cardinality: "0,1", role: undefined },
      ]),
    );
  });

  it("4. identifiants alternatifs : isbn, num_carte, code_barre, email(100) sur préfixe ; vo → isbn", () => {
    const attr = (e: string, a: string) => entity(e).attributes.find((x) => x.name === a)!;
    expect(attr("oeuvre", "isbn").unique).toBe(true);
    expect(attr("adherent", "num_carte").unique).toBe(true);
    expect(attr("Exemplaire", "code_barre").unique).toBe(true);
    expect(attr("adherent", "email").unique).toBe(false);
    expect(entity("adherent").alternateKeys).toContainEqual(expect.objectContaining({ name: "uq_email_prefixe", prefixes: [100] }));
    const vo = doc.links.find((l) => l.associationId === association("vo")!.id && l.referencedAttributes);
    expect(vo?.referencedAttributes).toEqual([attr("oeuvre", "isbn").id]);
  });

  it("5. données calculées : prix_ttc, date_retour_prevue", () => {
    expect(entity("oeuvre").attributes.find((a) => a.name === "prix_ttc")!.generated).toMatchObject({ stored: true });
    expect(entity("emprunt").attributes.find((a) => a.name === "date_retour_prevue")!.generated).toMatchObject({ stored: false });
  });

  it("6. avertissements : REFERENCES en ligne (parrain), SET (centres_interet), JSON (details), préfixe", () => {
    const warnings = toLogicalModel(doc).issues.filter((i) => i.severity === "warning");
    const on = (id: string) => warnings.filter((w) => w.target?.id === id).map((w) => w.message);
    expect(on(association("parrain")!.id)).toEqual([expect.stringContaining("en ligne")]);
    expect(on(entity("adherent").id)).toEqual(expect.arrayContaining([expect.stringContaining("centres_interet"), expect.stringContaining("email(100)")]));
    expect(on(entity("emprunt").id)).toEqual([expect.stringContaining("details")]);
    expect(toLogicalModel(doc).issues.filter((i) => i.severity === "error")).toEqual([]);
  });

  it("laboratoire : rôles mentor et precedente sur les pattes 0,n ; « labo » écarté (abréviation de Laboratoire)", () => {
    const labo = reverseEngineer(readFileSync("fixtures/labo_sqlite.sql", "utf8"), emptyDocument()).doc;
    const names = labo.associations.map((a) => a.name);
    expect(names).toEqual(expect.arrayContaining(["mentor", "resp", "coresp", "directeur", "phase_phase", "chercheur_Laboratoire", "projet_Laboratoire"]));
    expect(names).not.toContain("labo");
    const roles = labo.links.filter((l) => l.role);
    expect(roles.map((l) => l.role).sort()).toEqual(["mentor", "precedente"]);
    expect(roles.every((l) => l.cardinality.max === "n")).toBe(true);
    expect(labo.inheritances).toEqual([]);
  });
});

describe("MCD de l'hôpital (O-39)", () => {
  const { doc: hopital } = reverseEngineer(readFileSync("fixtures/hopital_oracle.sql", "utf8"), emptyDocument());
  const names = hopital.associations.map((a) => a.name);
  const links = (name: string) =>
    hopital.links
      .filter((l) => l.associationId === hopital.associations.find((a) => a.name === name)?.id)
      .map((l) => ({ entity: hopital.entities.find((e) => e.id === l.entityId)!.name, cardinality: `${l.cardinality.min},${l.cardinality.max}`, role: l.role }));
  const issues = toLogicalModel(hopital).issues.map((i) => i.message);

  it("17. nommage : pas de règle b) quand la colonne porte le nom de la colonne référencée ; repli table_table", () => {
    expect(names.sort()).toEqual(
      ["chef", "parent", "Personnel_service", "medecin", "sejour_Patient", "sejour_service", "intervenir_sejour", "intervenir_Personnel", "superviseur"].sort(),
    );
  });

  it("17. rôle de la réflexive : « parent » (colonne sans le nom de table), sur la patte 0,n", () => {
    expect(links("parent")).toEqual(
      expect.arrayContaining([
        { entity: "service", cardinality: "0,n", role: "parent" },
        { entity: "service", cardinality: "0,1", role: undefined },
      ]),
    );
  });

  it("6. association 0,1 / 0,1 « chef » : la patte de service porte la clé d'origine", () => {
    const service = hopital.entities.find((e) => e.name === "service")!;
    const chef = hopital.links.filter((l) => l.associationId === hopital.associations.find((a) => a.name === "chef")!.id);
    expect(chef.map((l) => `${l.cardinality.min},${l.cardinality.max}`)).toEqual(["0,1", "0,1"]);
    expect(chef.find((l) => l.foreignKeyHolder)!.entityId).toBe(service.id);
    expect(chef.find((l) => l.foreignKeyHolder)!.foreignKeyState).toEqual({ deferrable: "deferred", dialect: "oracle" });
  });

  it("15 / 16. identifiants alternatifs : relatif à l'association (uq_service_libelle), sur expression (LOWER(email))", () => {
    const service = hopital.entities.find((e) => e.name === "service")!;
    const libelle = service.alternateKeys!.find((k) => k.name === "uq_service_libelle")!;
    expect(libelle.members).toEqual([expect.objectContaining({ linkId: expect.any(String) }), { attributeId: service.attributes.find((a) => a.name === "libelle")!.id }]);
    expect(libelle.nulls).toBe("oracle");
    const personnel = hopital.entities.find((e) => e.name === "Personnel")!;
    expect(personnel.alternateKeys).toEqual([expect.objectContaining({ name: "ux_personnel_email", expression: { expression: "LOWER(email)", dialect: "oracle" } })]);
    expect(personnel.attributes.find((a) => a.name === "email")!.unique).toBe(false);
  });

  it("18. avertissements : DISABLE, NOVALIDATE, unicité conditionnelle, partitionnement", () => {
    expect(issues).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/« intervenir » : contrainte ck_intervenir_cout désactivée/),
        expect.stringMatching(/« intervenir » : contrainte ck_intervenir_super non validée/),
        expect.stringMatching(/« sejour » : unicité conditionnelle \(patient_id \(sejour_Patient\)\), seulement si date_sortie IS NULL/),
        expect.stringMatching(/« sejour » : table partitionnée/),
      ]),
    );
  });
});
