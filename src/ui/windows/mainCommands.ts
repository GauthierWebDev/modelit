import { runCollabAction } from "@/app/collab/session";
import { newDocument, newTab, openDocument, saveDocument } from "@/app/fileCommands";
import { cancelAutoLayout } from "@/app/layoutCommands";
import type { MainCommand } from "@/app/windows/protocol";
import { activeDocument } from "@/app/workspace";
import { autoLayoutTables } from "@/ui/canvas/autoLayout";
import { fitToWindow, zoomBy, zoomTo } from "@/ui/canvas/viewport";

/**
 * Commandes que seule la fenêtre principale sait exécuter (fichiers, cadrage du canevas,
 * placement) : exécutées sur place dans la principale, relayées depuis une fenêtre flottante.
 */

export function runMainCommand(command: MainCommand) {
  const doc = activeDocument();
  switch (command.name) {
    case "new":
      return newDocument();
    case "newTab":
      return newTab();
    case "open":
      return void openDocument();
    case "save":
      return void saveDocument(doc, command.saveAs);
    case "zoomTo":
      return zoomTo(doc, command.zoom);
    case "zoomBy":
      return zoomBy(doc, command.factor);
    case "fit":
      return fitToWindow(doc);
    case "autoLayout":
      return void autoLayoutTables(doc);
    case "cancelAutoLayout":
      return cancelAutoLayout(doc);
    case "collab":
      return runCollabAction(command.action);
  }
}

let relay: ((command: MainCommand) => void) | null = null;

/** Fenêtre flottante : ses commandes partent vers la principale. */
export const setMainCommandRelay = (f: typeof relay) => {
  relay = f;
};

export const mainCommand = (command: MainCommand) => (relay ? relay(command) : runMainCommand(command));
