import {
  bendsOf,
  type DiagramLayout,
  diagramLinks,
  type Id,
  linkSourceId,
  type ModelDocument,
  type Point,
  positionOf,
  setBends,
} from "../model/document";

/** Valeur alignée sur la grille de pas `grid` ; sans grille, inchangée. */
export const snap = (value: number, grid: number | null) => (grid ? Math.round(value / grid) * grid : value);

/** Ce qu'un déplacement emporte : position de départ de chaque objet, cassures des traits qui suivent. */
export interface MoveOrigins {
  positions: Map<Id, Point>;
  /** Cassures des traits dont les deux extrémités sont déplacées : elles suivent (O-10, O-57). */
  bends: Map<Id, Point[]>;
}

/** Origines du déplacement des objets `ids` (tels quels : à l'appelant de ne garder que les objets déplaçables). */
export function moveOrigins(doc: ModelDocument, ids: Iterable<Id>): MoveOrigins {
  const positions = new Map<Id, Point>([...ids].map((id) => [id, positionOf(doc.layout, id)]));
  const bends = new Map<Id, Point[]>();
  for (const link of diagramLinks(doc)) {
    const points = bendsOf(doc.layout, link.id);
    if (points.length > 0 && positions.has(linkSourceId(link)) && positions.has(link.entityId)) {
      bends.set(link.id, points);
    }
  }
  return { positions, bends };
}

/** Applique le décalage `offset` depuis les origines, aligné sur la grille `grid` (null : sans alignement). */
export function applyMove(layout: DiagramLayout, origins: MoveOrigins, offset: Point, grid: number | null) {
  const moved = (p: Point): Point => ({ x: snap(p.x + offset.x, grid), y: snap(p.y + offset.y, grid) });
  for (const [id, origin] of origins.positions) {
    layout.positions[id] = moved(origin);
  }
  for (const [id, points] of origins.bends) {
    setBends(layout, id, points.map(moved));
  }
}
