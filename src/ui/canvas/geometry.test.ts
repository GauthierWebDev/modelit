import {
  createAssociation,
  createAttribute,
  createEntity,
  createInheritance,
  createInheritanceLink,
} from "@core/index";
import { describe, expect, it } from "vitest";
import {
  alternateText,
  associationNamesByLink,
  attributeMarks,
  attributeStyle,
  BOLD_WEIGHT,
  center,
  clipToRect,
  INHERITANCE_SIZE,
  inheritanceGeometries,
  intersects,
  linkGeometries,
  type NodeLayout,
  nodeLayout,
  normalizeRect,
  pathOf,
  type Rect,
  ROW_HEIGHT,
  reflexiveBends,
  segmentMidpoints,
  snap,
  TITLE_HEIGHT,
  textWidth,
  triangleOf,
} from "./geometry";

const cross = (
  p: { x: number; y: number },
  q: { x: number; y: number },
  r: { x: number; y: number },
  s: { x: number; y: number },
) => {
  const o = (a: typeof p, b: typeof p, c: typeof p) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const d1 = o(r, s, p);
  const d2 = o(r, s, q);
  const d3 = o(p, q, r);
  const d4 = o(p, q, s);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
};

/** Tracé complet de la seconde patte : bord de l'association → cassures → bord de l'entité. */
const secondLeg = (entity: Rect, association: Rect, bends: { x: number; y: number }[]) => [
  clipToRect(association, bends[0]!),
  ...bends,
  clipToRect(entity, bends.at(-1)!),
];

describe("seconde patte d'une réflexive (overrides O-08, O-32)", () => {
  // Disposition signalée : phase_phase en bas à gauche de phase, la patte droite monte en diagonale.
  const phase: Rect = { x: 385, y: 1058, width: 155, height: 110 };
  const phasePhase: Rect = { x: 165, y: 1290, width: 135, height: 42 };

  it("ne croise pas la première patte (droite association–entité)", () => {
    const bends = reflexiveBends(phase, phasePhase, 10);
    const first = [clipToRect(phasePhase, center(phase)), clipToRect(phase, center(phasePhase))] as const;
    const path = secondLeg(phase, phasePhase, bends);
    expect(path.slice(1).some((p, i) => cross(path[i]!, p, first[0], first[1]))).toBe(false);
  });

  it("dans les quatre orientations", () => {
    for (const [dx, dy] of [
      [-1, 1],
      [1, 1],
      [-1, -1],
      [1, -1],
    ]) {
      const entity: Rect = { x: 500, y: 500, width: 150, height: 110 };
      const association: Rect = { x: 500 + dx! * 260, y: 500 + dy! * 230, width: 135, height: 42 };
      const bends = reflexiveBends(entity, association, 10);
      const first = [clipToRect(association, center(entity)), clipToRect(entity, center(association))] as const;
      const path = secondLeg(entity, association, bends);
      expect(path.slice(1).some((p, i) => cross(path[i]!, p, first[0], first[1]))).toBe(false);
    }
  });
});

describe("étiquette de rôle (O-38)", () => {
  // Cas signalé : patte 0,n de vo vers oeuvre, presque horizontale, rôle « originale ».
  const oeuvre: NodeLayout = { x: 530, y: 680, width: 90, height: 145, rows: [] };
  const vo: NodeLayout = { x: 232, y: 897, width: 80, height: 30, rows: [] };
  const layouts = new Map([
    ["oeuvre", oeuvre],
    ["vo", vo],
  ]);
  const link = {
    id: "l",
    associationId: "vo",
    entityId: "oeuvre",
    cardinality: { min: 0, max: "n" as const },
    relativeId: false,
    role: "originale",
    bends: [],
  };

  it("ni tronquée ni sur le bord de l'entité ou de l'association", () => {
    const [geometry] = linkGeometries([link], layouts);
    const role = geometry!.role!;
    const halfWidth = (textWidth("originale") * 11) / 13 / 2;
    const box = { x: role.x - halfWidth, y: role.y - 7, width: 2 * halfWidth, height: 14 };
    const overlaps = (r: Rect) =>
      box.x < r.x + r.width && box.x + box.width > r.x && box.y < r.y + r.height && box.y + box.height > r.y;
    expect(overlaps(oeuvre)).toBe(false);
    expect(overlaps(vo)).toBe(false);
  });

  it("dans les quatre directions", () => {
    for (const [dx, dy] of [
      [-300, 0],
      [300, 0],
      [0, -250],
      [0, 250],
      [-250, 200],
    ]) {
      const assoc: NodeLayout = { x: 500 + dx!, y: 700 + dy!, width: 80, height: 30, rows: [] };
      const [geometry] = linkGeometries(
        [link],
        new Map([
          ["oeuvre", oeuvre],
          ["vo", assoc],
        ]),
      );
      const role = geometry!.role!;
      const halfWidth = (textWidth("originale") * 11) / 13 / 2;
      const inside = (r: Rect) =>
        role.x + halfWidth > r.x &&
        role.x - halfWidth < r.x + r.width &&
        role.y + 7 > r.y &&
        role.y - 7 < r.y + r.height;
      expect(inside(oeuvre)).toBe(false);
      expect(inside(assoc)).toBe(false);
    }
  });
});

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

/** Le point est-il sur le bord du rectangle (à l'arrondi près) ? */
const onBorder = (p: { x: number; y: number }, r: Rect) => {
  const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;
  const inX = p.x >= r.x - 1e-6 && p.x <= r.x + r.width + 1e-6;
  const inY = p.y >= r.y - 1e-6 && p.y <= r.y + r.height + 1e-6;
  return (
    (inX && (near(p.y, r.y) || near(p.y, r.y + r.height))) || (inY && (near(p.x, r.x) || near(p.x, r.x + r.width)))
  );
};
const box = (x: number, y: number, width = 100, height = 40): NodeLayout => ({ x, y, width, height, rows: [] });

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

describe("triangle d'héritage (O-27)", () => {
  it("toujours droit, pointe en haut ; base horizontale sous la pointe", () => {
    const t = triangleOf({ x: 100, y: 200, ...INHERITANCE_SIZE });
    const c = center({ x: 100, y: 200, ...INHERITANCE_SIZE });
    expect(t.apex.x).toBe(c.x);
    expect(t.base.x).toBe(c.x);
    expect(t.apex.y).toBeLessThan(t.base.y);
    const [apex, left, right] = t.corners;
    expect(apex).toEqual(t.apex);
    expect(left.y).toBe(right.y);
    expect(left.y).toBe(t.base.y);
    expect((left.x + right.x) / 2).toBe(c.x);
  });

  it("lien vers l'entité générique depuis la pointe, vers une spécialisée depuis la base, jusqu'au bord de l'entité", () => {
    const parent = createEntity("Personne");
    const child = createEntity("Salarié");
    const h = { ...createInheritance(), parentId: parent.id };
    const toParent = createInheritanceLink(h.id, parent.id);
    const toChild = createInheritanceLink(h.id, child.id);
    const layouts = new Map([
      [h.id, { x: 200, y: 200, ...INHERITANCE_SIZE, rows: [] }],
      [parent.id, box(180, 50)],
      [child.id, box(180, 400)],
    ]);
    const { triangles, links } = inheritanceGeometries([h], [toParent, toChild], layouts);
    const triangle = triangles.get(h.id)!;
    const up = links.find((l) => l.link.id === toParent.id)!;
    const down = links.find((l) => l.link.id === toChild.id)!;
    expect(up.toParent).toBe(true);
    expect(up.points[0]).toEqual(triangle.apex);
    expect(onBorder(up.points.at(-1)!, layouts.get(parent.id)!)).toBe(true);
    expect(down.toParent).toBe(false);
    expect(down.points[0]).toEqual(triangle.base);
    expect(onBorder(down.points.at(-1)!, layouts.get(child.id)!)).toBe(true);
  });

  it("un lien suit ses cassures ; un lien sans objet placé est ignoré", () => {
    const parent = createEntity("Personne");
    const h = { ...createInheritance(), parentId: parent.id };
    const link = createInheritanceLink(h.id, parent.id);
    const orphan = createInheritanceLink(h.id, "absente");
    const layouts = new Map([
      [h.id, { x: 200, y: 200, ...INHERITANCE_SIZE, rows: [] }],
      [parent.id, box(500, 50)],
    ]);
    const bend = { x: 400, y: 100 };
    const { links } = inheritanceGeometries([h], [link, orphan], layouts, { [link.id]: [bend] });
    expect(links).toHaveLength(1);
    expect(links[0]!.bends).toEqual([bend]);
    expect(links[0]!.points[1]).toEqual(bend);
  });
});

describe("pattes et cassures (O-10)", () => {
  const association = createAssociation("Passer");
  const entity = createEntity("Client");
  const layouts = new Map([
    [association.id, box(0, 0)],
    [entity.id, box(400, 300)],
  ]);
  const link = {
    id: "l1",
    associationId: association.id,
    entityId: entity.id,
    cardinality: { min: 0, max: "n" as const },
    relativeId: false,
  };

  it("sans cassure : un segment du bord de l'association au bord de l'entité", () => {
    const [g] = linkGeometries([link], layouts);
    expect(g!.points).toHaveLength(2);
    expect(onBorder(g!.points[0]!, layouts.get(association.id)!)).toBe(true);
    expect(onBorder(g!.points[1]!, layouts.get(entity.id)!)).toBe(true);
  });

  it("avec cassures : le trait passe par chacune, dans l'ordre", () => {
    const bends = [
      { x: 300, y: 20 },
      { x: 450, y: 150 },
    ];
    const [g] = linkGeometries([link], layouts, { l1: bends });
    expect(g!.bends).toEqual(bends);
    expect(g!.points.slice(1, -1)).toEqual(bends);
    expect(onBorder(g!.points[0]!, layouts.get(association.id)!)).toBe(true);
    expect(onBorder(g!.points.at(-1)!, layouts.get(entity.id)!)).toBe(true);
  });

  it("plusieurs pattes droites entre les mêmes objets (réflexive) : décalées, jamais superposées", () => {
    const second = { ...link, id: "l2" };
    const [a, b] = linkGeometries([link, second], layouts);
    expect(a!.points).not.toEqual(b!.points);
  });

  it("un milieu de segment par segment, index d'insertion de la nouvelle cassure", () => {
    const points = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 20 },
    ];
    expect(segmentMidpoints(points)).toEqual([
      { index: 0, point: { x: 5, y: 0 } },
      { index: 1, point: { x: 10, y: 10 } },
    ]);
  });
});

describe("tracé SVG d'une ligne brisée (O-21 « Lisser les cassures »)", () => {
  const points = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 20 },
  ];

  it("non lissé : segments droits par tous les points", () => {
    expect(pathOf(points, false)).toBe("M0,0 L10,0 L10,20");
  });

  it("lissé : courbe passant par les milieux, de la première à la dernière extrémité", () => {
    const d = pathOf(points, true);
    expect(d.startsWith("M0,0")).toBe(true);
    expect(d.endsWith("L10,20")).toBe(true);
    expect(d).toContain("Q10,0 10,10");
  });

  it("un segment seul reste droit, même lissé ; aucun point : tracé vide", () => {
    expect(pathOf(points.slice(0, 2), true)).toBe("M0,0 L10,0");
    expect(pathOf([], true)).toBe("");
  });
});

describe("grille et rectangle de sélection", () => {
  it("grille magnétique : valeur arrondie au pas ; sans grille, inchangée", () => {
    expect(snap(14, 10)).toBe(10);
    expect(snap(16, 10)).toBe(20);
    expect(snap(-16, 10)).toBe(-20);
    expect(snap(13.7, null)).toBe(13.7);
  });

  it("rectangle tracé dans n'importe quel sens : même rectangle", () => {
    const expected = { x: 10, y: 20, width: 30, height: 40 };
    expect(normalizeRect({ x: 10, y: 20 }, { x: 40, y: 60 })).toEqual(expected);
    expect(normalizeRect({ x: 40, y: 60 }, { x: 10, y: 20 })).toEqual(expected);
    expect(normalizeRect({ x: 40, y: 20 }, { x: 10, y: 60 })).toEqual(expected);
  });

  it("un rectangle sélectionne ce qu'il touche (O-57) : chevauchement ou inclusion", () => {
    const table = { x: 100, y: 100, width: 50, height: 50 };
    expect(intersects({ x: 140, y: 140, width: 50, height: 50 }, table)).toBe(true);
    expect(intersects({ x: 0, y: 0, width: 500, height: 500 }, table)).toBe(true);
    expect(intersects({ x: 110, y: 110, width: 5, height: 5 }, table)).toBe(true);
    expect(intersects({ x: 200, y: 200, width: 10, height: 10 }, table)).toBe(false);
    // Caractérisation : un bord commun seul ne compte pas.
    expect(intersects({ x: 150, y: 100, width: 10, height: 10 }, table)).toBe(false);
  });
});
