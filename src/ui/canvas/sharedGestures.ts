import type { Id, Point, Rect } from "@core/index";
import type { ConnectResult } from "@/app/linkCommands";
import type { StatusMessage } from "@/app/uiStore";
import { intersects, normalizeRect } from "./geometry";

/** Gestes communs au MCD et au MLD / MPD (audit A-01, U-5). */

/** Au-delà de ce déplacement (unités du modèle), un appui devient un glisser plutôt qu'un clic. */
export const DRAG_THRESHOLD = 4;

export const isDrag = (start: Point, point: Point) => Math.hypot(point.x - start.x, point.y - start.y) > DRAG_THRESHOLD;

/** Rectangle de sélection (O-57) : sélection conservée (`base`, Maj) et objets que le rectangle touche. */
export function marqueeSelection(start: Point, point: Point, boxes: Iterable<[Id, Rect]>, base: Id[]): Id[] {
  const rect = normalizeRect(start, point);
  const inside = [...boxes].filter(([, box]) => intersects(rect, box)).map(([id]) => id);
  return [...new Set([...base, ...inside])];
}

/** Résultat de l'outil Lien : erreur annoncée dans la barre d'état, ou objet créé sélectionné. */
export function showConnection(
  result: ConnectResult,
  ui: { notify: (status: StatusMessage | null) => void; select: (ids: Id[]) => void },
) {
  if (!result) {
    return;
  }
  if ("error" in result) {
    ui.notify({ kind: "error", text: result.error });
  } else {
    ui.select([result.created]);
  }
}
