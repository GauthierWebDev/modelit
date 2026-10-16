/**
 * Disposition des sections et de la barre d'outils (overrides O-45, O-46) : données pures,
 * opérations sans effet de bord. Conservée dans les options du poste (`preferencesStore`).
 *
 * Une section appartient à un seul groupe, ancré dans une zone (droite, bas) ou flottant,
 * ou bien elle est masquée. Un groupe vide n'existe pas.
 */

export const SECTIONS = ["properties", "attributes", "mld", "sql", "issues", "session"] as const;
/** Sections affichées seulement à la demande : masquées par défaut (« session » : O-05 §7). */
const HIDDEN_BY_DEFAULT: SectionId[] = ["session"];
export type SectionId = (typeof SECTIONS)[number];
export type Zone = "right" | "bottom";
export const ZONES: Zone[] = ["right", "bottom"];

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Group {
  id: string;
  sections: SectionId[];
  active: SectionId;
  /** Part de la zone occupée (poids relatif entre les groupes d'une zone). */
  weight: number;
  collapsed: boolean;
}

export interface FloatingGroup extends Group {
  /** Géométrie en coordonnées de l'écran (fenêtre native) ou de la page (navigateur). */
  rect: Rect;
}

/** Dernière place d'une section masquée, pour la lui rendre (O-46). */
export type LastPlace = { group: string } | { zone: Zone } | { rect: Rect };

export interface DockLayout {
  zones: Record<Zone, { groups: Group[]; /** Largeur (droite) ou hauteur (bas), en px. */ size: number }>;
  floating: FloatingGroup[];
  hidden: SectionId[];
  lastPlace: Partial<Record<SectionId, LastPlace>>;
  toolbar: { floating: boolean; position: { x: number; y: number } | null };
}

/** Ce qu'on glisse : un onglet (une section) ou un groupe entier. */
export type DragItem = { kind: "section"; section: SectionId; group: string } | { kind: "group"; group: string };

/** Où déposer une section ou un groupe. */
export type DropTarget =
  | { kind: "group"; group: string }
  | { kind: "zone"; zone: Zone; index: number }
  | { kind: "float"; rect: Rect };

let counter = 0;
const newGroupId = () => `g${Date.now().toString(36)}${(counter++).toString(36)}`;

const group = (sections: SectionId[], id = newGroupId()): Group => ({
  id,
  sections,
  active: sections[0]!,
  weight: 1,
  collapsed: false,
});

/**
 * Disposition par défaut : celle d'avant O-46, plus les rubriques sous les propriétés (O-50) ; la
 * section Modèle est devenue la boîte « Paramètres du modèle » (O-55).
 */
export function defaultLayout(): DockLayout {
  return {
    zones: {
      right: { groups: [group(["properties"], "right"), { ...group(["attributes"], "attributes"), weight: 1.5 }], size: 320 },
      bottom: { groups: [group(["mld", "sql", "issues"], "bottom")], size: 224 },
    },
    floating: [],
    hidden: [...HIDDEN_BY_DEFAULT],
    lastPlace: { session: { group: "right" } },
    toolbar: { floating: false, position: null },
  };
}

/** Tous les groupes, ancrés puis flottants, avec leur emplacement. */
export function allGroups(layout: DockLayout): { group: Group; zone: Zone | null }[] {
  return [
    ...ZONES.flatMap((zone) => layout.zones[zone].groups.map((g) => ({ group: g, zone }))),
    ...layout.floating.map((g) => ({ group: g as Group, zone: null })),
  ];
}

export const findGroup = (layout: DockLayout, id: string) => allGroups(layout).find((x) => x.group.id === id);

export const groupOf = (layout: DockLayout, section: SectionId) =>
  allGroups(layout).find((x) => x.group.sections.includes(section));

/** Copie modifiable (les dispositions sont de petits objets JSON). */
const clone = (layout: DockLayout): DockLayout => structuredClone(layout);

/** Retire les groupes vides et répare les onglets actifs. */
function tidy(layout: DockLayout): DockLayout {
  const fix = <G extends Group>(g: G): G => (g.sections.includes(g.active) ? g : { ...g, active: g.sections[0]! });
  for (const zone of ZONES) layout.zones[zone].groups = layout.zones[zone].groups.filter((g) => g.sections.length).map(fix);
  layout.floating = layout.floating.filter((g) => g.sections.length).map(fix);
  return layout;
}

/** Retire une section de son groupe ; renvoie la place qu'elle occupait. */
function detach(layout: DockLayout, section: SectionId): LastPlace | null {
  for (const zone of ZONES) {
    for (const g of layout.zones[zone].groups) {
      if (!g.sections.includes(section)) continue;
      g.sections = g.sections.filter((s) => s !== section);
      return g.sections.length ? { group: g.id } : { zone };
    }
  }
  for (const g of layout.floating) {
    if (!g.sections.includes(section)) continue;
    g.sections = g.sections.filter((s) => s !== section);
    return g.sections.length ? { group: g.id } : { rect: g.rect };
  }
  layout.hidden = layout.hidden.filter((s) => s !== section);
  return null;
}

/** Insère des sections (ou un groupe entier) à la cible. */
function attach(layout: DockLayout, sections: SectionId[], target: DropTarget, base?: Group): DockLayout {
  const moved: Group = { ...(base ?? group(sections)), sections, active: base?.active ?? sections[0]!, collapsed: false };
  if (target.kind === "group") {
    const found = findGroup(layout, target.group);
    if (!found) return attach(layout, sections, { kind: "zone", zone: "right", index: Infinity }, base);
    found.group.sections.push(...sections.filter((s) => !found.group.sections.includes(s)));
    found.group.active = sections[0]!;
    found.group.collapsed = false;
  } else if (target.kind === "zone") {
    const groups = layout.zones[target.zone].groups;
    groups.splice(Math.max(0, Math.min(groups.length, target.index)), 0, { ...moved, weight: 1 });
  } else {
    layout.floating.push({ ...moved, rect: target.rect });
  }
  return layout;
}

/** Déplace une section (glisser un onglet, O-46). */
export function moveSection(layout: DockLayout, section: SectionId, target: DropTarget): DockLayout {
  const next = clone(layout);
  const source = groupOf(next, section);
  if (target.kind === "group" && source?.group.id === target.group) return layout;
  detach(next, section);
  return tidy(attach(next, [section], target));
}

/** Déplace un groupe entier (glisser la poignée, O-46). */
export function moveGroup(layout: DockLayout, id: string, target: Exclude<DropTarget, { kind: "group" }>): DockLayout {
  const next = clone(layout);
  const found = findGroup(next, id);
  if (!found) return layout;
  const { group: g, zone } = found;
  if (zone) {
    const groups = next.zones[zone].groups;
    const from = groups.indexOf(g);
    groups.splice(from, 1);
    // Même zone, plus loin : l'indice cible tient compte du groupe retiré.
    if (target.kind === "zone" && target.zone === zone && target.index > from) target = { ...target, index: target.index - 1 };
  } else {
    next.floating = next.floating.filter((x) => x.id !== id);
  }
  const { rect: _rect, ...base } = g as FloatingGroup;
  return tidy(attach(next, [...g.sections], target, base));
}

export function setActive(layout: DockLayout, id: string, section: SectionId): DockLayout {
  const next = clone(layout);
  const found = findGroup(next, id);
  if (found?.group.sections.includes(section)) {
    found.group.active = section;
    found.group.collapsed = false;
  }
  return next;
}

export function toggleCollapsed(layout: DockLayout, id: string): DockLayout {
  const next = clone(layout);
  const found = findGroup(next, id);
  if (found) found.group.collapsed = !found.group.collapsed;
  return next;
}

/** Masque une section ; sa place est retenue. */
export function hideSection(layout: DockLayout, section: SectionId): DockLayout {
  if (layout.hidden.includes(section)) return layout;
  const next = clone(layout);
  const place = detach(next, section);
  if (place) next.lastPlace[section] = place;
  next.hidden.push(section);
  return tidy(next);
}

/**
 * Ferme un groupe (✕ d'un groupe flottant, ou menu ⌄) : ses sections sont masquées et retiennent
 * la place du groupe (zone, ou position flottante).
 */
export function closeGroup(layout: DockLayout, id: string): DockLayout {
  const next = clone(layout);
  const found = findGroup(next, id);
  if (!found) return layout;
  const place: LastPlace = found.zone ? { zone: found.zone } : { rect: (found.group as FloatingGroup).rect };
  for (const s of [...found.group.sections]) {
    detach(next, s);
    next.lastPlace[s] = place;
    next.hidden.push(s);
  }
  return tidy(next);
}

/** Réaffiche une section à sa dernière place, sinon dans la zone de droite. */
export function showSection(layout: DockLayout, section: SectionId): DockLayout {
  if (!layout.hidden.includes(section)) return layout;
  const next = clone(layout);
  next.hidden = next.hidden.filter((s) => s !== section);
  const place = next.lastPlace[section];
  delete next.lastPlace[section];
  // Groupe flottant déjà rouvert à la même place (sections d'un groupe fermé) : on le rejoint.
  const sameRect = place && "rect" in place ? next.floating.find((g) => JSON.stringify(g.rect) === JSON.stringify(place.rect)) : undefined;
  const target: DropTarget =
    place && "group" in place && findGroup(next, place.group)
      ? { kind: "group", group: place.group }
      : sameRect
        ? { kind: "group", group: sameRect.id }
        : place && "rect" in place
          ? { kind: "float", rect: place.rect }
          : { kind: "zone", zone: place && "zone" in place ? place.zone : "right", index: Infinity };
  return tidy(attach(next, [section], target));
}

export function setZoneSize(layout: DockLayout, zone: Zone, size: number): DockLayout {
  const next = clone(layout);
  next.zones[zone].size = Math.round(Math.max(160, Math.min(900, size)));
  return next;
}

/** Séparateur entre les groupes `index` et `index + 1` d'une zone : transfère du poids. */
export function setWeights(layout: DockLayout, zone: Zone, index: number, before: number, after: number): DockLayout {
  const next = clone(layout);
  const groups = next.zones[zone].groups;
  if (groups[index] && groups[index + 1]) {
    groups[index]!.weight = Math.max(0.1, before);
    groups[index + 1]!.weight = Math.max(0.1, after);
  }
  return next;
}

export function setFloatingRect(layout: DockLayout, id: string, rect: Rect): DockLayout {
  const next = clone(layout);
  const g = next.floating.find((x) => x.id === id);
  if (g) g.rect = { ...rect, width: Math.max(220, rect.width), height: Math.max(120, rect.height) };
  return next;
}

export function setToolbar(layout: DockLayout, toolbar: Partial<DockLayout["toolbar"]>): DockLayout {
  return { ...layout, toolbar: { ...layout.toolbar, ...toolbar } };
}

/** Ramène sur `fallback` (la fenêtre principale) ce qui n'est visible sur aucun écran. */
export function keepOnScreen(layout: DockLayout, screens: Rect[], fallback: Rect): DockLayout {
  const visible = (r: Rect) =>
    screens.some((s) => r.x + 40 < s.x + s.width && r.x + r.width - 40 > s.x && r.y >= s.y - 10 && r.y + 20 < s.y + s.height);
  const next = clone(layout);
  next.floating.forEach((g, i) => {
    if (!visible(g.rect)) g.rect = { ...g.rect, x: fallback.x + fallback.width - g.rect.width - 40 - i * 24, y: fallback.y + 80 + i * 24 };
  });
  const p = next.toolbar.position;
  if (p && !visible({ x: p.x, y: p.y, width: 200, height: 40 })) next.toolbar.position = null;
  return next;
}

const isSection = (s: unknown): s is SectionId => SECTIONS.includes(s as SectionId);

/** Section apparue dans une version plus récente : placée sous le groupe d'une section voisine. */
const NEAR: Partial<Record<SectionId, SectionId>> = { attributes: "properties" };

/** Juste sous le groupe ancré qui contient `section`, sinon en bas de la zone de droite (O-50). */
function placeNear(layout: DockLayout, section: SectionId | undefined): DropTarget {
  for (const zone of ZONES) {
    const index = layout.zones[zone].groups.findIndex((g) => section && g.sections.includes(section));
    if (index >= 0) return { kind: "zone", zone, index: index + 1 };
  }
  return { kind: "zone", zone: "right", index: Infinity };
}

/**
 * Disposition relue des options du poste : toute incohérence (section inconnue, en double,
 * manquante, groupe vide) est réparée, au pire en revenant à la disposition par défaut.
 */
export function sanitizeLayout(raw: unknown): DockLayout {
  try {
    const base = defaultLayout();
    if (!raw || typeof raw !== "object") return base;
    const input = raw as Partial<DockLayout>;
    const seen = new Set<SectionId>();
    const cleanGroup = (g: Partial<Group> | undefined): Group | null => {
      if (!g || !Array.isArray(g.sections)) return null;
      const sections: SectionId[] = [];
      for (const s of g.sections) {
        if (!isSection(s) || seen.has(s)) continue;
        seen.add(s);
        sections.push(s);
      }
      if (!sections.length) return null;
      return {
        id: typeof g.id === "string" ? g.id : newGroupId(),
        sections,
        active: isSection(g.active) && sections.includes(g.active) ? g.active : sections[0]!,
        weight: typeof g.weight === "number" && g.weight > 0 ? g.weight : 1,
        collapsed: g.collapsed === true,
      };
    };
    const layout: DockLayout = { ...base, lastPlace: {}, hidden: [], floating: [] };
    for (const zone of ZONES) {
      const z = input.zones?.[zone];
      layout.zones[zone] = {
        size: typeof z?.size === "number" ? z.size : base.zones[zone].size,
        groups: (Array.isArray(z?.groups) ? z.groups : []).map(cleanGroup).filter((g): g is Group => g !== null),
      };
    }
    for (const g of Array.isArray(input.floating) ? input.floating : []) {
      const r = (g as Partial<FloatingGroup> | undefined)?.rect;
      // Sans géométrie lisible, le groupe est ignoré : ses sections reviennent à droite (plus bas).
      if (!r || ![r.x, r.y, r.width, r.height].every((n) => typeof n === "number")) continue;
      const cleaned = cleanGroup(g);
      if (cleaned) layout.floating.push({ ...cleaned, rect: r });
    }
    layout.hidden = (Array.isArray(input.hidden) ? input.hidden : []).filter((s) => isSection(s) && !seen.has(s));
    layout.hidden.forEach((s) => seen.add(s));
    layout.lastPlace = typeof input.lastPlace === "object" && input.lastPlace ? input.lastPlace : {};
    // Section oubliée (ajoutée par une version plus récente, ou disposition abîmée) : à droite,
    // ou masquée si elle ne s'affiche qu'à la demande.
    for (const s of SECTIONS) {
      if (seen.has(s)) continue;
      if (HIDDEN_BY_DEFAULT.includes(s)) {
        layout.hidden.push(s);
        layout.lastPlace[s] ??= { group: "right" };
      } else attach(layout, [s], placeNear(layout, NEAR[s]));
    }
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
