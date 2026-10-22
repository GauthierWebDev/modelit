import type { Rect } from "@core/index";
import { describe, expect, it, vi } from "vitest";
import { DRAG_THRESHOLD, isDrag, marqueeSelection, showConnection } from "./sharedGestures";

const box = (x: number, y: number): Rect => ({ x, y, width: 100, height: 40 });

/** Gestes communs au MCD et au MLD / MPD (audit A-01, U-5). */
describe("gestes communs des canevas", () => {
  it("glisser : au-delà du seuil seulement", () => {
    expect(isDrag({ x: 0, y: 0 }, { x: DRAG_THRESHOLD, y: 0 })).toBe(false);
    expect(isDrag({ x: 0, y: 0 }, { x: 3, y: 3 })).toBe(true);
  });

  it("rectangle de sélection : objets touchés, sélection conservée, sans doublon, dans tous les sens", () => {
    const boxes: [string, Rect][] = [
      ["a", box(0, 0)],
      ["b", box(200, 0)],
      ["c", box(0, 200)],
    ];
    expect(marqueeSelection({ x: 250, y: 60 }, { x: 50, y: 20 }, boxes, [])).toEqual(["a", "b"]);
    expect(marqueeSelection({ x: 10, y: 210 }, { x: 20, y: 220 }, boxes, ["a", "c"])).toEqual(["a", "c"]);
  });

  it("outil Lien : erreur annoncée, ou objet créé sélectionné ; rien à faire sinon", () => {
    const ui = { notify: vi.fn(), select: vi.fn() };
    showConnection({ error: "Lien impossible" }, ui);
    showConnection({ created: "x" }, ui);
    showConnection(null, ui);
    expect(ui.notify).toHaveBeenCalledWith({ kind: "error", text: "Lien impossible" });
    expect(ui.select).toHaveBeenCalledWith(["x"]);
    expect(ui.notify).toHaveBeenCalledTimes(1);
    expect(ui.select).toHaveBeenCalledTimes(1);
  });
});
