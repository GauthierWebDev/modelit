import { createInheritance, type Id, toLogicalModel } from "@core/index";
import { model } from "@core/testing/builder";
import { describe, expect, it } from "vitest";
import { logicalRenameTarget, mcdRenameTarget } from "./canvasRules";
import { type NodeLayout, ROW_HEIGHT, TITLE_HEIGHT } from "./geometry";
import { tableLayouts } from "./logicalGeometry";

/** Cible du double-clic : renommage sur place dans le MCD (O-58), le MLD et le MPD (O-56, O-59). */

const box = (x: number, y: number, width = 110, height = 40): NodeLayout => ({ x, y, width, height, rows: [] });

describe("double-clic dans le MCD (O-58)", () => {
  const entity = { ...box(100, 100, 120, TITLE_HEIGHT + 4 + 2 * ROW_HEIGHT + 6) };
  entity.rows = [
    { attribute: { id: "code" } as never, y: TITLE_HEIGHT + 4 },
    { attribute: { id: "nom" } as never, y: TITLE_HEIGHT + 4 + ROW_HEIGHT },
  ];
  const inheritance = { ...createInheritance(), id: "h" };
  const layouts = new Map<Id, NodeLayout>([
    ["client", entity],
    ["h", box(400, 100, 56, 56)],
  ]);
  const target = (x: number, y: number) => mcdRenameTarget({ inheritances: [inheritance] }, layouts, { x, y });

  it("sur le titre : le nom de l'objet", () => {
    expect(target(130, 110)).toEqual({ nodeId: "client", attributeId: null });
  });

  it("sur une rubrique : cette rubrique", () => {
    expect(target(130, 100 + TITLE_HEIGHT + 4 + 2)).toEqual({ nodeId: "client", attributeId: "code" });
    expect(target(130, 100 + TITLE_HEIGHT + 4 + ROW_HEIGHT + 2)).toEqual({ nodeId: "client", attributeId: "nom" });
  });

  it("dans la marge sous les rubriques, hors de l'objet, ou sur un héritage : rien", () => {
    expect(target(130, entity.y + entity.height - 2)).toBeNull();
    expect(target(50, 50)).toBeNull();
    expect(target(420, 120)).toBeNull();
  });
});

function setup() {
  const doc = model()
    .entity("CLIENT", ["id_client*", "nom"])
    .entity("COMMANDE", ["id_commande*"])
    .association("PASSER", ["CLIENT 0,n", "COMMANDE 1,1"])
    .typed("CLIENT", "id_client", { kind: "counter" })
    .typed("CLIENT", "nom", { kind: "text", encoding: "unicode", length: "variable", size: 50 })
    .typed("COMMANDE", "id_commande", { kind: "integer", bits: 32 })
    .build();
  doc.layout.positions[doc.entities[1]!.id] = { x: 400, y: 0 };
  return { doc, logical: toLogicalModel(doc) };
}
const at = (mode: "mld" | "mpd", tableName: string, columnName: string | null, part: "name" | "type" = "name") => {
  const { doc, logical } = setup();
  const layouts = tableLayouts(logical, doc, mode);
  const l = layouts.find((layout) => layout.table.name === tableName)!;
  const row = columnName ? l.rows.find((r) => r.column.name === columnName)! : null;
  const y = l.y + (row ? row.y + ROW_HEIGHT / 2 : TITLE_HEIGHT / 2);
  const x = l.x + (part === "type" ? l.typeX + 2 : 14);
  return { target: logicalRenameTarget(layouts, mode, { x, y }), doc, l };
};

describe("double-clic dans le MLD et le MPD (O-56, O-59)", () => {
  it("sur le titre d'une table : la table", () => {
    const { target, l } = at("mld", "CLIENT", null);
    expect(target).toEqual({ sourceId: l.sourceId, column: null });
  });

  it("sur une colonne propre : sa rubrique", () => {
    const { target, doc, l } = at("mld", "CLIENT", "nom");
    const nom = doc.entities[0]!.attributes.find((a) => a.name === "nom")!;
    expect(target).toEqual({ sourceId: l.sourceId, column: { attributeId: nom.id } });
  });

  it("sur une clé étrangère : la clé, par sa patte d'origine (O-07)", () => {
    const { target, l } = at("mld", "COMMANDE", "id_client");
    const fk = l.rows.find((r) => r.column.name === "id_client")!.column;
    expect(target).toEqual({
      sourceId: l.sourceId,
      column: { linkId: fk.origin!.linkId, originId: fk.origin!.attributeId },
    });
  });

  it("MPD, sur le type d'une colonne propre : son type (O-59)", () => {
    const { target, doc, l } = at("mpd", "CLIENT", "nom", "type");
    const nom = doc.entities[0]!.attributes.find((a) => a.name === "nom")!;
    expect(target).toEqual({ sourceId: l.sourceId, column: { attributeId: nom.id }, part: "type" });
  });

  it("MPD, sur le type d'un compteur ou d'une clé étrangère : rien (O-59)", () => {
    expect(at("mpd", "CLIENT", "id_client", "type").target).toBeNull();
    expect(at("mpd", "COMMANDE", "id_client", "type").target).toBeNull();
  });

  it("MPD, sur le nom d'une colonne : son nom, comme dans le MLD", () => {
    const { target } = at("mpd", "CLIENT", "nom");
    expect(target).not.toBeNull();
    expect(target!.part).toBeUndefined();
  });

  it("hors de toute table : rien", () => {
    const { doc, logical } = setup();
    expect(logicalRenameTarget(tableLayouts(logical, doc, "mld"), "mld", { x: 1000, y: 1000 })).toBeNull();
  });
});
