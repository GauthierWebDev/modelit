import { stripAccents } from "./typology";

/**
 * Clé de comparaison de la recherche (override O-64) : minuscules, accents ramenés aux lettres de base, toute suite
 * de caractères autres que lettres et chiffres → « - ». « Bon_De Commande » → « bon-de-commande ».
 */
export function searchKey(text: string): string {
  return stripAccents(text)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-");
}

/**
 * Un des noms d'un objet contient-il la recherche ? Séparateurs en début et fin de recherche ignorés (« client »
 * suivi d'un espace trouve « CLIENT ») ; recherche vide : rien.
 */
export function matchesSearch(names: readonly string[], query: string): boolean {
  const key = searchKey(query).replace(/^-+|-+$/g, "");
  return key !== "" && names.some((name) => searchKey(name).includes(key));
}
