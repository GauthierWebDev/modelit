/**
 * Rapport de pertes du script (override O-29) : tout ce que la cible ne sait pas exprimer est
 * abandonné ou dégradé, jamais en silence.
 */

export type LossCategory =
  | "type"
  | "default"
  | "check"
  | "action"
  | "name"
  | "autoIncrement"
  | "option"
  | "collation"
  | "unsigned"
  | "domain"
  | "generated"
  | "onUpdate"
  | "index"
  | "comment"
  | "trigger"
  /** Clauses physiques sans effet sur les données : stockage, partitionnement (O-39). */
  | "physical";

export interface Loss {
  category: LossCategory;
  table: string;
  column?: string;
  message: string;
  /** P0 : comportement d'exécution changé (ex. DEFAULT d'une colonne NOT NULL abandonné) (O-42). */
  priority?: "P0";
}

/** Pertes relevées pendant une génération, dans l'ordre où elles sont rencontrées. */
export class LossReport {
  readonly entries: Loss[] = [];

  add(category: LossCategory, table: string, message: string, column?: string, priority?: "P0") {
    this.entries.push({ category, table, column, message, ...(priority ? { priority } : {}) });
  }

  /** Une perte de ce message a-t-elle déjà été relevée ? (rappels faits une seule fois) */
  has(message: string): boolean {
    return this.entries.some((l) => l.message === message);
  }
}

/** Pertes regroupées par message identique (O-37) : une ligne par perte, avec ses emplacements. */
export interface LossGroup {
  category: LossCategory;
  message: string;
  priority?: "P0";
  /** `table` ou `table.colonne`, dans l'ordre d'apparition. */
  places: string[];
}

export function groupLosses(losses: Loss[]): LossGroup[] {
  const groups: LossGroup[] = [];
  for (const l of losses) {
    const place = [l.table, l.column].filter(Boolean).join(".");
    const group = groups.find((g) => g.message === l.message && g.category === l.category && g.priority === l.priority);
    if (group) {
      if (place && !group.places.includes(place)) group.places.push(place);
    } else groups.push({ category: l.category, message: l.message, ...(l.priority ? { priority: l.priority } : {}), places: place ? [place] : [] });
  }
  return groups;
}

/** Ligne de rapport : « lieu — message », ou « message : lieu1, lieu2… » pour un groupe. */
export const formatLossGroup = (g: LossGroup) =>
  (g.priority ? `[${g.priority}] ` : "") +
  (g.places.length === 0 ? g.message : g.places.length === 1 ? `${g.places[0]} — ${g.message}` : `${g.message} : ${g.places.join(", ")}`);
