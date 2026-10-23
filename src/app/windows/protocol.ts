import type { ModelDocument } from "@core/index";
import type { Patch } from "immer";
import type { MessageKey } from "@/i18n";
import type { CollabAction, CollabMirror } from "../collab/session";
import type { DockLayout, DragItem, Rect } from "../dock/model";
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
  view: Pick<DocumentViewState, "view" | "selection" | "viewport" | "activeBend" | "layoutRunning">;
  ui: { tool: Tool };
  /** Une boîte modale est ouverte dans la fenêtre principale : les flottantes sont désactivées (O-45). */
  modal: boolean;
  /** Session collaborative (section Session, O-05 §7). */
  collab: CollabMirror;
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
  | { name: "autoLayout" }
  | { name: "collab"; action: CollabAction };

export type UiPatch = Partial<{
  tool: Tool;
  exportOpen: boolean;
  optionsOpen: boolean;
  modelSettingsOpen: boolean;
  reverseOpen: boolean;
  shareOpen: boolean;
  about: AboutTab | null;
}>;

/** Messages d'une fenêtre flottante vers la principale. */
export type ToMain =
  | { type: "hello" }
  | { type: "change"; documentId: string; label: MessageKey; patches: Patch[] }
  | { type: "undo"; documentId: string }
  | { type: "redo"; documentId: string }
  | {
      type: "view";
      documentId: string;
      patch: Partial<Pick<DocumentViewState, "view" | "selection" | "viewport" | "activeBend">>;
    }
  | { type: "ui"; patch: UiPatch }
  | { type: "dock"; layout: DockLayout }
  | { type: "command"; command: MainCommand }
  /** Glisser commencé dans une flottante, relâché au point `screen` : la principale décide. */
  | { type: "drop"; item: DragItem; screen: { x: number; y: number } }
  /**
   * Une fenêtre flottante a bougé. `pointer` (écran) : déplacée à la main par sa poignée, `final` au
   * relâchement — la principale allume puis choisit la cible d'ancrage. `pointer` nul : simple
   * nouvelle géométrie (redimensionnement…), à enregistrer.
   */
  | {
      type: "moved";
      float: { kind: "toolbar" } | { kind: "group"; id: string };
      rect: Rect;
      pointer: { x: number; y: number } | null;
      final: boolean;
    };

/** Messages de la principale vers les flottantes. */
export interface ToReplica {
  type: "state";
  state: MirrorState;
}

/** Canal entre fenêtres : événements Tauri, ou en mémoire pour les tests. */
export interface Channel<Out, In> {
  send: (message: Out) => void;
  listen: (handler: (message: In) => void) => () => void;
}
