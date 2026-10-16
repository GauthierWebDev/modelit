import { describe, expect, it } from "vitest";
import { alignBoxes, type Box, distributeBoxes } from "./arrange";

const box = (id: string, x: number, y: number, width = 100, height = 50): Box => ({ id, x, y, width, height });
const apply = (boxes: Box[], offsets: Map<string, { x: number; y: number }>) =>
  boxes.map((b) => ({ ...b, x: b.x + (offsets.get(b.id)?.x ?? 0), y: b.y + (offsets.get(b.id)?.y ?? 0) }));

/** Aligner et répartir (override O-57). */
describe("aligner", () => {
  const boxes = [box("a", 0, 0, 100, 40), box("b", 50, 100, 200, 60), box("c", 30, 300, 80, 20)];

  it("bords extrêmes de la sélection", () => {
    expect(apply(boxes, alignBoxes(boxes, "left")).map((b) => b.x)).toEqual([0, 0, 0]);
    expect(apply(boxes, alignBoxes(boxes, "right")).map((b) => b.x + b.width)).toEqual([250, 250, 250]);
    expect(apply(boxes, alignBoxes(boxes, "top")).map((b) => b.y)).toEqual([0, 0, 0]);
    expect(apply(boxes, alignBoxes(boxes, "bottom")).map((b) => b.y + b.height)).toEqual([320, 320, 320]);
  });

  it("centre de l'emprise, sans toucher l'autre axe", () => {
    const centered = apply(boxes, alignBoxes(boxes, "center"));
    expect(centered.map((b) => b.x + b.width / 2)).toEqual([125, 125, 125]);
    expect(centered.map((b) => b.y)).toEqual([0, 100, 300]);
    expect(apply(boxes, alignBoxes(boxes, "middle")).map((b) => b.y + b.height / 2)).toEqual([160, 160, 160]);
  });

  it("un seul objet : rien", () => {
    expect(alignBoxes([box("a", 3, 4)], "left").size).toBe(0);
  });
});

describe("répartir", () => {
  it("même espace entre voisins, extrêmes immobiles, ordre gardé", () => {
    const boxes = [box("c", 500, 0, 100), box("a", 0, 10, 100), box("b", 120, 20, 60), box("d", 300, 0, 40)];
    const result = apply(boxes, distributeBoxes(boxes, "horizontal"));
    const byX = [...result].sort((p, q) => p.x - q.x);
    expect(byX.map((b) => b.id)).toEqual(["a", "b", "d", "c"]);
    expect(result.find((b) => b.id === "a")!.x).toBe(0);
    expect(result.find((b) => b.id === "c")!.x).toBe(500);
    const gaps = byX.slice(1).map((b, i) => b.x - (byX[i]!.x + byX[i]!.width));
    expect(new Set(gaps.map((g) => Math.round(g * 1000)))).toEqual(new Set([Math.round(gaps[0]! * 1000)]));
    expect(result.map((b) => b.y)).toEqual([0, 10, 20, 0]);
  });

  it("verticalement ; moins de trois objets : rien", () => {
    const boxes = [box("a", 0, 0, 10, 10), box("b", 0, 15, 10, 10), box("c", 0, 100, 10, 10)];
    expect(apply(boxes, distributeBoxes(boxes, "vertical")).map((b) => b.y)).toEqual([0, 50, 100]);
    expect(distributeBoxes(boxes.slice(0, 2), "vertical").size).toBe(0);
  });
});
