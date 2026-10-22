import { createAssociation, createAttribute, createEntity, createInheritance } from "@core/index";
import { describe, expect, it } from "vitest";
import {
  alternateText,
  associationNamesByLink,
  attributeMarks,
  attributeStyle,
  BOLD_WEIGHT,
  INHERITANCE_SIZE,
  nodeLayout,
  ROW_HEIGHT,
  TITLE_HEIGHT,
} from "./geometry";

/** Marques des rubriques (O-36, O-39), encombrement des objets et style des rubriques dans le MCD. */

describe("marques des identifiants alternatifs (O-39)", () => {
  it("relatif à une association (« AI par parent »), sur expression (« AI = LOWER(email) »)", async () => {
    const { readFileSync } = await import("node:fs");
    const { reverseEngineer } = await import("@core/reverse/build");
    const { emptyDocument } = await import("@core/model/factory");
    const { doc } = reverseEngineer(readFileSync("fixtures/hopital_oracle.sql", "utf8"), emptyDocument());
    const linkNames = associationNamesByLink(doc);
    const text = (entity: string, attribute: string) => {
      const node = doc.entities.find((e) => e.name === entity)!;
      const mark = attributeMarks(node, linkNames).get(node.attributes.find((a) => a.name === attribute)!.id)!;
      return mark.alternate && alternateText(mark.alternate);
    };
    expect(text("service", "libelle")).toBe("AI par parent");
    expect(text("Personnel", "email")).toBe("AI = LOWER(email)");
    // Rubrique unique à elle seule : en gras, sans marque AI.
    expect(text("Patient", "nir")).toBeUndefined();
    const patient = doc.entities.find((e) => e.name === "Patient")!;
    expect(attributeMarks(patient, linkNames).get(patient.attributes.find((a) => a.name === "nir")!.id)!.bold).toBe(
      true,
    );
  });

  it("unicité conditionnelle (siege … annule = 0) : pas d'identifiant alternatif, donc pas de marque AI (O-42)", async () => {
    const { readFileSync } = await import("node:fs");
    const { reverseEngineer } = await import("@core/reverse/build");
    const { emptyDocument } = await import("@core/model/factory");
    const { doc } = reverseEngineer(readFileSync("fixtures/aero_sqlserver.sql", "utf8"), emptyDocument());
    const reservation = doc.associations.find((a) => a.name === "reservation")!;
    const mark = attributeMarks(reservation, associationNamesByLink(doc)).get(
      reservation.attributes.find((a) => a.name === "siege")!.id,
    )!;
    expect(mark.alternate).toBeUndefined();
  });
});

describe("encombrement d'un objet (nodeLayout)", () => {
  const display = { showAttributes: true };

  it("placé à sa position (coin haut-gauche)", () => {
    const l = nodeLayout(createEntity("Client"), { x: 30, y: 40 }, display);
    expect([l.x, l.y]).toEqual([30, 40]);
  });

  it("une ligne par rubrique sous le titre, hauteur qui suit le nombre de rubriques", () => {
    const entity = createEntity("Client");
    entity.attributes = [createAttribute("code"), createAttribute("nom"), createAttribute("ville")];
    const l = nodeLayout(entity, { x: 0, y: 0 }, display);
    expect(l.rows.map((r) => r.attribute.name)).toEqual(["code", "nom", "ville"]);
    expect(l.rows.map((r) => r.y)).toEqual([0, 1, 2].map((i) => TITLE_HEIGHT + 4 + i * ROW_HEIGHT));
    const one = createEntity("Client");
    one.attributes = [createAttribute("code")];
    expect(l.height - nodeLayout(one, { x: 0, y: 0 }, display).height).toBe(2 * ROW_HEIGHT);
  });

  it("rubriques masquées (option d'affichage) : aucune ligne", () => {
    const entity = createEntity("Client");
    entity.attributes = [createAttribute("code"), createAttribute("nom")];
    const hidden = nodeLayout(entity, { x: 0, y: 0 }, { showAttributes: false });
    expect(hidden.rows).toEqual([]);
    expect(hidden.height).toBeLessThan(nodeLayout(entity, { x: 0, y: 0 }, display).height);
  });

  it("largeur entière, élargie par un nom long (jamais réduite sous le minimum)", () => {
    const short = nodeLayout(createEntity("A"), { x: 0, y: 0 }, display);
    const long = nodeLayout(createEntity("Une entité au nom vraiment très long"), { x: 0, y: 0 }, display);
    expect(Number.isInteger(short.width) && Number.isInteger(long.width)).toBe(true);
    expect(long.width).toBeGreaterThan(short.width);
    // Caractérisation : largeur minimale d'une entité, plus large que celle d'une association.
    expect(short.width).toBe(110);
    expect(nodeLayout(createAssociation("A"), { x: 0, y: 0 }, display).width).toBe(100);
  });

  it("héritage : triangle d'encombrement fixe, sans rubriques", () => {
    const l = nodeLayout(createInheritance(), { x: 5, y: 6 }, display);
    expect(l).toEqual({ x: 5, y: 6, ...INHERITANCE_SIZE, rows: [] });
  });
});

describe("style d'une rubrique", () => {
  it("gras pour un discriminant ou une rubrique unique, italique pour une donnée calculée", () => {
    expect(attributeStyle({ label: "code", derived: false, bold: true })).toEqual({
      weight: BOLD_WEIGHT,
      italic: false,
    });
    expect(attributeStyle({ label: "/total", derived: true, bold: false })).toEqual({ weight: 400, italic: true });
  });
});
