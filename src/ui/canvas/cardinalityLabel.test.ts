import { describe, expect, it } from "vitest";
import { linkGeometries, type NodeLayout, type Rect, textWidth } from "./geometry";

const box = (x: number, y: number, width: number, height: number): NodeLayout => ({ x, y, width, height, rows: [] });

/** Géométrie de la patte association → entité, cardinalité 0,n. */
function legOf(association: NodeLayout, entity: NodeLayout) {
  const link = {
    id: "l",
    associationId: "a",
    entityId: "e",
    cardinality: { min: 0, max: "n" as const },
    relativeId: false,
    bends: [],
  };
  const layouts = new Map([
    ["a", association],
    ["e", entity],
  ]);
  return linkGeometries([link], layouts)[0]!;
}

/** Le texte « 0,n » centré sur `label` (13 px, halo de 2 px) touche-t-il le rectangle ? */
const covers = (label: { x: number; y: number }, r: Rect) => {
  const halfWidth = textWidth("0,n") / 2 + 2;
  const halfHeight = 7 + 2;
  return (
    label.x + halfWidth > r.x &&
    label.x - halfWidth < r.x + r.width &&
    label.y + halfHeight > r.y &&
    label.y - halfHeight < r.y + r.height
  );
};

/** Cas signalés (captures du 2026-10-22) : patte arrivant en biais près d'un coin ou d'un bord. */
const reported: [string, NodeLayout, NodeLayout][] = [
  ["Compétence professionnelle (bord haut, près du coin gauche)", box(322, 56, 143, 50), box(978, 251, 332, 76)],
  ["Unité d'enseignement (bord bas)", box(378, 739, 148, 50), box(57, 572, 272, 76)],
  ["Bloc de compétences (bord bas)", box(1340, 920, 148, 50), box(1033, 753, 268, 76)],
  ["Titre RNCP (bord bas)", box(1340, 1269, 144, 50), box(1131, 1116, 173, 76)],
];

describe("cardinalité d'une patte (O-61)", () => {
  for (const [name, association, entity] of reported) {
    it(`jamais recouverte par l'entité ni l'association : ${name}`, () => {
      const { label } = legOf(association, entity);
      expect(covers(label, entity)).toBe(false);
      expect(covers(label, association)).toBe(false);
    });
  }

  it("déjà dégagée : position inchangée (22 px en arrière le long du trait, 12 px de côté)", () => {
    // Patte verticale arrivant au milieu du bord haut de l'entité.
    const association = box(150, 0, 100, 40);
    const entity = box(100, 300, 200, 80);
    const { points, label } = legOf(association, entity);
    const to = points.at(-1)!;
    expect(to).toEqual({ x: 200, y: 300 });
    expect(label).toEqual({ x: 200 - 12, y: 300 - 22 });
  });
});
