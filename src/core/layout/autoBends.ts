import {
  bendsOf,
  diagramLinks,
  type Id,
  linkSourceId,
  type ModelDocument,
  type Point,
  positionOf,
} from "../model/document";
import { center, type Rect } from "./rect";
import { reflexiveBends } from "./reflexive";

/**
 * Cassures après un placement automatique (overrides O-09, O-30) : la seconde patte d'une réflexive est
 * (re)tracée pour ne pas se confondre avec la première ; celles d'un autre lien suivent si ses deux
 * extrémités bougent ensemble, sinon elles sont retirées (le tracé n'aurait plus de sens).
 * `mcdRect` : boîte du MCD d'un objet à sa nouvelle position.
 */

/** Cassures après placement : réflexive contournée, autres liens déplacés avec leurs extrémités ou redressés. */
export function autoLayoutBends(
  doc: ModelDocument,
  positions: Map<Id, Point>,
  mcdRect: (id: Id) => Rect,
  grid: number | null,
): Map<Id, Point[]> {
  const bends = new Map<Id, Point[]>();
  for (const link of diagramLinks(doc)) {
    const sourceId = linkSourceId(link);
    const legs = doc.links.filter((l) => l.associationId === sourceId);
    const reflexive = legs.length === 2 && legs.every((l) => l.entityId === link.entityId);
    if (reflexive) {
      reflexiveLeg(doc, { link, sourceId, second: legs[1]!.id }, { positions, mcdRect, grid }, bends);
      continue;
    }
    const linkBends = bendsOf(doc.layout, link.id);
    if (linkBends.length === 0) {
      continue;
    }
    const node = (id: Id) => positionOf(doc.layout, id);
    const delta = (id: Id) => ({ x: positions.get(id)!.x - node(id).x, y: positions.get(id)!.y - node(id).y });
    const dE = delta(link.entityId);
    const dA = delta(sourceId);
    bends.set(link.id, dE.x === dA.x && dE.y === dA.y ? linkBends.map((b) => ({ x: b.x + dE.x, y: b.y + dE.y })) : []);
  }
  return bends;
}

/** Seconde patte d'une réflexive : contourne l'entité et l'association ; la première reste droite. */
function reflexiveLeg(
  doc: ModelDocument,
  { link, sourceId, second }: { link: ReturnType<typeof diagramLinks>[number]; sourceId: Id; second: Id },
  { positions, mcdRect, grid }: { positions: Map<Id, Point>; mcdRect: (id: Id) => Rect; grid: number | null },
  bends: Map<Id, Point[]>,
) {
  if (link.id !== second) {
    if (bendsOf(doc.layout, link.id).length > 0) {
      bends.set(link.id, []);
    }
    return;
  }
  const obstacles = [...positions.keys()].filter((id) => id !== link.entityId && id !== sourceId).map(mcdRect);
  // Traits droits des autres liens (centre à centre) : le contournement évite de les couper.
  const lines = diagramLinks(doc)
    .filter((l) => linkSourceId(l) !== sourceId)
    .map((l): [Point, Point] => [center(mcdRect(linkSourceId(l))), center(mcdRect(l.entityId))]);
  bends.set(link.id, reflexiveBends(mcdRect(link.entityId), mcdRect(sourceId), grid, obstacles, lines));
}
