import type { Id, Point } from "@core/index";
import { selectReadOnlyTab, useCollabStore } from "@/app/collab/session";
import type { DocumentHandle } from "@/app/document/handle";
import { type Action, addAttributeAction, editingActions } from "./actionItems";
import { useContextMenu } from "./ContextMenu";
import { buildContextActions } from "./contextMenuActions";
import { clientToModel } from "./viewport";

export { type Action, type ActionItem, arrangeActions } from "./actionItems";

/**
 * Actions sur le schéma (override O-53), partagées par le bouton « ⋯ » et le menu contextuel.
 * Elles passent par les mêmes commandes que les raccourcis (O-52, app/commands).
 */

/** Actions encore permises dans une session en lecture seule. */
const READ_ONLY_ALLOWED = new Set(["copy", "selectAll", "fit", "modelSettings"]);

/** Actions du bouton « ⋯ » d'une entité ou d'une association. */
export function quickActions(doc: DocumentHandle, ownerId: Id): Action[] {
  const [copy, , duplicate, remove] = editingActions(doc, 1);
  return [addAttributeAction(doc, ownerId), copy!, duplicate!, remove!];
}

/**
 * Clic droit sur le canevas avec l'outil Sélection : `id` est l'objet sous le pointeur (null : le
 * vide). Un objet non sélectionné est sélectionné d'abord ; déjà sélectionné, la sélection reste.
 */
export function openCanvasMenu(
  doc: DocumentHandle,
  e: { clientX: number; clientY: number; preventDefault: () => void },
  id: Id | null,
) {
  e.preventDefault();
  const { selection, select } = doc.view.getState();
  if (id && !selection.includes(id)) {
    select([id]);
  }
  const point = clientToModel(doc, { x: e.clientX, y: e.clientY });
  useContextMenu.getState().open(e.clientX, e.clientY, contextActions(doc, id, point));
}

/** Contenu du menu contextuel : `id` est l'objet sous le pointeur (null : le vide), `point` le point du modèle. */
export function contextActions(doc: DocumentHandle, id: Id | null, point: Point): Action[] {
  const model = doc.store.getState().doc;
  const { view, selection } = doc.view.getState();
  const readOnly = selectReadOnlyTab(useCollabStore.getState()) === doc.id;
  const actions = buildContextActions(doc, id, point, model, view, selection);
  if (!readOnly) {
    return actions;
  }
  const allowed = actions.filter((a) => a.kind === "separator" || (a.kind === "item" && READ_ONLY_ALLOWED.has(a.id)));
  // Pas de séparateur en tête, en fin, ni doublé.
  return allowed.filter(
    (a, i) => a.kind !== "separator" || (i > 0 && i < allowed.length - 1 && allowed[i - 1]!.kind !== "separator"),
  );
}
