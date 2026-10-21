import {
  createAssociation,
  createLink,
  type Id,
  type ModelDocument,
  nextFreeName,
  type Point,
  toLogicalModel,
} from "@core/index";
import {
  center,
  intersects,
  type NodeLayout,
  nodeLayout,
  type Rect,
  ROW_HEIGHT,
  reflexiveBends,
  snap,
  TITLE_HEIGHT,
} from "./geometry";
import { columnTarget, type RenameTarget } from "./InlineRename";
import { type LogicalViewMode, type TableLayout, tableLayouts } from "./logicalGeometry";
import { layoutsOf } from "./viewport";

/**
 * Règles de décision des canevas, sans état ni DOM : placement des associations créées à l'outil
 * Lien (overrides O-02, O-08, O-60) et cible du renommage au double-clic (O-56, O-58, O-59).
 * Appelées par `McdCanvas` et `LogicalCanvas`.
 */

type Size = { width: number; height: number };

/** Marge entre la nouvelle association et tout objet (O-08, O-60). */
const MARGIN = 16;
/** Pas entre deux couronnes ou deux décalages successifs, et nombre d'essais au-delà du premier. */
const STEP = 60;
const TRIES = 12;

/** Plus grande boîte de chaque objet du schéma : celle du MCD, ou celle de sa table du MPD (O-60, comme O-09). */
export function placementBoxes(doc: ModelDocument): Map<Id, Rect> {
  const mpd = new Map(tableLayouts(toLogicalModel(doc), doc, "mpd").map((t) => [t.sourceId, t]));
  return new Map(
    [...layoutsOf(doc)].map(([id, mcd]) => {
      const table = mpd.get(id);
      return [
        id,
        {
          x: mcd.x,
          y: mcd.y,
          width: Math.max(mcd.width, table?.width ?? 0),
          height: Math.max(mcd.height, table?.height ?? 0),
        },
      ];
    }),
  );
}

/**
 * Nouvelle association entre `fromId` et `toId` (O-60) : sa taille dans le MCD, et la place qu'elle
 * réserve, sa future table du MPD comprise (calculée sur une copie du modèle, pattes 0,n comme à la
 * création).
 */
export function newAssociationSize(doc: ModelDocument, fromId: Id, toId: Id): { mcd: Size; reserved: Size } {
  const association = createAssociation(
    nextFreeName(
      "Association",
      doc.associations.map((x) => x.name),
    ),
  );
  const mcd = nodeLayout(association, { x: 0, y: 0 }, doc.settings.display);
  const trial: ModelDocument = structuredClone(doc);
  trial.associations.push(association);
  trial.links.push(createLink(association.id, fromId), createLink(association.id, toId));
  trial.layout.positions[association.id] = { x: 0, y: 0 };
  const table = tableLayouts(toLogicalModel(trial), trial, "mpd").find((t) => t.sourceId === association.id);
  return {
    mcd: { width: mcd.width, height: mcd.height },
    reserved: { width: Math.max(mcd.width, table?.width ?? 0), height: Math.max(mcd.height, table?.height ?? 0) },
  };
}

/** Le coin `p` laisse-t-il la place `size`, marge comprise, hors de tous les obstacles ? */
const isFree = (p: Point, size: Size, obstacles: Rect[]) =>
  !obstacles.some((r) =>
    intersects(
      { x: p.x - MARGIN, y: p.y - MARGIN, width: size.width + 2 * MARGIN, height: size.height + 2 * MARGIN },
      r,
    ),
  );

/**
 * Association réflexive (O-08, O-60) : premier emplacement libre autour de l'entité (droite,
 * dessous, gauche, dessus, puis de plus en plus loin) ; à défaut, à droite.
 */
export function reflexiveSlot(entity: Rect, size: Size, obstacles: Rect[], grid: number | null): Point {
  const ce = center(entity);
  type Side = "right" | "below" | "left" | "above";
  const at = (side: Side, distance: number): Point => {
    switch (side) {
      case "right":
        return { x: entity.x + entity.width + distance, y: ce.y - size.height / 2 };
      case "left":
        return { x: entity.x - distance - size.width, y: ce.y - size.height / 2 };
      case "below":
        return { x: ce.x - size.width / 2, y: entity.y + entity.height + distance };
      case "above":
        return { x: ce.x - size.width / 2, y: entity.y - distance - size.height };
    }
  };
  for (let distance = 90; distance <= 90 + STEP * TRIES; distance += STEP) {
    for (const candidate of ["right", "below", "left", "above"] as Side[]) {
      const p = at(candidate, distance);
      const snapped = { x: snap(p.x, grid), y: snap(p.y, grid) };
      if (isFree(snapped, size, obstacles)) return snapped;
    }
  }
  return at("right", 90);
}

/**
 * Association entre deux entités (O-02, O-60) : centrée entre elles (boîtes du MCD) si la place est
 * libre ; sinon décalée perpendiculairement au segment qui les joint, d'un côté puis de l'autre, de
 * plus en plus loin ; à défaut, au centre. `mcd` place le coin, `size` est la place réservée.
 */
export function betweenSlot(a: Rect, b: Rect, mcd: Size, size: Size, obstacles: Rect[], grid: number | null): Point {
  const ca = center(a);
  const cb = center(b);
  const middle = { x: (ca.x + cb.x) / 2, y: (ca.y + cb.y) / 2 };
  const length = Math.hypot(cb.x - ca.x, cb.y - ca.y);
  // Perpendiculaire au segment ; entités confondues : décalage vertical.
  const normal = length ? { x: -(cb.y - ca.y) / length, y: (cb.x - ca.x) / length } : { x: 0, y: 1 };
  const corner = (offset: number): Point => ({
    x: snap(middle.x + normal.x * offset - mcd.width / 2, grid),
    y: snap(middle.y + normal.y * offset - mcd.height / 2, grid),
  });
  for (const offset of [0, ...Array.from({ length: TRIES }, (_, i) => [(i + 1) * STEP, -(i + 1) * STEP]).flat()]) {
    const p = corner(offset);
    if (isFree(p, size, obstacles)) return p;
  }
  return corner(0);
}

/**
 * Placement de l'association créée en reliant `fromId` à `toId`, depuis n'importe quelle vue (O-60) :
 * dimensions de la vue la plus large (MPD), aucun objet existant déplacé. Réflexive : la seconde patte
 * contourne l'ensemble dans le MCD (O-10, O-33). Entre autre chose que deux entités (patte, lien
 * d'héritage), `connectNodes` ne crée pas d'association : le placement n'est pas calculé.
 */
export function placeNewAssociation(
  doc: ModelDocument,
  fromId: Id,
  toId: Id,
  grid: number | null,
): { associationPosition: Point; reflexiveBends?: Point[] } {
  const isEntity = (id: Id) => doc.entities.some((e) => e.id === id);
  if (!isEntity(fromId) || !isEntity(toId)) return { associationPosition: { x: 0, y: 0 } };
  const layouts = layoutsOf(doc);
  const boxes = placementBoxes(doc);
  const obstacles = [...boxes.values()];
  const size = newAssociationSize(doc, fromId, toId);
  if (fromId !== toId) {
    return {
      associationPosition: betweenSlot(
        layouts.get(fromId)!,
        layouts.get(toId)!,
        size.mcd,
        size.reserved,
        obstacles,
        grid,
      ),
    };
  }
  const position = reflexiveSlot(boxes.get(fromId)!, size.reserved, obstacles, grid);
  const entity = layouts.get(fromId)!;
  const others = [...layouts.values()].filter((r) => r !== entity);
  return {
    associationPosition: position,
    reflexiveBends: reflexiveBends(entity, { ...position, ...size.mcd }, grid, others),
  };
}

/** Titre ou rubrique d'une entité / association sous le point (O-58). */
export function mcdRenameTarget(
  doc: Pick<ModelDocument, "inheritances">,
  layouts: Map<Id, NodeLayout>,
  point: Point,
): { nodeId: Id; attributeId: Id | null } | null {
  const hit = [...layouts].findLast(
    ([id, box]) =>
      !doc.inheritances.some((h) => h.id === id) &&
      point.x >= box.x &&
      point.x <= box.x + box.width &&
      point.y >= box.y &&
      point.y <= box.y + box.height,
  );
  if (!hit) return null;
  const [nodeId, l] = hit;
  const dy = point.y - l.y;
  if (dy < TITLE_HEIGHT) return { nodeId, attributeId: null };
  const row = l.rows.find((r) => dy >= r.y && dy < r.y + ROW_HEIGHT);
  return row ? { nodeId, attributeId: row.attribute.id } : null;
}

/** Titre ou colonne sous le point (O-56) : cible du renommage. */
export function logicalRenameTarget(layouts: TableLayout[], mode: LogicalViewMode, point: Point): RenameTarget | null {
  const layout = layouts.findLast(
    (l) => point.x >= l.x && point.x <= l.x + l.width && point.y >= l.y && point.y <= l.y + l.height,
  );
  if (!layout) return null;
  const dy = point.y - layout.y;
  if (dy < TITLE_HEIGHT) return { sourceId: layout.sourceId, column: null };
  const row = layout.rows.find((r) => dy >= r.y && dy < r.y + ROW_HEIGHT);
  if (!row) return null;
  // MPD : le type d'une colonne propre, hors compteur (O-59) ; ailleurs sur la ligne, son nom.
  const dx = point.x - layout.x;
  if (mode === "mpd" && dx >= layout.typeX - 4 && dx < layout.constraintsX - 4) {
    const { attributeId, origin, type } = row.column;
    return attributeId && !origin && type?.kind !== "counter"
      ? { sourceId: layout.sourceId, column: { attributeId }, part: "type" }
      : null;
  }
  return columnTarget(layout.sourceId, row.column);
}
