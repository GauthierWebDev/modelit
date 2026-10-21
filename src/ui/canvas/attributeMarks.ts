import type { Association, Entity, KeyMember, ModelDocument, ModelNode, Point } from "@core/index";
import { t } from "@/i18n";
import {
  BOLD_WEIGHT,
  type DisplayOptions,
  FONT_SIZE,
  INHERITANCE_SIZE,
  MIN_WIDTH,
  type NodeLayout,
  PAD_BOTTOM,
  PAD_X,
  ROW_HEIGHT,
  TAG_FONT_SIZE,
  type TextStyle,
  TITLE_HEIGHT,
  TITLE_WEIGHT,
  textWidth,
} from "./shapeMetrics";

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

export function attributeMarks(
  node: Entity | Association,
  linkNames?: Map<string, string>,
): Map<string, AttributeMarks> {
  // Rubrique unique à elle seule (UNIQUE, ou identifiant alternatif réduit à elle seule, entière) :
  // simplement en gras. Seuls les autres identifiants alternatifs reçoivent une étiquette AI.
  const unique = new Set(node.attributes.filter((a) => a.unique).map((a) => a.id));
  const groups = alternateGroups(node, unique, linkNames);
  const marks = new Map<string, AttributeMarks>();
  for (const a of node.attributes) {
    marks.set(a.id, {
      label: a.generated ? `/${a.name}` : a.name,
      derived: Boolean(a.generated),
      bold: a.identifier || unique.has(a.id),
    });
  }
  groups.forEach((group, index) => {
    tagGroup(marks, group, groups.length > 1 ? `AI${index + 1}` : "AI");
  });
  return marks;
}

/** Étiquette AI (et préfixe, portée, expression) posée sur les rubriques d'un identifiant alternatif. */
function tagGroup(marks: Map<string, AttributeMarks>, group: AlternateGroup, tag: string) {
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
}

/** Identifiant alternatif étiqueté AI : rubriques locales, préfixes, portée, expression. */
interface AlternateGroup {
  ids: string[];
  prefixes: (number | null)[];
  scope?: string;
  expression?: string;
  condition?: string;
}

/** Identifiants alternatifs étiquetés ; ceux réduits à une rubrique entière rejoignent `unique`. */
function alternateGroups(
  node: Entity | Association,
  unique: Set<string>,
  linkNames: Map<string, string> | undefined,
): AlternateGroup[] {
  const groups: AlternateGroup[] = [];
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
    const scope = keyScope(node, key.members, linkNames);
    groups.push({
      ids: local,
      prefixes: ids.filter((id) => id !== null).map((_, i) => key.prefixes?.[i] ?? null),
      ...(scope ? { scope } : {}),
      ...(key.expression ? { expression: key.expression.expression } : {}),
    });
  }
  return groups;
}

/** Membres venus d'une patte : identifiant relatif à l'association (« unique par parent ») (O-39). */
function keyScope(node: Entity | Association, members: KeyMember[], linkNames: Map<string, string> | undefined) {
  return [
    ...new Set(
      members.flatMap((m) =>
        "linkId" in m ? [linkNames?.get(node.kind === "association" ? `entity:${m.linkId}` : m.linkId) || "#"] : [],
      ),
    ),
  ].join(", ");
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
