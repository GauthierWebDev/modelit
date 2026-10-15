import { diagramLinks, diagramNodes } from "@core/index";
import { useEffect } from "react";
import { deleteObjects, removeBend } from "@/app/commands";
import { closeDocument, newDocument, newTab, openDocument, saveDocument } from "@/app/fileCommands";
import { useUiStore, type Tool } from "@/app/uiStore";
import { chooseTool, showView } from "@/app/viewCommands";
import { activateNeighbour, activeDocument } from "@/app/workspace";
import { fitToWindow, zoomBy, zoomTo } from "@/ui/canvas/viewport";

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
export const MOD = isMac ? "⌘" : "Ctrl+";

const TOOL_KEYS: Record<string, Tool> = { v: "select", e: "entity", a: "association", h: "inheritance", l: "link" };

const isEditable = (target: EventTarget | null) =>
  target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));

/** Raccourcis clavier globaux ; ils agissent sur le document actif de la fenêtre. */
export function useShortcuts() {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // Boîte modale ouverte : les raccourcis du schéma et des fichiers sont suspendus.
      if (document.querySelector('[aria-modal="true"]')) return;
      const mod = isMac ? e.metaKey : e.ctrlKey;
      const key = e.key.toLowerCase();
      const doc = activeDocument();
      const docStore = doc.store.getState();
      const view = doc.view.getState();
      const ui = useUiStore.getState();

      // Onglets (override O-44) : Ctrl + Tab sur tous les systèmes, y compris macOS.
      if (e.ctrlKey && key === "tab") {
        e.preventDefault();
        activateNeighbour(e.shiftKey ? -1 : 1);
        return;
      }

      if (mod) {
        const actions: Record<string, () => void> = {
          s: () => void saveDocument(doc, e.shiftKey),
          o: () => void openDocument(),
          n: () => newDocument(),
          t: () => newTab(),
          w: () => void closeDocument(doc),
          e: () => ui.setExportOpen(true),
          ",": () => ui.setOptionsOpen(true),
          "1": () => showView(doc, "mcd"),
          "2": () => showView(doc, "mld"),
          "3": () => showView(doc, "mpd"),
        };
        if (!isEditable(e.target)) {
          Object.assign(actions, {
            z: () => (e.shiftKey ? docStore.redo() : docStore.undo()),
            y: () => docStore.redo(),
            a: () => view.select([...diagramNodes(docStore.doc), ...diagramLinks(docStore.doc)].map((o) => o.id)),
            i: () => {
              const all = [...diagramNodes(docStore.doc), ...diagramLinks(docStore.doc)].map((o) => o.id);
              view.select(all.filter((id) => !view.selection.includes(id)));
            },
            "0": () => zoomTo(doc, 1),
            "=": () => zoomBy(doc, 1.2),
            "+": () => zoomBy(doc, 1.2),
            "-": () => zoomBy(doc, 1 / 1.2),
          });
        }
        const action = actions[key];
        if (action) {
          e.preventDefault();
          action();
        }
        return;
      }

      if (isEditable(e.target)) return;
      if (key === "delete" || key === "backspace") {
        e.preventDefault();
        // Un point de cassure sélectionné est supprimé seul, pas son lien (override O-10).
        if (view.activeBend) removeBend(doc, view.activeBend.linkId, view.activeBend.index);
        else deleteObjects(doc, view.selection);
      } else if (key === "escape") {
        ui.setTool("select");
        view.select([]);
      } else if (key === "f" && e.shiftKey) {
        fitToWindow(doc);
      } else if (TOOL_KEYS[key] && !e.altKey) {
        chooseTool(doc, TOOL_KEYS[key]);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
