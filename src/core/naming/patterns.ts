/**
 * Schémas de nommage des discriminants et des clés (overrides O-13, O-26).
 *
 * Un schéma est un texte contenant des variables entre chevrons : `id_<table>`, `code <entity>`…
 * Il est enregistré sous forme canonique (variables en anglais), et saisi ou affiché avec les
 * alias de n'importe quelle langue : `<entité>` et `<entity>` désignent la même variable.
 *
 * Règle des alias : un alias qui désignerait deux variables différentes (dans des langues
 * différentes) est ambigu ; il est alors désactivé dans toutes les langues. Un alias identique
 * pour la même variable dans plusieurs langues (ex. `<table>`) n'est pas ambigu.
 * Les alias sont comparés sans tenir compte de la casse ni des accents.
 */

export type PatternVariable = "entity" | "table" | "column" | "name";
export type PatternLanguage = "fr" | "en";

/** Alias de chaque variable, par langue (le premier alias de la langue est celui affiché). */
export const PATTERN_ALIASES: Record<PatternVariable, Record<PatternLanguage, string[]>> = {
  entity: { fr: ["entité"], en: ["entity"] },
  table: { fr: ["table"], en: ["table"] },
  column: { fr: ["colonne"], en: ["column"] },
  name: { fr: ["nom"], en: ["name"] },
};

/** Variables utilisables selon le schéma. */
export type PatternKind = "discriminant" | "primaryKey" | "foreignKey";

export const PATTERN_VARIABLES: Record<PatternKind, PatternVariable[]> = {
  // Nom conceptuel du discriminant automatique.
  discriminant: ["entity"],
  // Nom logique de la clé primaire issue du discriminant automatique.
  primaryKey: ["table", "name", "entity"],
  // Nom d'une clé étrangère : table et colonne référencées.
  foreignKey: ["table", "column"],
};

const normalize = (alias: string) =>
  alias
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim()
    .toLowerCase();

/** Table alias normalisé → variable, alias ambigus exclus. */
export function aliasIndex(
  aliases: Record<PatternVariable, Record<string, string[]>> = PATTERN_ALIASES,
): Map<string, PatternVariable> {
  const owners = new Map<string, Set<PatternVariable>>();
  for (const [variable, byLanguage] of Object.entries(aliases) as [PatternVariable, Record<string, string[]>][]) {
    // Le nom canonique est toujours un alias de sa variable.
    for (const alias of [variable, ...Object.values(byLanguage).flat()]) {
      const key = normalize(alias);
      owners.set(key, (owners.get(key) ?? new Set()).add(variable));
    }
  }
  const index = new Map<string, PatternVariable>();
  for (const [alias, variables] of owners) {
    if (variables.size === 1) {
      index.set(alias, [...variables][0]!);
    }
  }
  return index;
}

const INDEX = aliasIndex();
const VARIABLE = /<([^<>]+)>/g;

export type ParsedPattern =
  | { ok: true; pattern: string }
  | { ok: false; empty: true }
  | { ok: false; unknown: string[] };

/** Schéma saisi (alias de toute langue) → schéma canonique, en vérifiant les variables permises. */
export function parsePattern(input: string, kind: PatternKind, index = INDEX): ParsedPattern {
  const text = input.trim();
  if (!text) {
    return { ok: false, empty: true };
  }
  const allowed = PATTERN_VARIABLES[kind];
  const unknown: string[] = [];
  const pattern = text.replace(VARIABLE, (match, alias: string) => {
    const variable = index.get(normalize(alias));
    if (!(variable && allowed.includes(variable))) {
      unknown.push(match);
      return match;
    }
    return `<${variable}>`;
  });
  return unknown.length > 0 ? { ok: false, unknown } : { ok: true, pattern };
}

/** Schéma canonique affiché dans une langue. */
export function displayPattern(pattern: string, language: PatternLanguage): string {
  return pattern.replace(VARIABLE, (match, variable: string) =>
    variable in PATTERN_ALIASES ? `<${PATTERN_ALIASES[variable as PatternVariable][language][0]}>` : match,
  );
}

/** Applique un schéma canonique. Une variable sans valeur est remplacée par une chaîne vide. */
export function applyPattern(pattern: string, values: Partial<Record<PatternVariable, string>>): string {
  return pattern.replace(VARIABLE, (match, variable: string) =>
    variable in PATTERN_ALIASES ? (values[variable as PatternVariable] ?? "") : match,
  );
}

export const usesVariable = (pattern: string, variable: PatternVariable) => pattern.includes(`<${variable}>`);

/** Schémas des versions précédentes (`[Classe]`, `[Table]`, `[Colonne]`, `[Nom]`) → syntaxe actuelle. */
export function migrateLegacyPattern(pattern: string): string {
  return pattern
    .replaceAll("[Classe]", "<entity>")
    .replaceAll("[Table]", "<table>")
    .replaceAll("[Colonne]", "<column>")
    .replaceAll("[Nom]", "<name>");
}
