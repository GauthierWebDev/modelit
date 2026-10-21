import type {
  Association,
  Attribute,
  Entity,
  Inheritance,
  InheritanceLink,
  Link,
  ModelDocument,
  ModelNode,
  Point,
} from "@core/index";
import { t } from "@/i18n";

/** Mise en page des objets du schéma, en coordonnées du modèle. */

/** Police embarquée, identique sur tous les OS (cf. `ui/fonts.ts`). */
export const FONT_FAMILY = "'Inter Variable', sans-serif";
export const FONT_SIZE = 13;
export const TITLE_HEIGHT = 26;
export const ROW_HEIGHT = 18;
export const PAD_X = 10;
const PAD_BOTTOM = 6;
const MIN_WIDTH = { entity: 110, association: 100 };

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface AttributeRow {
  attribute: Attribute;
  y: number;
}

export interface NodeLayout extends Rect {
  rows: AttributeRow[];
}

/** Les types ne sont jamais affichés dans le MCD (override O-11). */
export interface DisplayOptions {
  showAttributes: boolean;
}

let context: CanvasRenderingContext2D | null = null;
const widthCache = new Map<string, number>();

/** Graisse des titres, et du gras des rubriques / colonnes (clés, unicité) : nettement marqué. */
export const TITLE_WEIGHT = 600;
export const BOLD_WEIGHT = 700;

/** Style d'un nom de rubrique ou de colonne (gras, italique). */
export interface TextStyle {
  weight?: number;
  italic?: boolean;
}

export function textWidth(text: string, style: TextStyle = {}): number {
  const { weight = 400, italic = false } = style;
  const key = `${weight}${italic ? "i" : "n"}${text}`;
  const cached = widthCache.get(key);
  if (cached !== undefined) {
    return cached;
  }
  // Hors navigateur (tests) : estimation, faute de canvas pour mesurer.
  if (typeof document !== "undefined") {
    context ??= document.createElement("canvas").getContext("2d");
  }
  let width = text.length * FONT_SIZE * (weight >= BOLD_WEIGHT ? 0.65 : 0.6);
  if (context) {
    context.font = `${italic ? "italic " : ""}${weight} ${FONT_SIZE}px ${FONT_FAMILY}`;
    width = context.measureText(text).width;
  }
  widthCache.set(key, width);
  return width;
}

/**
 * Marques d'une rubrique dans le MCD (O-36) : donnée calculée (« / » et italique), discriminant
 * ou rubrique unique à elle seule (gras), membre d'un identifiant alternatif composé, sur préfixe,
 * sur expression ou relatif (souligné en pointillé + étiquette AI, AI1, AI2…), sur préfixe (⚠).
 */
export interface AttributeMarks {
  label: string;
  derived: boolean;
  /** Discriminant ou rubrique unique (UNIQUE, ou identifiant alternatif réduit à elle seule) : en gras. */
  bold: boolean;
  /**
   * Étiquette de l'identifiant alternatif (AI, AI1…), et s'il porte sur un préfixe ; `scope` :
   * associations dont la clé fait partie de l'identifiant (unique par parent) ; `expression` :
   * unicité sur expression (LOWER(email)) ; `condition` : unicité conditionnelle (O-39).
   */
  alternate?: { tag: string; prefix?: number; scope?: string; expression?: string; condition?: string };
}

/** Texte affiché à côté de la rubrique : AI1, « AI par parent », « AI = LOWER(email) » (O-39). */
export function alternateText(alternate: NonNullable<AttributeMarks["alternate"]>): string {
  let text = alternate.scope ? t("mcd.alternateScope", { tag: alternate.tag, scope: alternate.scope }) : alternate.tag;
  if (alternate.expression) {
    text += ` = ${alternate.expression}`;
  }
  return text;
}

/**
 * Portée des membres d'identifiants alternatifs venus d'une patte (O-39, O-41) : nom de l'association
 * de la patte (clé `linkId`, pour une entité) et nom de son entité (clé `entity:linkId`, pour une
 * association dont c'est une patte).
 */
export function associationNamesByLink(
  doc: Pick<ModelDocument, "links" | "associations"> & Partial<Pick<ModelDocument, "entities">>,
): Map<string, string> {
  const associations = new Map(doc.associations.map((a) => [a.id, a.name]));
  const entities = new Map((doc.entities ?? []).map((e) => [e.id, e.name]));
  return new Map(
    doc.links.flatMap(
      (l) =>
        [
          [l.id, associations.get(l.associationId) ?? ""],
          [`entity:${l.id}`, entities.get(l.entityId) ?? ""],
        ] as [string, string][],
    ),
  );
}

export const TAG_FONT_SIZE = 10;

export function attributeMarks(
  node: Entity | Association,
  linkNames?: Map<string, string>,
): Map<string, AttributeMarks> {
  // Rubrique unique à elle seule (UNIQUE, ou identifiant alternatif réduit à elle seule, entière) :
  // simplement en gras. Seuls les autres identifiants alternatifs reçoivent une étiquette AI.
  type Group = { ids: string[]; prefixes: (number | null)[]; scope?: string; expression?: string; condition?: string };
  const groups: Group[] = [];
  const unique = new Set(node.attributes.filter((a) => a.unique).map((a) => a.id));
  for (const key of node.alternateKeys ?? []) {
    // Unicité conditionnelle (index filtré à prédicat autre que IS NOT NULL) : pas un identifiant
    // alternatif ; elle est signalée par un avertissement (O-42).
    if (key.where) {
      continue;
    }
    const ids = key.members.map((m) => ("attributeId" in m ? m.attributeId : null));
    const local = ids.filter((id): id is string => id !== null);
    if (local.length === 0) {
      continue;
    }
    if (ids.length === 1 && local.length === 1 && !key.prefixes?.[0] && !key.expression) {
      unique.add(local[0]!);
      continue;
    }
    // Membres venus d'une patte : identifiant relatif à l'association (« unique par parent ») (O-39).
    const scope = [
      ...new Set(
        key.members.flatMap((m) =>
          "linkId" in m ? [linkNames?.get(node.kind === "association" ? `entity:${m.linkId}` : m.linkId) || "#"] : [],
        ),
      ),
    ].join(", ");
    groups.push({
      ids: local,
      prefixes: ids.filter((id) => id !== null).map((_, i) => key.prefixes?.[i] ?? null),
      ...(scope ? { scope } : {}),
      ...(key.expression ? { expression: key.expression.expression } : {}),
    });
  }
  const marks = new Map<string, AttributeMarks>();
  for (const a of node.attributes) {
    marks.set(a.id, {
      label: a.generated ? `/${a.name}` : a.name,
      derived: Boolean(a.generated),
      bold: a.identifier || unique.has(a.id),
    });
  }
  groups.forEach((group, index) => {
    const tag = groups.length > 1 ? `AI${index + 1}` : "AI";
    group.ids.forEach((id, i) => {
      const mark = marks.get(id);
      if (mark && !mark.alternate) {
        mark.alternate = {
          tag,
          ...(group.prefixes[i] ? { prefix: group.prefixes[i]! } : {}),
          ...(group.scope ? { scope: group.scope } : {}),
          ...(group.expression ? { expression: group.expression } : {}),
          ...(group.condition ? { condition: group.condition } : {}),
        };
      }
    });
  });
  return marks;
}

/** Style du nom d'une rubrique : gras (discriminant, unique), italique (donnée calculée). */
export function attributeStyle(mark: AttributeMarks): TextStyle {
  return { weight: mark.bold ? BOLD_WEIGHT : 400, italic: mark.derived };
}

/** Largeur d'une rubrique et de ses marques. */
export function attributeWidth(mark: AttributeMarks): number {
  let width = textWidth(mark.label, attributeStyle(mark));
  if (mark.alternate) {
    width +=
      6 + (textWidth(alternateText(mark.alternate)) * TAG_FONT_SIZE) / FONT_SIZE + (mark.alternate.prefix ? 12 : 0);
  }
  return width;
}

/** Encombrement du triangle d'héritage (override O-18). */
export const INHERITANCE_SIZE = { width: 56, height: 56 };

/** Encombrement d'un objet placé en `position` (coin haut-gauche, `doc.layout`). */
export function nodeLayout(
  node: ModelNode,
  position: Point,
  display: DisplayOptions,
  linkNames?: Map<string, string>,
): NodeLayout {
  if (node.kind === "inheritance") {
    return { x: position.x, y: position.y, ...INHERITANCE_SIZE, rows: [] };
  }
  const attributes = display.showAttributes ? node.attributes : [];
  const rows = attributes.map((attribute, i) => ({ attribute, y: TITLE_HEIGHT + 4 + i * ROW_HEIGHT }));
  const marks = attributeMarks(node, linkNames);
  const contentWidth = Math.max(
    textWidth(node.name, { weight: TITLE_WEIGHT }),
    ...rows.map((r) => attributeWidth(marks.get(r.attribute.id)!)),
  );
  const width = Math.ceil(Math.max(MIN_WIDTH[node.kind], contentWidth + 2 * PAD_X));
  const height = rows.length > 0 ? TITLE_HEIGHT + 4 + rows.length * ROW_HEIGHT + PAD_BOTTOM : TITLE_HEIGHT + 10;
  return { x: position.x, y: position.y, width, height, rows };
}

export const center = (r: Rect): Point => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 });

/** Point où le segment centre(r) → `toward` sort du rectangle. */
export function clipToRect(r: Rect, toward: Point): Point {
  const c = center(r);
  const dx = toward.x - c.x;
  const dy = toward.y - c.y;
  if (dx === 0 && dy === 0) {
    return c;
  }
  const scale = Math.min(
    dx === 0 ? Infinity : r.width / 2 / Math.abs(dx),
    dy === 0 ? Infinity : r.height / 2 / Math.abs(dy),
  );
  return { x: c.x + dx * scale, y: c.y + dy * scale };
}

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
    if (!touches(candidate, entity) && !touches(candidate, association)) {
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
    if (!a || !e) {
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
    const to = points.at(-1)!;
    const before = points.at(-2)!;
    const len = Math.hypot(to.x - before.x, to.y - before.y) || 1;
    const ux = (to.x - before.x) / len;
    const uy = (to.y - before.y) / len;
    const label = { x: to.x - ux * 22 - uy * 12, y: to.y - uy * 22 + ux * 12 };
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
    if (!triangle || !entity || !h) {
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

export const snap = (value: number, grid: number | null) => (grid ? Math.round(value / grid) * grid : value);

export const intersects = (a: Rect, b: Rect) =>
  a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;

export function normalizeRect(p: Point, q: Point): Rect {
  return { x: Math.min(p.x, q.x), y: Math.min(p.y, q.y), width: Math.abs(p.x - q.x), height: Math.abs(p.y - q.y) };
}
