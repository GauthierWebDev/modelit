import { applyPatches, enablePatches, type Draft } from "immer";
import type { ModelDocument } from "@core/index";
import { collabMirror, sameCollabMirror, useCollabStore } from "../collab/session";
import { useDialogStore } from "../dialogStore";
import { selectIsDirty, selectRedoLabel, selectUndoLabel } from "../document/documentStore";
import { documentName } from "../fileCommands";
import { usePreferencesStore } from "../preferencesStore";
import { useUiStore } from "../uiStore";
import { activeDocument, useWorkspaceStore } from "../workspace";
import type { Channel, MainCommand, MirrorState, ToMain, ToReplica } from "./protocol";

type Message<T extends ToMain["type"]> = Extract<ToMain, { type: T }>;

enablePatches();

/**
 * Fenêtre principale, propriétaire de l'état (J-01, phase 4, D6) : diffuse aux fenêtres
 * flottantes ce qu'elles affichent, et applique ce qu'elles renvoient (patchs du document,
 * historique compris ; vue ; outil ; disposition ; commandes).
 */

export function snapshot(): MirrorState {
  const doc = activeDocument();
  const state = doc.store.getState();
  const view = doc.view.getState();
  const ui = useUiStore.getState();
  return {
    documentId: doc.id,
    doc: state.doc,
    name: documentName(doc),
    dirty: selectIsDirty(state),
    recovered: state.recovered,
    undoLabel: selectUndoLabel(state),
    redoLabel: selectRedoLabel(state),
    view: { view: view.view, selection: view.selection, viewport: view.viewport, activeBend: view.activeBend },
    ui: { tool: ui.tool },
    modal: useDialogStore.getState().queue.length > 0 || ui.exportOpen || ui.optionsOpen || ui.modelSettingsOpen || ui.reverseOpen || ui.shareOpen || ui.about !== null,
    collab: collabMirror(),
  };
}

const same = (a: MirrorState, b: MirrorState) =>
  a.documentId === b.documentId &&
  a.doc === b.doc &&
  a.name === b.name &&
  a.dirty === b.dirty &&
  a.recovered === b.recovered &&
  a.undoLabel === b.undoLabel &&
  a.redoLabel === b.redoLabel &&
  a.view.view === b.view.view &&
  a.view.selection === b.view.selection &&
  a.view.viewport === b.view.viewport &&
  a.view.activeBend === b.view.activeBend &&
  a.ui.tool === b.ui.tool &&
  a.modal === b.modal &&
  sameCollabMirror(a.collab, b.collab);

export function startOwner(
  channel: Channel<ToReplica, ToMain>,
  runCommand: (command: MainCommand) => void,
  {
    onDrop,
    onMoved,
    schedule = (f: () => void) => queueMicrotask(f),
  }: {
    onDrop?: (message: Message<"drop">) => void;
    onMoved?: (message: Message<"moved">) => void;
    schedule?: (f: () => void) => void;
  } = {},
): () => void {
  let last: MirrorState | null = null;
  let pending = false;

  const broadcast = (force = false) => {
    const doc = activeDocument();
    // Pendant un glisser-déposer, une seule diffusion, à la fin de l'opération.
    if (doc.store.getState().transactionStart) return;
    const next = snapshot();
    if (!force && last && same(last, next)) return;
    last = next;
    channel.send({ type: "state", state: next });
  };
  const request = () => {
    if (pending) return;
    pending = true;
    schedule(() => {
      pending = false;
      broadcast();
    });
  };

  // Abonnements au document actif, renouvelés quand l'onglet actif change.
  let unsubscribeDoc = () => {};
  const watchActive = () => {
    unsubscribeDoc();
    const doc = activeDocument();
    const offStore = doc.store.subscribe(request);
    const offView = doc.view.subscribe(request);
    unsubscribeDoc = () => {
      offStore();
      offView();
    };
    request();
  };
  watchActive();
  const offWorkspace = useWorkspaceStore.subscribe((s, p) => {
    if (s.activeId !== p.activeId || s.documents !== p.documents) watchActive();
    else request();
  });
  const offUi = useUiStore.subscribe(request);
  const offDialogs = useDialogStore.subscribe(request);
  const offCollab = useCollabStore.subscribe(request);

  const offChannel = channel.listen((message) => {
    const doc = activeDocument();
    switch (message.type) {
      case "hello":
        return broadcast(true);
      case "change":
        if (message.documentId !== doc.id) return;
        return doc.store.getState().change(message.label, (draft) => void applyPatches(draft as Draft<ModelDocument>, message.patches));
      case "undo":
        if (message.documentId === doc.id) doc.store.getState().undo();
        return;
      case "redo":
        if (message.documentId === doc.id) doc.store.getState().redo();
        return;
      case "view":
        if (message.documentId === doc.id) doc.view.setState(message.patch);
        return;
      case "ui":
        return useUiStore.setState(message.patch);
      case "dock":
        return usePreferencesStore.getState().updateDock(() => message.layout);
      case "command":
        return runCommand(message.command);
      case "drop":
        return onDrop?.(message);
      case "moved":
        return onMoved?.(message);
    }
  });

  return () => {
    unsubscribeDoc();
    offWorkspace();
    offUi();
    offDialogs();
    offCollab();
    offChannel();
  };
}
