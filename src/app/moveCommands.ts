import { applyMove, type Id, moveOrigins, type Point } from "@core/index";
import type { MessageKey } from "@/i18n";
import type { DocumentHandle } from "./document/handle";

/**
 * Déplacement d'objets en une transaction (glisser dans le MCD ou le MLD / MPD, flèches du clavier) :
 * les cassures des traits dont les deux extrémités bougent suivent ; une seule entrée d'historique à la
 * validation ; seule la géométrie change, MLD et SQL ne sont pas recalculés (J-01, phase 3 ; audit A-01, U-1).
 */
export interface MoveSession {
  /** Nombre d'objets déplacés (libellé de l'historique : objet ou sélection). */
  readonly count: number;
  /** Décalage total depuis le début du déplacement. */
  update: (offset: Point) => void;
  commit: (label: MessageKey) => void;
  cancel: () => void;
}

/** Commence le déplacement de `ids`, aligné sur `grid` (null : sans alignement) ; `null` s'il n'y a rien à déplacer. */
export function beginMove(doc: DocumentHandle, ids: Iterable<Id>, grid: number | null): MoveSession | null {
  const store = () => doc.store.getState();
  const origins = moveOrigins(store().doc, ids);
  if (origins.positions.size === 0) {
    return null;
  }
  store().begin();
  return {
    count: origins.positions.size,
    update: (offset) => store().preview((d) => applyMove(d.layout, origins, offset, grid)),
    commit: (label) => store().commit(label),
    cancel: () => store().cancel(),
  };
}
