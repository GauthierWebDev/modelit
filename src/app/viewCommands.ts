import type { DocumentHandle } from "./document/handle";
import type { ViewMode } from "./document/documentView";
import { useUiStore, type Tool } from "./uiStore";

/**
 * Changement de vue et d'outil. La vue appartient au document, l'outil à la fenêtre, d'où ces
 * fonctions qui touchent les deux.
 */

/**
 * Outil utilisable dans une vue (override O-54) : Entité et Lien partout ; Association et
 * Héritage, conceptuels (leur objet n'est dessiné que dans le MCD), seulement dans le MCD.
 */
export const toolAvailable = (tool: Tool, view: ViewMode) => view === "mcd" || (tool !== "association" && tool !== "inheritance");

export function showView(doc: DocumentHandle, view: ViewMode) {
  doc.view.getState().setView(view);
  const ui = useUiStore.getState();
  if (!toolAvailable(ui.tool, view)) ui.setTool("select");
}

export function chooseTool(doc: DocumentHandle, tool: Tool) {
  if (toolAvailable(tool, doc.view.getState().view)) useUiStore.getState().setTool(tool);
}
