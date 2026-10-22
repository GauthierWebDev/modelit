import { type AssociationSize, createLink, type Id, type ModelDocument, type Point, toLogicalModel } from "@core/index";
import type { DiagramSizer } from "@/app/diagramSizer";
import { newAssociation } from "@/app/linkCommands";
import { type NodeLayout, nodeLayout, type Rect, ROW_HEIGHT, TITLE_HEIGHT } from "./geometry";
import { columnTarget, type RenameTarget } from "./InlineRename";
import { type LogicalViewMode, type TableLayout, tableLayouts } from "./logicalGeometry";
import { layoutsOf } from "./viewport";

/**
 * Règles des canevas, sans état ni DOM : tailles des boîtes pour le placement des associations créées à
 * l'outil Lien (O-60 ; la règle de placement est dans `core/layout/placement.ts`, son cas d'usage dans
 * `app/associationPlacement.ts`) et cible du renommage au double-clic (O-56, O-58, O-59).
 */

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
export function newAssociationSize(doc: ModelDocument, fromId: Id, toId: Id): AssociationSize {
  const association = newAssociation(doc);
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
  if (!hit) {
    return null;
  }
  const [nodeId, l] = hit;
  const dy = point.y - l.y;
  if (dy < TITLE_HEIGHT) {
    return { nodeId, attributeId: null };
  }
  const row = l.rows.find((r) => dy >= r.y && dy < r.y + ROW_HEIGHT);
  return row ? { nodeId, attributeId: row.attribute.id } : null;
}

/** Titre ou colonne sous le point (O-56) : cible du renommage. */
export function logicalRenameTarget(layouts: TableLayout[], mode: LogicalViewMode, point: Point): RenameTarget | null {
  const layout = layouts.findLast(
    (l) => point.x >= l.x && point.x <= l.x + l.width && point.y >= l.y && point.y <= l.y + l.height,
  );
  if (!layout) {
    return null;
  }
  const dy = point.y - layout.y;
  if (dy < TITLE_HEIGHT) {
    return { sourceId: layout.sourceId, column: null };
  }
  const row = layout.rows.find((r) => dy >= r.y && dy < r.y + ROW_HEIGHT);
  if (!row) {
    return null;
  }
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

/** Adaptateur du port `DiagramSizer` (`app/diagramSizer.ts`) : tailles mesurées par l'interface. */
export const canvasSizer: DiagramSizer = {
  mcdBoxes: layoutsOf,
  placementBoxes,
  associationSize: newAssociationSize,
};
