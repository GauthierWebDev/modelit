import { describe, expect, it } from "vitest";
import { alternateText, associationNamesByLink, attributeMarks, center, clipToRect, linkGeometries, reflexiveBends, textWidth, type NodeLayout, type Rect } from "./geometry";

const cross = (p: { x: number; y: number }, q: { x: number; y: number }, r: { x: number; y: number }, s: { x: number; y: number }) => {
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
    for (const [dx, dy] of [[-1, 1], [1, 1], [-1, -1], [1, -1]]) {
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
  const layouts = new Map([["oeuvre", oeuvre], ["vo", vo]]);
  const link = { id: "l", associationId: "vo", entityId: "oeuvre", cardinality: { min: 0, max: "n" as const }, relativeId: false, role: "originale", bends: [] };

  it("ni tronquée ni sur le bord de l'entité ou de l'association", () => {
    const [geometry] = linkGeometries([link], layouts);
    const role = geometry!.role!;
    const halfWidth = (textWidth("originale") * 11) / 13 / 2;
    const box = { x: role.x - halfWidth, y: role.y - 7, width: 2 * halfWidth, height: 14 };
    const overlaps = (r: Rect) => box.x < r.x + r.width && box.x + box.width > r.x && box.y < r.y + r.height && box.y + box.height > r.y;
    expect(overlaps(oeuvre)).toBe(false);
    expect(overlaps(vo)).toBe(false);
  });

  it("dans les quatre directions", () => {
    for (const [dx, dy] of [[-300, 0], [300, 0], [0, -250], [0, 250], [-250, 200]]) {
      const assoc: NodeLayout = { x: 500 + dx!, y: 700 + dy!, width: 80, height: 30, rows: [] };
      const [geometry] = linkGeometries([link], new Map([["oeuvre", oeuvre], ["vo", assoc]]));
      const role = geometry!.role!;
      const halfWidth = (textWidth("originale") * 11) / 13 / 2;
      const inside = (r: Rect) => role.x + halfWidth > r.x && role.x - halfWidth < r.x + r.width && role.y + 7 > r.y && role.y - 7 < r.y + r.height;
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
    expect(attributeMarks(patient, linkNames).get(patient.attributes.find((a) => a.name === "nir")!.id)!.bold).toBe(true);
  });

  it("unicité conditionnelle (siege … annule = 0) : pas d'identifiant alternatif, donc pas de marque AI (O-42)", async () => {
    const { readFileSync } = await import("node:fs");
    const { reverseEngineer } = await import("@core/reverse/build");
    const { emptyDocument } = await import("@core/model/factory");
    const { doc } = reverseEngineer(readFileSync("fixtures/aero_sqlserver.sql", "utf8"), emptyDocument());
    const reservation = doc.associations.find((a) => a.name === "reservation")!;
    const mark = attributeMarks(reservation, associationNamesByLink(doc)).get(reservation.attributes.find((a) => a.name === "siege")!.id)!;
    expect(mark.alternate).toBeUndefined();
  });
});
