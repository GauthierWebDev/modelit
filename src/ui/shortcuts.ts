import { diagramLinks, diagramNodes } from "@core/index";
import { useEffect } from "react";
import { selectReadOnlyTab, useCollabStore } from "@/app/collab/session";
import { deleteObjects, removeBend } from "@/app/commands";
import { closeDocument, newDocument, newTab, openDocument, saveDocument } from "@/app/fileCommands";
import { type Tool, useUiStore } from "@/app/uiStore";
import { chooseTool, showView } from "@/app/viewCommands";
import { activateNeighbour, activeDocument } from "@/app/workspace";
import { endNudge, nudgeSelection } from "@/ui/canvas/arrange";
import { fitToWindow, zoomBy, zoomTo } from "@/ui/canvas/viewport";
import { mainCommand } from "@/ui/windows/mainCommands";

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
export const MOD = isMac ? "⌘" : "Ctrl+";
export const MODEL_SETTINGS_SHORTCUT = isMac ? "⌥⌘," : "Ctrl+Alt+,";

/**
 * Touche physique de la virgule (O-55) : avec ⌥ (macOS) ou Ctrl + Alt (AltGr), `key` ne donne plus
 * « , », et `code` dépend de la disposition (« Comma » en QWERTY, « KeyM » en AZERTY). Elle est apprise
 * à chaque virgule tapée ; dans l'application macOS, le menu natif porte aussi le raccourci.
 */
let commaCode = "Comma";

/** Flèches : déplacement de la sélection au clavier (override O-57). */
const ARROWS: Record<string, [number, number]> = {
  arrowleft: [-1, 0],
  arrowright: [1, 0],
  arrowup: [0, -1],
  arrowdown: [0, 1],
};

/** Le schéma a le focus (ou rien) : les flèches déplacent la sélection, pas une liste ou un champ. */
const onDiagram = (target: EventTarget | null) =>
  target === document.body || (target instanceof Element && target.closest("[data-canvas]") !== null);

const TOOL_KEYS: Record<string, Tool> = { v: "select", e: "entity", a: "association", h: "inheritance", l: "link" };

const isEditable = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));

/** Raccourcis clavier globaux ; ils agissent sur le document actif de la fenêtre. */
export function useShortcuts() {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === ",") {
        commaCode = e.code;
      }
      // Boîte modale ouverte : les raccourcis du schéma et des fichiers sont suspendus.
      if (document.querySelector('[aria-modal="true"]')) {
        return;
      }
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

      if (mod && e.altKey && (e.code === commaCode || e.key === ",")) {
        e.preventDefault();
        ui.setModelSettingsOpen(true);
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
        // Micro du vocal (O-48) : ⌘/Ctrl + Maj + M, y compris pendant une saisie (chat).
        if (key === "m" && e.shiftKey) {
          const voice = useCollabStore.getState().voice;
          if (voice.status === "on" && voice.mic) {
            e.preventDefault();
            mainCommand({ name: "collab", action: { kind: "voice", action: { kind: "mute", muted: !voice.muted } } });
          }
          return;
        }
        const action = actions[key];
        if (action) {
          e.preventDefault();
          action();
        }
        return;
      }

      if (isEditable(e.target)) {
        return;
      }
      if (key === "delete" || key === "backspace") {
        e.preventDefault();
        // Un point de cassure sélectionné est supprimé seul, pas son lien (override O-10).
        if (view.activeBend) {
          removeBend(doc, view.activeBend.linkId, view.activeBend.index);
        } else {
          deleteObjects(doc, view.selection);
        }
      } else if (key === "escape") {
        ui.setTool("select");
        view.select([]);
      } else if (key === "f" && e.shiftKey) {
        fitToWindow(doc);
      } else if (TOOL_KEYS[key] && !e.altKey) {
        chooseTool(doc, TOOL_KEYS[key]);
      } else if (
        ARROWS[key] &&
        onDiagram(e.target) &&
        !e.altKey &&
        selectReadOnlyTab(useCollabStore.getState()) !== doc.id
      ) {
        e.preventDefault();
        const grid = docStore.doc.settings.grid;
        const step = (grid.enabled ? grid.size : 1) * (e.shiftKey ? 10 : 1);
        const [dx, dy] = ARROWS[key];
        nudgeSelection(doc, dx * step, dy * step);
      }
    };
    // Relâcher les flèches (ou quitter la fenêtre) clôt le déplacement : une entrée d'historique.
    const onKeyUp = (e: KeyboardEvent) => ARROWS[e.key.toLowerCase()] && endNudge(activeDocument());
    const onBlur = () => endNudge(activeDocument());
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
  }, []);
}
