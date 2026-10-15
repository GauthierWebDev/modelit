import { describe, expect, it } from "vitest";
import {
  closeGroup,
  defaultLayout,
  groupOf,
  hideSection,
  keepOnScreen,
  moveGroup,
  moveSection,
  sanitizeLayout,
  setActive,
  showSection,
  toggleCollapsed,
  type DockLayout,
} from "./layout";

const rect = { x: 100, y: 100, width: 300, height: 200 };
const shape = (layout: DockLayout) => ({
  right: layout.zones.right.groups.map((g) => g.sections.join("|")),
  bottom: layout.zones.bottom.groups.map((g) => g.sections.join("|")),
  floating: layout.floating.map((g) => g.sections.join("|")),
  hidden: layout.hidden,
});

/** Sections ancrables ou flottantes (override O-46). */
describe("disposition des sections", () => {
  it("par défaut : celle d'avant O-46 ; la section Session, masquée, s'affiche pendant une session (O-05 §7)", () => {
    expect(shape(defaultLayout())).toEqual({ right: ["properties|model"], bottom: ["mld|sql|issues"], floating: [], hidden: ["session"] });
    expect(shape(showSection(defaultLayout(), "session")).right).toEqual(["properties|model|session"]);
  });

  it("glisser un onglet sur un autre groupe : il le rejoint et devient actif", () => {
    const layout = moveSection(defaultLayout(), "issues", { kind: "group", group: "right" });
    expect(shape(layout)).toMatchObject({ right: ["properties|model|issues"], bottom: ["mld|sql"] });
    expect(groupOf(layout, "issues")!.group.active).toBe("issues");
    expect(groupOf(layout, "mld")!.group.active).toBe("mld");
  });

  it("glisser un onglet au bord d'une zone : nouveau groupe ancré à cet endroit", () => {
    const layout = moveSection(defaultLayout(), "model", { kind: "zone", zone: "right", index: 1 });
    expect(shape(layout).right).toEqual(["properties", "model"]);
  });

  it("glisser un onglet ailleurs : groupe flottant ; le dernier onglet d'un groupe le fait disparaître", () => {
    let layout = moveSection(defaultLayout(), "properties", { kind: "float", rect });
    layout = moveSection(layout, "model", { kind: "group", group: layout.floating[0]!.id });
    expect(shape(layout)).toMatchObject({ right: [], floating: ["properties|model"] });
    expect(layout.floating[0]!.rect).toEqual(rect);
  });

  it("glisser un groupe entier : il garde ses onglets et son onglet actif", () => {
    let layout = setActive(defaultLayout(), "bottom", "sql");
    layout = moveGroup(layout, "bottom", { kind: "float", rect });
    expect(shape(layout)).toMatchObject({ bottom: [], floating: ["mld|sql|issues"] });
    expect(layout.floating[0]!.active).toBe("sql");
    layout = moveGroup(layout, "bottom", { kind: "zone", zone: "right", index: 0 });
    expect(shape(layout)).toMatchObject({ right: ["mld|sql|issues", "properties|model"], floating: [] });
  });

  it("réordonner dans la même zone", () => {
    let layout = moveSection(defaultLayout(), "model", { kind: "zone", zone: "right", index: 1 });
    const first = layout.zones.right.groups[0]!.id;
    layout = moveGroup(layout, first, { kind: "zone", zone: "right", index: 2 });
    expect(shape(layout).right).toEqual(["model", "properties"]);
  });

  it("fermer un groupe masque ses sections ; les réafficher les rend à leur place", () => {
    let layout = moveGroup(defaultLayout(), "bottom", { kind: "float", rect });
    layout = closeGroup(layout, "bottom");
    expect(shape(layout)).toMatchObject({ floating: [], hidden: ["session", "mld", "sql", "issues"] });
    layout = showSection(layout, "sql");
    expect(shape(layout).floating).toEqual(["sql"]);
    expect(layout.floating[0]!.rect).toEqual(rect);
    layout = showSection(layout, "mld");
    expect(shape(layout).floating).toEqual(["sql|mld"]);
  });

  it("section masquée depuis un groupe qui existe encore : elle y revient", () => {
    let layout = hideSection(defaultLayout(), "model");
    expect(shape(layout).right).toEqual(["properties"]);
    layout = showSection(layout, "model");
    expect(shape(layout).right).toEqual(["properties|model"]);
  });

  it("replier un groupe ; choisir un onglet le déplie", () => {
    let layout = toggleCollapsed(defaultLayout(), "right");
    expect(layout.zones.right.groups[0]!.collapsed).toBe(true);
    layout = setActive(layout, "right", "model");
    expect(layout.zones.right.groups[0]!).toMatchObject({ collapsed: false, active: "model" });
  });

  it("les opérations ne modifient pas la disposition d'origine", () => {
    const layout = defaultLayout();
    const before = JSON.stringify(layout);
    moveSection(layout, "sql", { kind: "float", rect });
    hideSection(layout, "mld");
    expect(JSON.stringify(layout)).toBe(before);
  });

  it("position hors de tout écran : ramenée sur la fenêtre principale", () => {
    let layout = moveSection(defaultLayout(), "sql", { kind: "float", rect: { x: 5000, y: 100, width: 300, height: 200 } });
    layout = { ...layout, toolbar: { floating: true, position: { x: -3000, y: 0 } } };
    const fixed = keepOnScreen(layout, [{ x: 0, y: 0, width: 1920, height: 1080 }], { x: 0, y: 0, width: 1280, height: 800 });
    expect(fixed.floating[0]!.rect.x).toBeLessThan(1280);
    expect(fixed.toolbar.position).toBeNull();
  });

  it("disposition relue abîmée : réparée", () => {
    expect(shape(sanitizeLayout(null))).toEqual(shape(defaultLayout()));
    const repaired = sanitizeLayout({
      zones: { right: { groups: [{ id: "a", sections: ["properties", "inconnue", "properties"], active: "x" }] }, bottom: { groups: [] } },
      floating: [{ id: "f", sections: ["sql"], rect: { x: 1, y: 2, width: 300, height: 200 } }, { id: "sans-rect", sections: ["mld"] }],
      hidden: ["issues", "sql"],
    });
    expect(shape(repaired)).toEqual({ right: ["properties", "model", "mld"], bottom: [], floating: ["sql"], hidden: ["issues", "session"] });
    expect(repaired.zones.right.groups[0]!.active).toBe("properties");
  });
});
