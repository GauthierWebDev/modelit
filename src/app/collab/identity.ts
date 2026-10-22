import { getLocale } from "@/i18n";

/**
 * Identité d'un participant (O-05 §3) : nom affiché et couleur, propres au poste. Par défaut, un
 * nom aléatoire (adjectif + animal) tiré une fois, qui suit la langue de l'interface, et une
 * couleur aléatoire. Un nom saisi dans les options remplace le nom aléatoire.
 */

/** 12 couleurs lisibles en thème clair comme sombre. */
export const IDENTITY_COLORS = [
  "#e11d48",
  "#ea580c",
  "#d97706",
  "#65a30d",
  "#16a34a",
  "#0d9488",
  "#0891b2",
  "#2563eb",
  "#4f46e5",
  "#7c3aed",
  "#c026d3",
  "#db2777",
];

/** Animaux (genre grammatical pour l'accord de l'adjectif en français). */
const ANIMALS: { fr: string; en: string; feminine: boolean }[] = [
  { fr: "Castor", en: "Beaver", feminine: false },
  { fr: "Loutre", en: "Otter", feminine: true },
  { fr: "Renard", en: "Fox", feminine: false },
  { fr: "Chouette", en: "Owl", feminine: true },
  { fr: "Hérisson", en: "Hedgehog", feminine: false },
  { fr: "Baleine", en: "Whale", feminine: true },
  { fr: "Lynx", en: "Lynx", feminine: false },
  { fr: "Tortue", en: "Turtle", feminine: true },
  { fr: "Panda", en: "Panda", feminine: false },
  { fr: "Mouette", en: "Seagull", feminine: true },
  { fr: "Koala", en: "Koala", feminine: false },
  { fr: "Gazelle", en: "Gazelle", feminine: true },
];

const ADJECTIVES: { fr: [string, string]; en: string }[] = [
  { fr: ["curieux", "curieuse"], en: "Curious" },
  { fr: ["agile", "agile"], en: "Nimble" },
  { fr: ["paisible", "paisible"], en: "Calm" },
  { fr: ["malicieux", "malicieuse"], en: "Clever" },
  { fr: ["intrépide", "intrépide"], en: "Bold" },
  { fr: ["rêveur", "rêveuse"], en: "Dreamy" },
  { fr: ["joyeux", "joyeuse"], en: "Cheerful" },
  { fr: ["discret", "discrète"], en: "Quiet" },
  { fr: ["studieux", "studieuse"], en: "Studious" },
  { fr: ["vif", "vive"], en: "Swift" },
];

export interface IdentityPreferences {
  /** Nom saisi ; vide : nom aléatoire. */
  name: string;
  color: string;
  /** Tirage du nom aléatoire : [adjectif, animal]. */
  seed: [number, number];
}

const randomIndex = (length: number) => crypto.getRandomValues(new Uint32Array(1))[0]! % length;

export function newIdentity(): IdentityPreferences {
  return {
    name: "",
    color: IDENTITY_COLORS[randomIndex(IDENTITY_COLORS.length)]!,
    seed: [randomIndex(ADJECTIVES.length), randomIndex(ANIMALS.length)],
  };
}

/** Nom aléatoire dans la langue de l'interface (« Castor curieux », « Curious Beaver »). */
export function randomName(seed: [number, number], locale = getLocale()): string {
  const adjective = ADJECTIVES[seed[0] % ADJECTIVES.length]!;
  const animal = ANIMALS[seed[1] % ANIMALS.length]!;
  return locale === "fr" ? `${animal.fr} ${adjective.fr[animal.feminine ? 1 : 0]}` : `${adjective.en} ${animal.en}`;
}

/** Nom affiché : le nom saisi, sinon le nom aléatoire. */
export const displayName = (identity: IdentityPreferences) => identity.name.trim() || randomName(identity.seed);
