import type { DocumentHandle } from "./document/handle";
import type { ViewMode } from "./document/documentView";
import { useUiStore, type Tool } from "./uiStore";

/**
 * Changement de vue et d'outil. Les outils de création n'existent que dans le MCD : la vue
 * appartient au document, l'outil à la fenêtre, d'où ces fonctions qui touchent les deux.
 */

export function showView(doc: DocumentHandle, view: ViewMode) {
  doc.view.getState().setView(view);
  if (view !== "mcd") useUiStore.getState().setTool("select");
}

export function chooseTool(doc: DocumentHandle, tool: Tool) {
  if (doc.view.getState().view === "mcd") useUiStore.getState().setTool(tool);
}
