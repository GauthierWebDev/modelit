import { formatCardinality, type Inheritance, type InheritanceLink, type Link, type Point } from "@core/index";
import { center, clipToRect, FONT_SIZE, type NodeLayout, type Rect, TAG_FONT_SIZE, textWidth } from "./shapeMetrics";

export interface LinkGeometry {
  link: Link;
  /** Cassures du trait (`doc.layout.bends`). */
  bends: Point[];
  /** Tracé : association → cassures éventuelles → entité. */
  points: Point[];
  label: Point; // cardinalité, près de l'entité
  /** Rôle de la patte : de l'autre côté du trait, hors des boîtes de l'entité et de l'association (O-38). */
  role?: Point;
}

/**
 * Position du rôle d'une patte (O-38) : près de l'entité, du côté opposé à la cardinalité, reculée
 * le long du dernier segment tant que l'étiquette touche l'entité ou l'association — jamais
 * tronquée ni recouverte par une boîte.
 */
function rolePosition(role: string, points: Point[], entity: Rect, association: Rect): Point {
  const to = points.at(-1)!;
  const before = points.at(-2)!;
  const length = Math.hypot(to.x - before.x, to.y - before.y) || 1;
  const ux = (to.x - before.x) / length;
  const uy = (to.y - before.y) / length;
  const halfWidth = (textWidth(role) * (TAG_FONT_SIZE + 1)) / FONT_SIZE / 2 + 3;
  const halfHeight = 8;
  const touches = (p: Point, r: Rect) =>
    p.x + halfWidth > r.x &&
    p.x - halfWidth < r.x + r.width &&
    p.y + halfHeight > r.y &&
    p.y - halfHeight < r.y + r.height;
  let candidate = to;
  for (let distance = 22; distance <= Math.max(22, length - 10); distance += 4) {
    candidate = {
      x: to.x - ux * distance + uy * (halfWidth * Math.abs(uy) + 8),
      y: to.y - uy * distance - ux * (halfWidth * Math.abs(uy) + 8),
    };
    if (!(touches(candidate, entity) || touches(candidate, association))) {
      return candidate;
    }
  }
  return candidate;
}

/**
 * Position de la cardinalité d'une patte (O-61) : près de l'entité, 22 px en arrière le long du dernier
 * segment et 12 px de côté, reculée tant que le texte touche l'entité ou l'association — jamais recouverte
 * par une boîte. Une cardinalité déjà dégagée ne bouge pas.
 */
function cardinalityPosition(text: string, points: Point[], entity: Rect, association: Rect): Point {
  const to = points.at(-1)!;
  const before = points.at(-2)!;
  const length = Math.hypot(to.x - before.x, to.y - before.y) || 1;
  const ux = (to.x - before.x) / length;
  const uy = (to.y - before.y) / length;
  const halfWidth = textWidth(text) / 2 + 3;
  const halfHeight = 9;
  const touches = (p: Point, r: Rect) =>
    p.x + halfWidth > r.x &&
    p.x - halfWidth < r.x + r.width &&
    p.y + halfHeight > r.y &&
    p.y - halfHeight < r.y + r.height;
  let candidate = to;
  for (let distance = 22; distance <= Math.max(22, length - 10); distance += 4) {
    candidate = { x: to.x - ux * distance - uy * 12, y: to.y - uy * distance + ux * 12 };
    if (!(touches(candidate, entity) || touches(candidate, association))) {
      return candidate;
    }
  }
  return candidate;
}

/**
 * Géométrie des pattes. Un lien suit ses points de cassure (override O-10).
 * Plusieurs pattes droites entre la même association et la même entité (réflexive)
 * sont décalées en parallèle.
 */
export function linkGeometries(
  links: Link[],
  layouts: Map<string, NodeLayout>,
  allBends: Record<string, Point[]> = {},
): LinkGeometry[] {
  const groups = new Map<string, Link[]>();
  for (const link of links) {
    if (allBends[link.id]?.length) {
      continue;
    }
    const key = `${link.associationId}|${link.entityId}`;
    groups.set(key, [...(groups.get(key) ?? []), link]);
  }
  const result: LinkGeometry[] = [];
  for (const link of links) {
    const a = layouts.get(link.associationId);
    const e = layouts.get(link.entityId);
    if (!(a && e)) {
      continue;
    }
    const bends = allBends[link.id] ?? [];
    let points: Point[];
    if (bends.length > 0) {
      points = [clipToRect(a, bends[0]!), ...bends, clipToRect(e, bends.at(-1)!)];
    } else {
      const group = groups.get(`${link.associationId}|${link.entityId}`)!;
      const ca = center(a);
      const ce = center(e);
      const len = Math.hypot(ce.x - ca.x, ce.y - ca.y) || 1;
      const offset = (group.indexOf(link) - (group.length - 1) / 2) * 18;
      const shift = (p: Point): Point => ({
        x: p.x - ((ce.y - ca.y) / len) * offset,
        y: p.y + ((ce.x - ca.x) / len) * offset,
      });
      points = [shift(clipToRect(a, shift(ce))), shift(clipToRect(e, shift(ca)))];
    }
    const text = formatCardinality(link.cardinality) + (link.relativeId ? "(R)" : "");
    const label = cardinalityPosition(text, points, e, a);
    result.push({
      link,
      bends,
      points,
      label,
      ...(link.role?.trim() ? { role: rolePosition(link.role.trim(), points, e, a) } : {}),
    });
  }
  return result;
}

/**
 * Triangle d'héritage (override O-27) : toujours droit, pointe en haut. Le lien vers l'entité
 * générique part de la pointe, ceux des entités spécialisées du milieu de la base.
 */
export interface Triangle {
  apex: Point;
  /** Milieu de la base : départ des liens vers les entités spécialisées. */
  base: Point;
  corners: [Point, Point, Point];
  centroid: Point;
}

export function triangleOf(rect: Rect): Triangle {
  const c = center(rect);
  const apex = { x: c.x, y: c.y - 22 };
  const left = { x: c.x - 24, y: c.y + 18 };
  const right = { x: c.x + 24, y: c.y + 18 };
  return {
    apex,
    base: { x: c.x, y: c.y + 18 },
    corners: [apex, left, right],
    centroid: { x: c.x, y: (apex.y + left.y + right.y) / 3 },
  };
}

export interface InheritanceLinkGeometry {
  link: InheritanceLink;
  bends: Point[];
  points: Point[];
  /** Lien vers l'entité générique : porte une flèche (non désactivable, O-27). */
  toParent: boolean;
}

/** Triangles et liens d'héritage : vers l'entité générique depuis la pointe, vers les entités spécialisées depuis la base. */
export function inheritanceGeometries(
  inheritances: Inheritance[],
  links: InheritanceLink[],
  layouts: Map<string, NodeLayout>,
  allBends: Record<string, Point[]> = {},
): { triangles: Map<string, Triangle>; links: InheritanceLinkGeometry[] } {
  const triangles = new Map<string, Triangle>();
  for (const h of inheritances) {
    const rect = layouts.get(h.id);
    if (rect) {
      triangles.set(h.id, triangleOf(rect));
    }
  }
  const result: InheritanceLinkGeometry[] = [];
  for (const link of links) {
    const triangle = triangles.get(link.inheritanceId);
    const entity = layouts.get(link.entityId);
    const h = inheritances.find((x) => x.id === link.inheritanceId);
    if (!(triangle && entity && h)) {
      continue;
    }
    const toParent = h.parentId === link.entityId;
    const start = toParent ? triangle.apex : triangle.base;
    const bends = allBends[link.id] ?? [];
    const last = bends.at(-1) ?? start;
    result.push({ link, bends, toParent, points: [start, ...bends, clipToRect(entity, last)] });
  }
  return { triangles, links: result };
}

/**
 * Tracé SVG d'une ligne brisée. Lissé (option générale « Lisser les cassures », O-21) :
 * chaque cassure devient une courbe passant par les milieux des segments voisins.
 */
export function pathOf(points: Point[], smooth: boolean): string {
  const [first, ...rest] = points;
  if (!first) {
    return "";
  }
  if (!smooth || points.length < 3) {
    return `M${first.x},${first.y}${rest.map((p) => ` L${p.x},${p.y}`).join("")}`;
  }
  const mid = (a: Point, b: Point) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  let d = `M${first.x},${first.y}`;
  const m0 = mid(points[0]!, points[1]!);
  d += ` L${m0.x},${m0.y}`;
  for (let i = 1; i < points.length - 1; i += 1) {
    const m = mid(points[i]!, points[i + 1]!);
    d += ` Q${points[i]!.x},${points[i]!.y} ${m.x},${m.y}`;
  }
  const last = points.at(-1)!;
  return `${d} L${last.x},${last.y}`;
}

/** Milieu de chaque segment : poignées pour créer une cassure (insérée à l'index `index`). */
export function segmentMidpoints(points: Point[]): { index: number; point: Point }[] {
  return points.slice(1).map((p, i) => ({
    index: i,
    point: { x: (points[i]!.x + p.x) / 2, y: (points[i]!.y + p.y) / 2 },
  }));
}
