import type { Attribute, Rect } from "@core/index";

/** Police embarquée, identique sur tous les OS (cf. `ui/fonts.ts`). */
export const FONT_FAMILY = "'Inter Variable', sans-serif";

export const FONT_SIZE = 13;

export const TITLE_HEIGHT = 26;

export const ROW_HEIGHT = 18;

export const PAD_X = 10;

export const PAD_BOTTOM = 6;

export const MIN_WIDTH = { entity: 110, association: 100 };

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
    ({ width } = context.measureText(text));
  }
  widthCache.set(key, width);
  return width;
}

export const TAG_FONT_SIZE = 10;

/** Encombrement du triangle d'héritage (override O-18). */
export const INHERITANCE_SIZE = { width: 56, height: 56 };

// Géométrie plane, calculs du domaine (core/layout) : réexportée pour les modules de l'interface.
export { center, clipToRect, intersects, normalizeRect, type Rect, snap } from "@core/index";
