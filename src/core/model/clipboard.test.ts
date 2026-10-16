import { describe, expect, it } from "vitest";
import { toLogicalModel } from "../mld/transform";
import { model } from "../testing/builder";
import { extractFragment, freeName, parseFragment, pasteFragment } from "./clipboard";
import type { ModelDocument } from "./document";

const shop = () =>
  model()
    .entity("CLIENT", ["id_client*", "nom"])
    .entity("COMMANDE", ["id_commande*", "date"])
    .association("PASSER", ["CLIENT 0,n", "COMMANDE 1,1"])
    .build();

const idOf = (doc: ModelDocument, name: string) => [...doc.entities, ...doc.associations].find((n) => n.name === name)!.id;
const roundTrip = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/** Copier, couper, coller, dupliquer (override O-52). */
describe("copier / coller", () => {
  it("copie une entité : nouveaux identifiants, nom libre, rubriques gardées", () => {
    const doc = shop();
    const fragment = extractFragment(doc, [idOf(doc, "CLIENT")])!;
    const pasted = pasteFragment(doc, fragment);
    expect(pasted).toHaveLength(1);
    const copy = doc.entities.find((e) => e.id === pasted[0])!;
    expect(copy.name).toBe("CLIENT_2");
    expect(copy.attributes.map((a) => a.name)).toEqual(["id_client", "nom"]);
    const original = doc.entities.find((e) => e.name === "CLIENT")!;
    expect(copy.id).not.toBe(original.id);
    expect(copy.attributes.map((a) => a.id)).not.toContain(original.attributes[0]!.id);
  });

  it("noms : premier numéro libre, sans empiler les suffixes", () => {
    const taken = new Set(["CLIENT", "CLIENT_2"]);
    expect(freeName("CLIENT", taken)).toBe("CLIENT_3");
    expect(freeName("CLIENT_2", taken)).toBe("CLIENT_4");
    expect(freeName("Code_2020", new Set(["Code_2020"]))).toBe("Code_2020_2");
    expect(freeName("LIVRE", taken)).toBe("LIVRE");
  });

  it("association copiée avec ses entités : pattes rattachées aux copies", () => {
    const doc = shop();
    const fragment = extractFragment(doc, ["CLIENT", "COMMANDE", "PASSER"].map((n) => idOf(doc, n)))!;
    const pasted = new Set(pasteFragment(doc, fragment));
    const legs = doc.links.filter((l) => pasted.has(l.associationId));
    expect(legs).toHaveLength(2);
    expect(legs.every((l) => pasted.has(l.entityId))).toBe(true);
    expect(toLogicalModel(doc).tables.map((t) => t.name).sort()).toEqual(["CLIENT", "CLIENT_2", "COMMANDE", "COMMANDE_2"]);
  });

  it("association seule : pattes rattachées aux entités d'origine si elles existent", () => {
    const doc = shop();
    const fragment = extractFragment(doc, [idOf(doc, "PASSER")])!;
    const [copy] = pasteFragment(doc, fragment);
    const legs = doc.links.filter((l) => l.associationId === copy);
    expect(legs.map((l) => l.entityId).sort()).toEqual([idOf(doc, "CLIENT"), idOf(doc, "COMMANDE")].sort());
    expect(legs.find((l) => l.entityId === idOf(doc, "COMMANDE"))!.cardinality).toEqual({ min: 1, max: 1 });
  });

  it("dans un autre document : pattes vers une entité absente abandonnées, positions gardées", () => {
    const source = shop();
    source.layout.positions[idOf(source, "PASSER")] = { x: 300, y: 120 };
    const fragment = roundTrip(extractFragment(source, [idOf(source, "PASSER")])!);
    const target = model().entity("CLIENT", ["id_client*"]).build();
    const [copy] = pasteFragment(target, parseFragment(JSON.stringify(fragment))!);
    expect(target.associations.find((a) => a.id === copy)!.name).toBe("PASSER");
    expect(target.links).toHaveLength(0);
    expect(target.layout.positions[copy!]).toEqual({ x: 300, y: 120 });
  });

  it("dans le même document : décalage de deux pas de grille, puis encore à chaque collage", () => {
    const doc = shop();
    const client = idOf(doc, "CLIENT");
    doc.layout.positions[client] = { x: 100, y: 100 };
    const fragment = extractFragment(doc, [client])!;
    const [first] = pasteFragment(doc, fragment);
    const [second] = pasteFragment(doc, fragment);
    const step = 2 * doc.settings.grid.size;
    expect(doc.layout.positions[first!]).toEqual({ x: 100 + step, y: 100 + step });
    expect(doc.layout.positions[second!]).toEqual({ x: 100 + 2 * step, y: 100 + 2 * step });
  });

  it("héritage copié avec ses entités ; trait ou patte seuls ignorés", () => {
    const doc = model().entity("PERSONNE", ["id*"]).entity("ELEVE").entity("PROF").inherit("PERSONNE", ["ELEVE", "PROF"]).build();
    const h = doc.inheritances[0]!;
    const fragment = extractFragment(doc, [h.id, ...["PERSONNE", "ELEVE"].map((n) => idOf(doc, n))])!;
    const pasted = new Set(pasteFragment(doc, fragment));
    const copy = doc.inheritances.find((x) => pasted.has(x.id))!;
    expect(pasted.has(copy.parentId!)).toBe(true);
    // PROF non copié mais présent : son lien est rattaché à l'original.
    expect(doc.inheritanceLinks.filter((l) => l.inheritanceId === copy.id)).toHaveLength(3);
    expect(extractFragment(doc, [doc.links[0]?.id ?? "aucun"])).toBeNull();
  });

  it("noms de contraintes retirés de la copie (script sans doublon)", () => {
    const doc = shop();
    const client = doc.entities.find((e) => e.name === "CLIENT")!;
    client.primaryKeyName = "pk_client";
    client.indexes = [{ name: "ix_nom", members: [{ attributeId: client.attributes[1]!.id }] }];
    const [copyId] = pasteFragment(doc, extractFragment(doc, [client.id])!);
    const copy = doc.entities.find((e) => e.id === copyId)!;
    expect(copy.primaryKeyName).toBeUndefined();
    expect(copy.indexes).toEqual([{ members: [{ attributeId: copy.attributes[1]!.id }] }]);
  });

  it("contenu étranger : ignoré", () => {
    expect(parseFragment("bonjour")).toBeNull();
    expect(parseFragment(JSON.stringify({ format: "autre" }))).toBeNull();
  });
});
