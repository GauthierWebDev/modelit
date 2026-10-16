import { extractFragment, type Id, type Point, parseFragment, pasteFragment } from "@core/index";
import { selectReadOnlyTab, useCollabStore } from "./collab/session";
import { deleteObjects } from "./commands";
import type { DocumentHandle } from "./document/handle";

/**
 * Copier, couper, coller, dupliquer (override O-52). Le texte copié est un fragment JSON
 * (`core/model/clipboard.ts`) : l'interface le place dans le presse-papiers du système ; le
 * dernier copié est aussi gardé ici, en repli si le système ne transmet pas l'événement.
 */

let lastCopied: string | null = null;

const readOnly = (doc: DocumentHandle) => selectReadOnlyTab(useCollabStore.getState()) === doc.id;
const selection = (doc: DocumentHandle): Id[] => doc.view.getState().selection;

/** Copie la sélection ; renvoie le texte à placer dans le presse-papiers, ou null si rien à copier. */
export function copySelection(doc: DocumentHandle): string | null {
  const fragment = extractFragment(doc.store.getState().doc, selection(doc));
  if (!fragment) return null;
  lastCopied = JSON.stringify(fragment);
  return lastCopied;
}

/** Copie puis supprime la sélection (une entrée d'historique : « Couper »). */
export function cutSelection(doc: DocumentHandle): string | null {
  if (readOnly(doc)) return null;
  const text = copySelection(doc);
  if (text) deleteObjects(doc, selection(doc), "history.cut");
  return text;
}

/** Une copie a été faite dans cette instance (« Coller ici », O-53). */
export const hasCopy = () => lastCopied !== null;

/**
 * Colle un fragment ; `text` absent : le dernier copié ; `at` : coin supérieur gauche des objets
 * collés (« Coller ici »). Faux si le contenu n'est pas un fragment.
 */
export function pasteText(doc: DocumentHandle, text: string | null = lastCopied, at?: Point): boolean {
  if (readOnly(doc) || !text) return false;
  const fragment = parseFragment(text);
  if (!fragment) return false;
  let pasted: Id[] = [];
  doc.store.getState().change("history.paste", (d) => void (pasted = pasteFragment(d, fragment, at)));
  doc.view.getState().select(pasted);
  return true;
}

/** Copier-coller dans le même document, sans toucher au presse-papiers. */
export function duplicateSelection(doc: DocumentHandle): boolean {
  if (readOnly(doc)) return false;
  const fragment = extractFragment(doc.store.getState().doc, selection(doc));
  if (!fragment) return false;
  let pasted: Id[] = [];
  doc.store.getState().change("history.duplicate", (d) => void (pasted = pasteFragment(d, fragment)));
  doc.view.getState().select(pasted);
  return true;
}
