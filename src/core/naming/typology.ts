/**
 * Transformation des noms conceptuels en identifiants logiques.
 */

export type Typology =
  | "standard"
  | "snake"
  | "screamingSnake"
  | "camel"
  | "pascal"
  | "conceptual";

/** Typologies proposées (libellés : traduits par l'interface). */
export const TYPOLOGIES: Typology[] = ["standard", "snake", "screamingSnake", "camel", "pascal", "conceptual"];

export interface NamingOptions {
  typology: Typology;
  stripAccents: boolean;
}

export function stripAccents(s: string): string {
  return s.normalize("NFD").replace(/\p{Diacritic}/gu, "");
}

const words = (s: string) => s.split(/[\s_]+/).filter(Boolean);
const capitalize = (w: string) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();

export function applyTypology(name: string, typology: Typology): string {
  const w = words(name.trim());
  switch (typology) {
    case "conceptual":
      return name;
    // @déduit : espaces remplacés par « _ », casse conservée.
    case "standard":
      return w.join("_");
    case "snake":
      return w.map((x) => x.toLowerCase()).join("_");
    case "screamingSnake":
      return w.map((x) => x.toUpperCase()).join("_");
    case "camel":
      return w.map((x, i) => (i === 0 ? x.toLowerCase() : capitalize(x))).join("");
    case "pascal":
      return w.map(capitalize).join("");
  }
}

/** Nom logique : le nom logique saisi prime ; sinon le nom conceptuel transformé. */
export function logicalName(
  item: { name: string; logicalName?: string },
  options: NamingOptions,
): string {
  const explicit = item.logicalName?.trim();
  if (explicit) return explicit;
  // Ordre accents → typologie : non documenté, choix provisoire.
  const base = options.stripAccents ? stripAccents(item.name) : item.name;
  return applyTypology(base, options.typology);
}
