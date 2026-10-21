import { createAssociation, type Id, type ModelDocument, nextFreeName, type Point } from "@core/index";
import {
  center,
  intersects,
  type NodeLayout,
  nodeLayout,
  ROW_HEIGHT,
  reflexiveBends,
  snap,
  TITLE_HEIGHT,
} from "./geometry";
import { columnTarget, type RenameTarget } from "./InlineRename";
import type { LogicalViewMode, TableLayout } from "./logicalGeometry";

/**
 * Règles de décision des canevas, sans état ni DOM : placement des associations créées à l'outil
 * Lien (overrides O-02, O-08) et cible du renommage au double-clic (O-56, O-58, O-59).
 * Appelées par `McdCanvas` et `LogicalCanvas`.
 */

/** Position de la nouvelle association : centrée entre les deux entités. */
export function associationPosition(
  doc: Pick<ModelDocument, "associations" | "settings">,
  a: NodeLayout,
  b: NodeLayout,
  grid: number | null,
): Point {
  const name = nextFreeName(
    "Association",
    doc.associations.map((x) => x.name),
  );
  const size = nodeLayout(createAssociation(name), { x: 0, y: 0 }, doc.settings.display);
  const ca = center(a);
  const cb = center(b);
  return {
    x: snap((ca.x + cb.x) / 2 - size.width / 2, grid),
    y: snap((ca.y + cb.y) / 2 - size.height / 2, grid),
  };
}

/**
 * Association réflexive : placée sur un emplacement libre autour de l'entité (droite,
 * dessous, gauche, dessus, puis de plus en plus loin) ; la seconde patte contourne
 * l'ensemble pour rester distincte de la première (`reflexiveBends`).
 */
export function reflexivePlacement(
  doc: Pick<ModelDocument, "associations" | "settings">,
  layouts: Map<Id, NodeLayout>,
  e: NodeLayout,
  grid: number | null,
) {
  const name = nextFreeName(
    "Association",
    doc.associations.map((x) => x.name),
  );
  const size = nodeLayout(createAssociation(name), { x: 0, y: 0 }, doc.settings.display);
  const ce = center(e);
  const others = [...layouts.values()];
  const MARGIN = 16;
  const isFree = (p: Point) =>
    !others.some((r) =>
      intersects(
        { x: p.x - MARGIN, y: p.y - MARGIN, width: size.width + 2 * MARGIN, height: size.height + 2 * MARGIN },
        r,
      ),
    );
  type Side = "right" | "below" | "left" | "above";
  const at = (side: Side, distance: number): Point => {
    switch (side) {
      case "right":
        return { x: e.x + e.width + distance, y: ce.y - size.height / 2 };
      case "left":
        return { x: e.x - distance - size.width, y: ce.y - size.height / 2 };
      case "below":
        return { x: ce.x - size.width / 2, y: e.y + e.height + distance };
      case "above":
        return { x: ce.x - size.width / 2, y: e.y - distance - size.height };
    }
  };
  let position = at("right", 90);
  search: for (let distance = 90; distance <= 90 + 60 * 12; distance += 60) {
    for (const candidate of ["right", "below", "left", "above"] as Side[]) {
      const p = at(candidate, distance);
      const snapped = { x: snap(p.x, grid), y: snap(p.y, grid) };
      if (isFree(snapped)) {
        position = snapped;
        break search;
      }
    }
  }
  const reflexive = reflexiveBends(
    e,
    { ...position, width: size.width, height: size.height },
    grid,
    others.filter((r) => r !== e),
  );
  return { associationPosition: position, reflexiveBends: reflexive };
}

/** Titre ou rubrique d'une entité / association sous le point (O-58). */
export function mcdRenameTarget(
  doc: Pick<ModelDocument, "inheritances">,
  layouts: Map<Id, NodeLayout>,
  point: Point,
): { nodeId: Id; attributeId: Id | null } | null {
  const hit = [...layouts].findLast(
    ([id, l]) =>
      !doc.inheritances.some((h) => h.id === id) &&
      point.x >= l.x &&
      point.x <= l.x + l.width &&
      point.y >= l.y &&
      point.y <= l.y + l.height,
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
