import type { Point } from "@core/index";
import { center, clipToRect, type Rect, snap } from "./shapeMetrics";

/** Nombre d'obstacles traversés par une ligne brisée (échantillonnage des segments). */
function crossings(points: Point[], obstacles: Rect[]): number {
  let count = 0;
  for (const r of obstacles) {
    const hit = points.slice(1).some((p, i) => {
      const q = points[i]!;
      const steps = Math.max(2, Math.ceil(Math.hypot(p.x - q.x, p.y - q.y) / 6));
      for (let k = 0; k <= steps; k += 1) {
        const x = q.x + ((p.x - q.x) * k) / steps;
        const y = q.y + ((p.y - q.y) * k) / steps;
        if (x > r.x && x < r.x + r.width && y > r.y && y < r.y + r.height) {
          return true;
        }
      }
      return false;
    });
    if (hit) {
      count += 1;
    }
  }
  return count;
}

/**
 * Cassures de la seconde patte d'une association réflexive : elle contourne l'entité et
 * l'association par un couloir (dessus, dessous, gauche, droite), puis rejoint l'entité par
 * le milieu ou par un côté. On retient le tracé qui traverse le moins d'objets (`obstacles`,
 * l'entité et l'association comprises), qui ne longe ni ne croise la première patte, puis qui coupe
 * le moins de traits (`lines`), puis le plus court.
 */
export function reflexiveBends(
  entity: Rect,
  association: Rect,
  grid: number | null,
  obstacles: Rect[] = [],
  lines: [Point, Point][] = [],
): Point[] {
  const ce = center(entity);
  const ca = center(association);
  const OUT = 40;
  const SIDE = 20;
  const s = (v: number) => snap(v, grid);
  const top = s(Math.min(entity.y, association.y) - OUT);
  const bottom = s(Math.max(entity.y + entity.height, association.y + association.height) + OUT);
  const left = s(Math.min(entity.x, association.x) - OUT);
  const right = s(Math.max(entity.x + entity.width, association.x + association.width) + OUT);
  const sideX = [s(entity.x - SIDE), s(entity.x + entity.width + SIDE)];
  const sideY = [s(entity.y - SIDE), s(entity.y + entity.height + SIDE)];

  const candidates: Point[][] = [];
  for (const y of [top, bottom]) {
    candidates.push([
      { x: ca.x, y },
      { x: ce.x, y },
    ]);
    for (const x of sideX) {
      candidates.push([
        { x: ca.x, y },
        { x, y },
        { x, y: ce.y },
      ]);
    }
  }
  for (const x of [left, right]) {
    candidates.push([
      { x, y: ca.y },
      { x, y: ce.y },
    ]);
    for (const y of sideY) {
      candidates.push([
        { x, y: ca.y },
        { x, y },
        { x: ce.x, y },
      ]);
    }
  }

  const all = [...obstacles, entity, association];
  /** Première patte, droite, telle qu'elle est dessinée (du bord de l'association au bord de l'entité). */
  const first: [Point, Point] = [clipToRect(association, ce), clipToRect(entity, ca)];
  const score = (bends: Point[]) => {
    const path = [clipToRect(association, bends[0]!), ...bends, clipToRect(entity, bends.at(-1)!)];
    const length = path.slice(1).reduce((sum, p, i) => sum + Math.hypot(p.x - path[i]!.x, p.y - path[i]!.y), 0);
    // Les extrémités touchent l'entité et l'association : seuls les segments intermédiaires comptent.
    // Un tronçon qui longe la première patte (droite association–entité) la rendrait invisible.
    const alongFirst = path
      .slice(1)
      .some((p, i) => distanceToSegment(p, ca, ce) < 8 && distanceToSegment(path[i]!, ca, ce) < 8);
    // Ni la croiser : les deux pattes d'une réflexive ne se coupent pas.
    const crossesFirst = path.slice(1).some((p, i) => segmentsIntersect(path[i]!, p, first[0], first[1]));
    const cut = lines.filter(([a, b]) => path.slice(1).some((p, i) => segmentsIntersect(path[i]!, p, a, b))).length;
    return (
      crossings(path.slice(1, -1), all) * 1e6 +
      crossings(path, obstacles) * 1e6 +
      (alongFirst || crossesFirst ? 1e5 : 0) +
      cut * 1e4 +
      length
    );
  };
  return candidates.reduce((best, c) => (score(c) < score(best) ? c : best));
}

/** Intersection stricte de deux segments. */
function segmentsIntersect(p: Point, q: Point, r: Point, s: Point): boolean {
  const o = (a: Point, b: Point, c: Point) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const d1 = o(r, s, p);
  const d2 = o(r, s, q);
  const d3 = o(p, q, r);
  const d4 = o(p, q, s);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const ratio = dx || dy ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy))) : 0;
  return Math.hypot(p.x - (a.x + ratio * dx), p.y - (a.y + ratio * dy));
}
