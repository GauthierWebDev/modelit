import type { ModelDocument } from "@core/index";
import { enablePatches, produce, produceWithPatches } from "immer";
import { create } from "zustand";
import { createStore } from "zustand/vanilla";
import { applyCollabMirror } from "../collab/session";
import type { DocumentState } from "../document/documentStore";
import { createDocumentViewStore, type DocumentViewState, ZOOM_MAX, ZOOM_MIN } from "../document/documentView";
import type { DocumentHandle } from "../document/handle";
import { newModelDocument } from "../modelDefaults";
import { usePreferencesStore } from "../preferencesStore";
import { useUiStore } from "../uiStore";
import type { Channel, MainCommand, MirrorState, ToMain, ToReplica, UiPatch } from "./protocol";

enablePatches();

/**
 * Fenêtre flottante (J-01, phase 4, D6) : un `DocumentHandle` miroir du document de l'onglet
 * actif de la fenêtre principale. Ses modifications sont appliquées localement (affichage
 * immédiat) et envoyées à la principale sous forme de patchs ; l'état qu'elle rediffuse fait foi.
 */

/** Dernier état reçu (nom du document, boîte modale ouverte…). */
export const useMirrorStore = create<{ state: MirrorState | null }>(() => ({ state: null }));

const UI_KEYS = [
  "tool",
  "exportOpen",
  "optionsOpen",
  "modelSettingsOpen",
  "reverseOpen",
  "shareOpen",
  "about",
] as const;
/** Boîtes de dialogue : elles s'ouvrent dans la fenêtre principale, jamais dans une flottante. */
const DIALOG_KEYS = ["exportOpen", "optionsOpen", "modelSettingsOpen", "reverseOpen", "shareOpen", "about"] as const;

export interface Replica {
  handle: DocumentHandle;
  /** Commande exécutée par la fenêtre principale. */
  command: (command: MainCommand) => void;
  stop: () => void;
}

export function startReplica(channel: Channel<ToMain, ToReplica>): Replica {
  let documentId = "";
  let applying = false;
  const send = (message: ToMain) => channel.send(message);

  const initial = newModelDocument();
  const store = createStore<DocumentState>()((set, get) => ({
    doc: initial,
    savedDoc: initial,
    filePath: null,
    recovered: false,
    past: [],
    future: [],
    transactionStart: null,
    change(label, recipe) {
      const [next, patches] = produceWithPatches(get().doc, recipe);
      if (!patches.length) {
        return;
      }
      set({ doc: next });
      send({ type: "change", documentId, label, patches });
    },
    // Les glisser-déposer (seuls utilisateurs des transactions) n'existent que dans la principale.
    begin() {
      // Pas de transaction dans une fenêtre flottante (voir ci-dessus).
    },
    preview(recipe) {
      set({ doc: produce(get().doc, recipe) });
    },
    commit() {
      // Pas de transaction dans une fenêtre flottante (voir ci-dessus).
    },
    cancel() {
      // Pas de transaction dans une fenêtre flottante (voir ci-dessus).
    },
    undo: () => send({ type: "undo", documentId }),
    redo: () => send({ type: "redo", documentId }),
    load() {
      // Ouvrir un fichier se fait dans la fenêtre principale.
    },
    restore() {
      // La récupération se fait dans la fenêtre principale.
    },
    markSaved() {
      // Enregistrer est le rôle de la fenêtre principale.
    },
  }));

  const view = createDocumentViewStore();
  const forwardView = (patch: Partial<DocumentViewState>) => {
    view.setState(patch);
    if (!applying) {
      send({ type: "view", documentId, patch });
    }
  };
  view.setState({
    setView: (v) => forwardView({ view: v }),
    select: (selection) => forwardView({ selection, activeBend: null }),
    toggleSelected: (id) => {
      const { selection } = view.getState();
      forwardView({
        activeBend: null,
        selection: selection.includes(id) ? selection.filter((x) => x !== id) : [...selection, id],
      });
    },
    setViewport: (viewport) =>
      forwardView({ viewport: { ...viewport, zoom: Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, viewport.zoom)) } }),
    setActiveBend: (activeBend) => forwardView({ activeBend }),
  });

  // Outil, boîtes de dialogue : renvoyés à la principale.
  const offUi = useUiStore.subscribe((s, p) => {
    if (applying) {
      return;
    }
    const patch: UiPatch = {};
    for (const key of UI_KEYS) {
      if (s[key] !== p[key]) {
        Object.assign(patch, { [key]: s[key] });
      }
    }
    if (!Object.keys(patch).length) {
      return;
    }
    send({ type: "ui", patch });
    if (DIALOG_KEYS.some((k) => k in patch)) {
      useUiStore.setState({
        exportOpen: false,
        optionsOpen: false,
        modelSettingsOpen: false,
        reverseOpen: false,
        shareOpen: false,
        about: null,
      });
    }
  });

  // Disposition : la principale l'applique et l'enregistre ; elle revient par le stockage partagé.
  usePreferencesStore.setState({
    updateDock: (change) => send({ type: "dock", layout: change(usePreferencesStore.getState().dock) }),
  });

  const offChannel = channel.listen((message) => {
    if (message.type !== "state") {
      return;
    }
    const { state } = message;
    applying = true;
    try {
      documentId = state.documentId;
      const doc: ModelDocument = state.doc;
      store.setState({
        doc,
        // Indicateur de modification et libellés d'annulation tels que la principale les voit.
        savedDoc: state.dirty ? ({ ...doc } as ModelDocument) : doc,
        recovered: state.recovered,
        past: state.undoLabel ? [{ doc, label: state.undoLabel }] : [],
        future: state.redoLabel ? [{ doc, label: state.redoLabel }] : [],
      });
      view.setState(state.view);
      const ui = useUiStore.getState();
      if (ui.tool !== state.ui.tool) {
        useUiStore.setState(state.ui);
      }
      applyCollabMirror(state.collab);
      useMirrorStore.setState({ state });
    } finally {
      applying = false;
    }
  });
  send({ type: "hello" });

  return {
    handle: { id: "replica", store, view },
    command: (command) => send({ type: "command", command }),
    stop: () => {
      offUi();
      offChannel();
    },
  };
}
