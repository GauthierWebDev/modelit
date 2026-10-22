import {
  betweenSlot,
  createAssociation,
  emptyDocument,
  type Id,
  type ModelDocument,
  nextFreeName,
  reflexiveSlot,
  toLogicalModel,
} from "@core/index";
import { model } from "@core/testing/builder";
import { describe, expect, it } from "vitest";
import { placeNewAssociation } from "@/app/associationPlacement";
import { connectNodes } from "@/app/commands";
import { setDiagramSizer } from "@/app/diagramSizer";
import { createDocumentHandle } from "@/app/document/handle";
import { canvasSizer, newAssociationSize, placementBoxes } from "./canvasRules";
import { center, intersects, type NodeLayout, nodeLayout, type Rect } from "./geometry";
import { tableLayouts } from "./logicalGeometry";
import { layoutsOf } from "./viewport";

/**
 * Règles des canevas : placement des associations créées à l'outil Lien (O-02, O-08, O-60). Cible du
 * renommage au double-clic (O-56, O-58, O-59) : canvasRenameTargets.test.ts.
 */

setDiagramSizer(canvasSizer);

const EMPTY_DOC = emptyDocument();
const box = (x: number, y: number, width = 110, height = 40): NodeLayout => ({ x, y, width, height, rows: [] });
/** Encombrement de l'association qui sera créée (« Association 1 », sans rubrique). */
const ASSOCIATION = (() => {
  const l = nodeLayout(createAssociation(nextFreeName("Association", [])), { x: 0, y: 0 }, EMPTY_DOC.settings.display);
  return { width: l.width, height: l.height };
})();
const overlaps = (a: Rect, b: Rect) => intersects(a, b);

describe("réflexive : premier emplacement libre autour de l'entité (O-08)", () => {
  const entity = box(500, 500);
  const ce = center(entity);
  const slot = {
    right: { x: entity.x + entity.width + 90, y: ce.y - ASSOCIATION.height / 2 },
    below: { x: ce.x - ASSOCIATION.width / 2, y: entity.y + entity.height + 90 },
    left: { x: entity.x - 90 - ASSOCIATION.width, y: ce.y - ASSOCIATION.height / 2 },
    above: { x: ce.x - ASSOCIATION.width / 2, y: entity.y - 90 - ASSOCIATION.height },
  };
  const blocking = (p: { x: number; y: number }) => box(p.x, p.y, ASSOCIATION.width, ASSOCIATION.height);
  const place = (...others: Rect[]) => reflexiveSlot(entity, ASSOCIATION, [entity, ...others], null);

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
    expect(place(...Object.values(slot).map((p) => box(p.x, p.y, 20, 20)))).toEqual({
      x: slot.right.x + 60,
      y: slot.right.y,
    });
  });

  it("une marge le sépare de tout objet (O-60) : un obstacle trop proche fait passer à l'emplacement suivant", () => {
    const near = box(slot.right.x + ASSOCIATION.width + 8, slot.right.y, 20, 20);
    expect(overlaps({ ...slot.right, ...ASSOCIATION }, near)).toBe(false);
    expect(place(near)).toEqual(slot.below);
  });

  it("jamais sur un obstacle ; aligné sur la grille", () => {
    const others = Object.values(slot).map(blocking);
    const placed = place(...others);
    expect(others.some((o) => overlaps({ ...placed, ...ASSOCIATION }, o))).toBe(false);
    const snapped = reflexiveSlot(box(503, 497), ASSOCIATION, [box(503, 497)], 10);
    expect([snapped.x % 10, snapped.y % 10]).toEqual([0, 0]);
  });
});

describe("association entre deux entités : centrée, sinon décalée de côté (O-02, O-60)", () => {
  const a = box(100, 300);
  const b = box(700, 300);
  const middle = { x: (center(a).x + center(b).x) / 2, y: (center(a).y + center(b).y) / 2 };
  const slot = (dy: number) => ({ x: middle.x - ASSOCIATION.width / 2, y: middle.y + dy - ASSOCIATION.height / 2 });
  const place = (...others: Rect[]) => betweenSlot(a, b, ASSOCIATION, ASSOCIATION, [a, b, ...others], null);

  it("place libre : centrée entre les deux entités", () => {
    expect(place()).toEqual(slot(0));
  });

  it("centre occupé : décalée perpendiculairement, d'un côté puis de l'autre, de plus en plus loin", () => {
    const block = (dy: number) => box(slot(dy).x, slot(dy).y, ASSOCIATION.width, ASSOCIATION.height);
    expect(place(block(0))).toEqual(slot(60));
    expect(place(block(0), block(60))).toEqual(slot(-60));
    expect(place(block(0), block(60), block(-60))).toEqual(slot(120));
  });

  it("reste entre les deux entités", () => {
    const p = place(box(slot(0).x, slot(0).y, ASSOCIATION.width, ASSOCIATION.height));
    const c = center({ ...p, ...ASSOCIATION });
    expect(c.x).toBeGreaterThan(center(a).x);
    expect(c.x).toBeLessThan(center(b).x);
  });

  it("aligné sur la grille", () => {
    const p = betweenSlot(box(103, 107), box(509, 301), ASSOCIATION, ASSOCIATION, [], 10);
    expect([p.x % 10, p.y % 10]).toEqual([0, 0]);
  });
});

/** Entités aux tables du MPD bien plus larges que leurs boîtes du MCD (types longs). */
function wide(): ModelDocument {
  const doc = model()
    .entity("CLIENT", ["id_client*", "adresse"])
    .entity("COMMANDE", ["id_commande*"])
    .entity("PRODUIT", ["id_produit*"])
    .typed("CLIENT", "adresse", { kind: "text", encoding: "unicode", length: "variable", size: 255 })
    .build();
  const [client, commande, produit] = doc.entities;
  // PRODUIT au milieu du segment CLIENT–COMMANDE : l'emplacement central est occupé.
  doc.layout.positions[client!.id] = { x: 100, y: 100 };
  doc.layout.positions[produit!.id] = { x: 700, y: 100 };
  doc.layout.positions[commande!.id] = { x: 1300, y: 100 };
  for (const e of doc.entities) {
    for (const at of e.attributes) {
      at.type ??= { kind: "integer", bits: 32 };
    }
  }
  // Complément long : la table du MPD s'élargit nettement au-delà de la boîte du MCD.
  client!.attributes[1]!.complement = "DEFAULT 'adresse inconnue'";
  return doc;
}

/** Crée l'association avec la vraie commande, placée par `placeNewAssociation`. */
function create(d: ModelDocument, from: Id, to: Id) {
  const handle = createDocumentHandle(structuredClone(d));
  const placement = placeNewAssociation(d, from, to, 10);
  connectNodes(handle, from, to, placement);
  return { after: handle.store.getState().doc, placement };
}

/** Aucune paire d'objets ne se chevauche, ni dans le MCD, ni dans le MPD. */
function noOverlap(d: ModelDocument) {
  const mcd = [...layoutsOf(d).values()];
  const mpd = tableLayouts(toLogicalModel(d), d, "mpd");
  const clash = (rects: Rect[]) => rects.some((r, i) => rects.slice(i + 1).some((s) => overlaps(r, s)));
  return !(clash(mcd) || clash(mpd));
}

const byId = (d: ModelDocument, name: string) => d.entities.find((e) => e.name === name)!.id;

describe("dimensions de la vue la plus large (O-60)", () => {
  it("chaque objet occupe la plus grande de ses boîtes, MCD ou table du MPD", () => {
    const d = wide();
    const id = byId(d, "CLIENT");
    const mcd = layoutsOf(d).get(id)!;
    const table = tableLayouts(toLogicalModel(d), d, "mpd").find((t) => t.sourceId === id)!;
    expect(table.width).toBeGreaterThan(mcd.width);
    expect(placementBoxes(d).get(id)).toEqual({
      x: mcd.x,
      y: mcd.y,
      width: table.width,
      height: Math.max(mcd.height, table.height),
    });
  });

  it("un héritage, sans table, garde sa boîte du MCD", () => {
    const d = model()
      .entity("PERSONNE", ["id*"])
      .entity("SALARIE", ["m*"])
      .entity("STAGIAIRE", ["n*"])
      .inherit("PERSONNE", ["SALARIE", "STAGIAIRE"])
      .build();
    const h = d.inheritances[0]!.id;
    const { x, y, width, height } = layoutsOf(d).get(h)!;
    expect(placementBoxes(d).get(h)).toEqual({ x, y, width, height });
  });

  it("la place réservée est celle de la future table du MPD, telle que la crée la commande", () => {
    const d = wide();
    const [from, to] = [byId(d, "CLIENT"), byId(d, "COMMANDE")];
    const { mcd, reserved } = newAssociationSize(d, from, to);
    const handle = createDocumentHandle(structuredClone(d));
    const result = connectNodes(handle, from, to, { associationPosition: { x: 0, y: 0 } });
    const { created } = result as { created: Id };
    const after = handle.store.getState().doc;
    const table = tableLayouts(toLogicalModel(after), after, "mpd").find((t) => t.sourceId === created)!;
    expect(reserved).toEqual({ width: Math.max(mcd.width, table.width), height: Math.max(mcd.height, table.height) });
  });
});

describe("dimensions de la vue la plus large (O-60)", () => {
  it("réflexive : aucun chevauchement dans le MCD ni dans le MPD, la seconde patte contournée", () => {
    const d = wide();
    expect(noOverlap(d)).toBe(true);
    const id = byId(d, "CLIENT");
    const { after, placement } = create(d, id, id);
    expect(noOverlap(after)).toBe(true);
    expect(placement.reflexiveBends?.length).toBeGreaterThan(0);
    // Témoin : avec les seules boîtes du MCD (règle d'avant), la place trouvée chevauche une table du MPD.
    const mcd = layoutsOf(d);
    const before = reflexiveSlot(mcd.get(id)!, newAssociationSize(d, id, id).mcd, [...mcd.values()], 10);
    const handle = createDocumentHandle(structuredClone(d));
    connectNodes(handle, id, id, { associationPosition: before });
    expect(noOverlap(handle.store.getState().doc)).toBe(false);
  });

  it("entre deux entités, avec un objet au milieu : aucun chevauchement dans le MCD ni dans le MPD", () => {
    const d = wide();
    const [from, to] = [byId(d, "CLIENT"), byId(d, "COMMANDE")];
    // Témoin : la position centrée tombe sur PRODUIT.
    const mcd = layoutsOf(d);
    const size = newAssociationSize(d, from, to);
    const centred = betweenSlot(mcd.get(from)!, mcd.get(to)!, size.mcd, size.reserved, [], 10);
    expect(overlaps({ ...centred, ...size.mcd }, mcd.get(byId(d, "PRODUIT"))!)).toBe(true);
    const { after, placement } = create(d, from, to);
    expect(placement.associationPosition).not.toEqual(centred);
    expect(noOverlap(after)).toBe(true);
  });

  it("réflexive : la recherche part de la plus grande boîte de l'entité, sa table du MPD comprise (O-60)", () => {
    // CLIENT seul : l'emplacement de droite est libre.
    const d = wide();
    d.entities = d.entities.filter((e) => e.name === "CLIENT");
    const id = byId(d, "CLIENT");
    const largest = placementBoxes(d).get(id)!;
    const { placement } = create(d, id, id);
    // Emplacement de droite, au-delà de la table du MPD de l'entité.
    expect(placement.associationPosition.x).toBeGreaterThanOrEqual(largest.x + largest.width + 90 - 5);
  });

  it("aucun objet existant ne bouge", () => {
    const d = wide();
    const id = byId(d, "CLIENT");
    const { after } = create(d, id, id);
    for (const [key, p] of Object.entries(d.layout.positions)) {
      expect(after.layout.positions[key]).toEqual(p);
    }
  });
});

describe("dimensions de la vue la plus large (O-60)", () => {
  it("patte ou lien d'héritage : aucun placement calculé (connectNodes ne crée pas d'association)", () => {
    const d = model()
      .entity("CLIENT", ["id*"])
      .entity("COMMANDE", ["n*"])
      .association("PASSER", ["CLIENT 0,n"])
      .build();
    const association = d.associations[0]!.id;
    expect(placeNewAssociation(d, association, byId(d, "COMMANDE"), 10)).toEqual({
      associationPosition: { x: 0, y: 0 },
    });
  });
});
