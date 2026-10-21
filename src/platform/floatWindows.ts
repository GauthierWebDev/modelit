import { isTauri } from "@tauri-apps/api/core";

/**
 * Fenêtres flottantes natives (overrides O-45, O-46 ; J-01, phase 4) : création, géométrie,
 * déplacement, et canal d'événements avec la fenêtre principale. Seul module du front qui
 * connaît ces API de Tauri ; dans un navigateur, les éléments flottants restent dans la page.
 */

export const nativeWindows = () => isTauri();

export interface ScreenRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Fenêtre flottante affichée par cette page, d'après son adresse (`?float=…`). */
export function floatKind(): { kind: "toolbar" } | { kind: "group"; id: string } | null {
  const params = new URLSearchParams(globalThis.location.search);
  const kind = params.get("float");
  if (kind === "toolbar") {
    return { kind };
  }
  if (kind === "group" && params.get("id")) {
    return { kind, id: params.get("id")! };
  }
  return null;
}

export const toolbarLabel = "float-toolbar";
export const groupLabel = (id: string) => `float-group-${id}`;

const STATE_EVENT = "modelit://float-state";
const ACTION_EVENT = "modelit://float-action";

/** Canal de la fenêtre principale : diffuse aux flottantes, reçoit leurs messages. */
export async function ownerChannel<Out, In>() {
  const { emit, listen } = await import("@tauri-apps/api/event");
  return {
    send: (message: Out) => void emit(STATE_EVENT, message),
    listen: (handler: (message: In) => void) => {
      const off = listen<In>(ACTION_EVENT, (e) => handler(e.payload));
      return () => void off.then((f) => f());
    },
  };
}

/** Canal d'une fenêtre flottante : écrit à la principale, reçoit ses diffusions. */
export async function replicaChannel<Out, In>() {
  const { emitTo, listen } = await import("@tauri-apps/api/event");
  return {
    send: (message: Out) => void emitTo("main", ACTION_EVENT, message),
    listen: (handler: (message: In) => void) => {
      const off = listen<In>(STATE_EVENT, (e) => handler(e.payload));
      return () => void off.then((f) => f());
    },
  };
}

/**
 * Ouvre (ou replace) une fenêtre flottante : sans cadre, transparente, rattachée à la principale
 * (devant elle, derrière les autres applications avec elle). Ouverte sans prendre le focus.
 */
export async function openFloat(
  label: string,
  url: string,
  rect: ScreenRect,
  { resizable, focusable }: { resizable: boolean; focusable: boolean },
) {
  const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
  const existing = await WebviewWindow.getByLabel(label);
  if (existing) {
    return placeFloat(label, rect);
  }
  const created = new WebviewWindow(label, {
    url,
    x: Math.round(rect.x),
    y: Math.round(rect.y),
    width: Math.round(rect.width),
    height: Math.round(rect.height),
    decorations: false,
    transparent: true,
    shadow: true,
    resizable,
    focusable,
    skipTaskbar: true,
    focus: false,
    parent: "main",
    title: "ModelIt",
  });
  await new Promise<void>((resolve) => {
    void created.once("tauri://created", () => resolve());
    void created.once("tauri://error", () => resolve());
  });
}

export async function placeFloat(label: string, rect: ScreenRect) {
  const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
  const { LogicalPosition, LogicalSize } = await import("@tauri-apps/api/dpi");
  const w = await WebviewWindow.getByLabel(label);
  if (!w) {
    return;
  }
  await w.setPosition(new LogicalPosition(Math.round(rect.x), Math.round(rect.y)));
  await w.setSize(new LogicalSize(Math.round(rect.width), Math.round(rect.height)));
}

export async function closeFloat(label: string) {
  const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
  await (await WebviewWindow.getByLabel(label))?.destroy();
}

/** Fenêtres flottantes ouvertes. */
export async function openFloats(): Promise<string[]> {
  const { getAllWebviewWindows } = await import("@tauri-apps/api/webviewWindow");
  return (await getAllWebviewWindows()).map((w) => w.label).filter((l) => l.startsWith("float-"));
}

export async function closeAllFloats() {
  for (const label of await openFloats()) {
    await closeFloat(label);
  }
}

/** Zone cliente de la fenêtre courante, en coordonnées logiques de l'écran. */
export async function currentInnerRect(): Promise<ScreenRect> {
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  const w = getCurrentWindow();
  const scale = await w.scaleFactor();
  const position = (await w.innerPosition()).toLogical(scale);
  const size = (await w.innerSize()).toLogical(scale);
  return { x: position.x, y: position.y, width: size.width, height: size.height };
}

/** Écrans disponibles, en coordonnées logiques. */
export async function screens(): Promise<ScreenRect[]> {
  const { availableMonitors } = await import("@tauri-apps/api/window");
  return (await availableMonitors()).map((m) => {
    const p = m.position.toLogical(m.scaleFactor);
    const s = m.size.toLogical(m.scaleFactor);
    return { x: p.x, y: p.y, width: s.width, height: s.height };
  });
}

/** Déplacement ou redimensionnement de la fenêtre courante (rappel à chaque étape). */
export async function onGeometryChange(handler: () => void): Promise<() => void> {
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  const w = getCurrentWindow();
  const offMoved = await w.onMoved(handler);
  const offResized = await w.onResized(handler);
  return () => {
    offMoved();
    offResized();
  };
}

/** Rend le focus à la fenêtre principale (clavier et raccourcis du canevas). */
export async function focusMain() {
  const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
  await (await WebviewWindow.getByLabel("main"))?.setFocus();
}

/** Place la fenêtre courante (déplacement par sa poignée, géré par la page). */
export async function moveOwnWindow(x: number, y: number) {
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  const { LogicalPosition } = await import("@tauri-apps/api/dpi");
  await getCurrentWindow().setPosition(new LogicalPosition(Math.round(x), Math.round(y)));
}

export type ResizeEdge = "East" | "South" | "SouthEast";

export async function startWindowResize(edge: ResizeEdge) {
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  await getCurrentWindow().startResizeDragging(edge);
}

/** Taille de la fenêtre courante (barre flottante ajustée à son contenu). */
export async function setOwnSize(width: number, height: number) {
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  const { LogicalSize } = await import("@tauri-apps/api/dpi");
  await getCurrentWindow().setSize(new LogicalSize(Math.ceil(width), Math.ceil(height)));
}
