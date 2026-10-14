import { diagramLinks, diagramNodes } from "@core/index";
import { useEffect } from "react";
import { deleteObjects, removeBend } from "@/app/commands";
import { useDocumentStore } from "@/app/documentStore";
import { newDocument, openDocument, saveDocument } from "@/app/fileCommands";
import { useUiStore, type Tool } from "@/app/uiStore";
import { fitToWindow, zoomBy, zoomTo } from "@/ui/canvas/viewport";

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
export const MOD = isMac ? "⌘" : "Ctrl+";

const TOOL_KEYS: Record<string, Tool> = { v: "select", e: "entity", a: "association", h: "inheritance", l: "link" };

const isEditable = (target: EventTarget | null) =>
  target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));

/** Raccourcis clavier globaux. */
export function useShortcuts() {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // Boîte modale ouverte : les raccourcis du schéma et des fichiers sont suspendus.
      if (document.querySelector('[aria-modal="true"]')) return;
      const mod = isMac ? e.metaKey : e.ctrlKey;
      const key = e.key.toLowerCase();
      const docStore = useDocumentStore.getState();
      const ui = useUiStore.getState();

      if (mod) {
        const actions: Record<string, () => void> = {
          s: () => void saveDocument(e.shiftKey),
          o: () => void openDocument(),
          n: () => void newDocument(),
          e: () => ui.setExportOpen(true),
          ",": () => ui.setOptionsOpen(true),
          "1": () => ui.setView("mcd"),
          "2": () => ui.setView("mld"),
          "3": () => ui.setView("mpd"),
        };
        if (!isEditable(e.target)) {
          Object.assign(actions, {
            z: () => (e.shiftKey ? docStore.redo() : docStore.undo()),
            y: () => docStore.redo(),
            a: () => ui.select([...diagramNodes(docStore.doc), ...diagramLinks(docStore.doc)].map((o) => o.id)),
            i: () => {
              const all = [...diagramNodes(docStore.doc), ...diagramLinks(docStore.doc)].map((o) => o.id);
              ui.select(all.filter((id) => !ui.selection.includes(id)));
            },
            "0": () => zoomTo(1),
            "=": () => zoomBy(1.2),
            "+": () => zoomBy(1.2),
            "-": () => zoomBy(1 / 1.2),
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
        if (ui.activeBend) removeBend(ui.activeBend.linkId, ui.activeBend.index);
        else deleteObjects(ui.selection);
      } else if (key === "escape") {
        ui.setTool("select");
        ui.select([]);
      } else if (key === "f" && e.shiftKey) {
        fitToWindow(docStore.doc);
      } else if (TOOL_KEYS[key] && !e.altKey) {
        ui.setTool(TOOL_KEYS[key]);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}
