import {
  createAssociation,
  createInheritance,
  emptyDocument,
  type Id,
  nextFreeName,
  toLogicalModel,
} from "@core/index";
import { model } from "@core/testing/builder";
import { describe, expect, it } from "vitest";
import { associationPosition, logicalRenameTarget, mcdRenameTarget, reflexivePlacement } from "./canvasRules";
import { center, intersects, type NodeLayout, nodeLayout, ROW_HEIGHT, TITLE_HEIGHT } from "./geometry";
import { tableLayouts } from "./logicalGeometry";

/**
 * Règles des canevas : placement des associations créées à l'outil Lien (O-02, O-08) et cible du
 * renommage au double-clic (O-56, O-58, O-59).
 */

const doc = emptyDocument();
const box = (x: number, y: number, width = 110, height = 40): NodeLayout => ({ x, y, width, height, rows: [] });
/** Encombrement de l'association qui sera créée (« Association 1 », sans rubrique). */
const ASSOCIATION = (() => {
  const l = nodeLayout(createAssociation(nextFreeName("Association", [])), { x: 0, y: 0 }, doc.settings.display);
  return { width: l.width, height: l.height };
})();

describe("association réflexive : emplacement libre autour de l'entité (O-08)", () => {
  const entity = box(500, 500);
  const ce = center(entity);
  const slot = {
    right: { x: entity.x + entity.width + 90, y: ce.y - ASSOCIATION.height / 2 },
    below: { x: ce.x - ASSOCIATION.width / 2, y: entity.y + entity.height + 90 },
    left: { x: entity.x - 90 - ASSOCIATION.width, y: ce.y - ASSOCIATION.height / 2 },
    above: { x: ce.x - ASSOCIATION.width / 2, y: entity.y - 90 - ASSOCIATION.height },
  };
  /** Objet qui occupe un emplacement. */
  const blocking = (p: { x: number; y: number }) => box(p.x, p.y, ASSOCIATION.width, ASSOCIATION.height);
  const place = (...others: NodeLayout[]) => {
    const layouts = new Map<Id, NodeLayout>([["e", entity], ...others.map((o, i): [Id, NodeLayout] => [`o${i}`, o])]);
    return reflexivePlacement(doc, layouts, entity, null).associationPosition;
  };

  it("à droite si la place est libre", () => {
    expect(place()).toEqual(slot.right);
  });

  it("puis dessous, à gauche, dessus, dans cet ordre", () => {
    expect(place(blocking(slot.right))).toEqual(slot.below);
    expect(place(blocking(slot.right), blocking(slot.below))).toEqual(slot.left);
    expect(place(blocking(slot.right), blocking(slot.below), blocking(slot.left))).toEqual(slot.above);
  });

  it("tout autour occupé : plus loin, en recommençant par la droite", () => {
    // Petits obstacles sur les seuls emplacements les plus proches : la couronne suivante est libre.
    const placed = place(...Object.values(slot).map((p) => box(p.x, p.y, 20, 20)));
    expect(placed).toEqual({ x: slot.right.x + 60, y: slot.right.y });
  });

  it("un emplacement encore recouvert plus loin est sauté : on suit l'ordre sur la couronne suivante", () => {
    const placed = place(...Object.values(slot).map(blocking));
    const rect = { ...placed, ...ASSOCIATION };
    expect(
      Object.values(slot)
        .map(blocking)
        .some((o) => intersects(rect, o)),
    ).toBe(false);
    expect(placed).not.toEqual(slot.right);
  });

  it("jamais sur un objet existant", () => {
    const others = Object.values(slot).map(blocking);
    const placed = place(...others);
    const rect = { ...placed, ...ASSOCIATION };
    expect(others.some((o) => intersects(rect, o))).toBe(false);
  });

  it("aligné sur la grille ; la seconde patte reçoit ses cassures (O-10)", () => {
    const layouts = new Map<Id, NodeLayout>([["e", box(503, 497)]]);
    const result = reflexivePlacement(doc, layouts, layouts.get("e")!, 10);
    expect(result.associationPosition.x % 10).toBe(0);
    expect(result.associationPosition.y % 10).toBe(0);
    expect(result.reflexiveBends.length).toBeGreaterThan(0);
  });
});

describe("association entre deux entités (O-02)", () => {
  const a = box(100, 100);
  const b = box(500, 300);

  it("caractérisation : centrée entre les deux entités", () => {
    const p = associationPosition(doc, a, b, null);
    const middle = { x: (center(a).x + center(b).x) / 2, y: (center(a).y + center(b).y) / 2 };
    expect(center({ ...p, ...ASSOCIATION })).toEqual(middle);
  });

  it("alignée sur la grille", () => {
    const p = associationPosition(doc, box(103, 107), box(509, 301), 10);
    expect([p.x % 10, p.y % 10]).toEqual([0, 0]);
  });
});

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

describe("double-clic dans le MLD et le MPD (O-56, O-59)", () => {
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
    const l = layouts.find((x) => x.table.name === tableName)!;
    const row = columnName ? l.rows.find((r) => r.column.name === columnName)! : null;
    const y = l.y + (row ? row.y + ROW_HEIGHT / 2 : TITLE_HEIGHT / 2);
    const x = l.x + (part === "type" ? l.typeX + 2 : 14);
    return { target: logicalRenameTarget(layouts, mode, { x, y }), doc, l };
  };

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
