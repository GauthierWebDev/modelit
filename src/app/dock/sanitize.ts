import { attach, defaultLayout, newGroupId } from "./layout";
import {
  type DockLayout,
  type DropTarget,
  type FloatingGroup,
  type Group,
  HIDDEN_BY_DEFAULT,
  SECTIONS,
  type SectionId,
  ZONES,
} from "./model";

const isSection = (s: unknown): s is SectionId => SECTIONS.includes(s as SectionId);

/** Section apparue dans une version plus récente : placée sous le groupe d'une section voisine. */
const NEAR: Partial<Record<SectionId, SectionId>> = { attributes: "properties" };

/** Juste sous le groupe ancré qui contient `section`, sinon en bas de la zone de droite (O-50). */
function placeNear(layout: DockLayout, section: SectionId | undefined): DropTarget {
  for (const zone of ZONES) {
    const index = layout.zones[zone].groups.findIndex((g) => section && g.sections.includes(section));
    if (index >= 0) {
      return { kind: "zone", zone, index: index + 1 };
    }
  }
  return { kind: "zone", zone: "right", index: Number.POSITIVE_INFINITY };
}

/**
 * Disposition relue des options du poste : toute incohérence (section inconnue, en double,
 * manquante, groupe vide) est réparée, au pire en revenant à la disposition par défaut.
 */
export function sanitizeLayout(raw: unknown): DockLayout {
  try {
    const base = defaultLayout();
    if (!raw || typeof raw !== "object") {
      return base;
    }
    const input = raw as Partial<DockLayout>;
    const seen = new Set<SectionId>();
    const layout: DockLayout = { ...base, lastPlace: {}, hidden: [], floating: [] };
    for (const zone of ZONES) {
      const z = input.zones?.[zone];
      layout.zones[zone] = {
        size: typeof z?.size === "number" ? z.size : base.zones[zone].size,
        groups: (Array.isArray(z?.groups) ? z.groups : [])
          .map((g) => cleanGroup(g, seen))
          .filter((g): g is Group => g !== null),
      };
    }
    layout.floating = cleanFloating(input.floating, seen);
    layout.hidden = (Array.isArray(input.hidden) ? input.hidden : []).filter((s) => isSection(s) && !seen.has(s));
    for (const s of layout.hidden) {
      seen.add(s);
    }
    layout.lastPlace = typeof input.lastPlace === "object" && input.lastPlace ? input.lastPlace : {};
    placeMissing(layout, seen);
    const t = input.toolbar;
    layout.toolbar = {
      floating: t?.floating === true,
      position: t?.position && typeof t.position.x === "number" && typeof t.position.y === "number" ? t.position : null,
    };
    return layout;
  } catch {
    return defaultLayout();
  }
}

/** Groupe relu : sections connues et pas encore vues (notées dans `seen`) ; `null` s'il n'en reste aucune. */
function cleanGroup(g: Partial<Group> | undefined, seen: Set<SectionId>): Group | null {
  if (!(g && Array.isArray(g.sections))) {
    return null;
  }
  const sections: SectionId[] = [];
  for (const s of g.sections) {
    if (!isSection(s) || seen.has(s)) {
      continue;
    }
    seen.add(s);
    sections.push(s);
  }
  if (sections.length === 0) {
    return null;
  }
  return {
    id: typeof g.id === "string" ? g.id : newGroupId(),
    sections,
    active: isSection(g.active) && sections.includes(g.active) ? g.active : sections[0]!,
    weight: typeof g.weight === "number" && g.weight > 0 ? g.weight : 1,
    collapsed: g.collapsed === true,
  };
}

function cleanFloating(floating: unknown, seen: Set<SectionId>): FloatingGroup[] {
  const result: FloatingGroup[] = [];
  for (const g of Array.isArray(floating) ? floating : []) {
    const r = (g as Partial<FloatingGroup> | undefined)?.rect;
    // Sans géométrie lisible, le groupe est ignoré : ses sections reviennent à droite (plus bas).
    if (!(r && [r.x, r.y, r.width, r.height].every((n) => typeof n === "number"))) {
      continue;
    }
    const cleaned = cleanGroup(g, seen);
    if (cleaned) {
      result.push({ ...cleaned, rect: r });
    }
  }
  return result;
}

/**
 * Section oubliée (ajoutée par une version plus récente, ou disposition abîmée) : à droite,
 * ou masquée si elle ne s'affiche qu'à la demande.
 */
function placeMissing(layout: DockLayout, seen: Set<SectionId>) {
  for (const s of SECTIONS) {
    if (seen.has(s)) {
      continue;
    }
    if (HIDDEN_BY_DEFAULT.includes(s)) {
      layout.hidden.push(s);
      layout.lastPlace[s] ??= { group: "right" };
    } else {
      attach(layout, [s], placeNear(layout, NEAR[s]));
    }
  }
}
