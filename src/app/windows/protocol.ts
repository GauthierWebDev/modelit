import type { ModelDocument } from "@core/index";
import type { Patch } from "immer";
import type { MessageKey } from "@/i18n";
import type { DockLayout } from "../dock/layout";
import type { DocumentViewState } from "../document/documentView";
import type { AboutTab, Tool } from "../uiStore";

/**
 * Fenêtres flottantes (barre d'outils, groupes de sections) et fenêtre principale
 * (docs/jalons/J-01, phase 4, décision D6) : la principale est propriétaire de l'état ; une
 * flottante en reçoit une copie et lui renvoie ses modifications.
 */

/** Ce qu'une fenêtre flottante affiche du document de l'onglet actif. */
export interface MirrorState {
  documentId: string;
  doc: ModelDocument;
  name: string;
  dirty: boolean;
  recovered: boolean;
  undoLabel?: MessageKey;
  redoLabel?: MessageKey;
  view: Pick<DocumentViewState, "view" | "selection" | "viewport" | "activeBend">;
  ui: { tool: Tool; advanced: boolean };
  /** Une boîte modale est ouverte dans la fenêtre principale : les flottantes sont désactivées (O-45). */
  modal: boolean;
}

/** Commandes qui ne peuvent s'exécuter que dans la fenêtre principale (fichiers, cadrage…). */
export type MainCommand =
  | { name: "new" }
  | { name: "newTab" }
  | { name: "open" }
  | { name: "save"; saveAs?: boolean }
  | { name: "zoomTo"; zoom: number }
  | { name: "zoomBy"; factor: number }
  | { name: "fit" }
  | { name: "autoLayout" };

export type UiPatch = Partial<{
  tool: Tool;
  advanced: boolean;
  exportOpen: boolean;
  optionsOpen: boolean;
  reverseOpen: boolean;
  about: AboutTab | null;
}>;

/** Messages d'une fenêtre flottante vers la principale. */
export type ToMain =
  | { type: "hello" }
  | { type: "change"; documentId: string; label: MessageKey; patches: Patch[] }
  | { type: "undo"; documentId: string }
  | { type: "redo"; documentId: string }
  | { type: "view"; documentId: string; patch: Partial<Pick<DocumentViewState, "view" | "selection" | "viewport" | "activeBend">> }
  | { type: "ui"; patch: UiPatch }
  | { type: "dock"; layout: DockLayout }
  | { type: "command"; command: MainCommand }
  | { type: "focus"; focused: boolean };

/** Messages de la principale vers les flottantes. */
export type ToReplica = { type: "state"; state: MirrorState };

/** Canal entre fenêtres : événements Tauri, ou en mémoire pour les tests. */
export interface Channel<Out, In> {
  send(message: Out): void;
  listen(handler: (message: In) => void): () => void;
}

