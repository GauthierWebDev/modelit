import { useEffect } from "react";
import { copySelection, cutSelection, duplicateSelection, pasteText } from "@/app/clipboardCommands";
import type { DocumentHandle } from "@/app/document/handle";
import { activeDocument } from "@/app/workspace";
import { revealObjects } from "@/ui/canvas/viewport";

/**
 * Copier / couper / coller / dupliquer au clavier (override O-52). Le presse-papiers du système
 * passe par les événements copy / cut / paste (sans demande d'autorisation) ; si le système ne
 * les émet pas après ⌘C / ⌘X / ⌘V, la copie gardée en mémoire sert de repli.
 */

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

const isEditable = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));

/** Champ de saisie, ou texte sélectionné (MLD textuel, script) : le presse-papiers garde son sens habituel. */
const textContext = (target: EventTarget | null) =>
  isEditable(target) || Boolean(globalThis.getSelection()?.toString());

/** Délai d'attente de l'événement du système avant de passer à la copie en mémoire. */
const FALLBACK_DELAY = 100;

const paste = (doc: DocumentHandle, text?: string | null) => {
  if (pasteText(doc, text)) {
    revealObjects(doc, doc.view.getState().selection);
  }
};

export function useClipboard() {
  useEffect(() => {
    const state: ClipboardState = { handled: false };
    const onCopy = (e: ClipboardEvent) => copyEvent(state, e);
    const onPaste = (e: ClipboardEvent) => pasteEvent(state, e);
    const onKeyDown = (e: KeyboardEvent) => keyDown(state, e);
    // Un clic sur le canevas abandonne une éventuelle sélection de texte (MLD textuel…).
    const onPointerDown = (e: PointerEvent) => {
      if ((e.target as Element | null)?.closest?.("[data-canvas]")) {
        globalThis.getSelection()?.removeAllRanges();
      }
    };

    document.addEventListener("copy", onCopy);
    document.addEventListener("cut", onCopy);
    document.addEventListener("paste", onPaste);
    globalThis.addEventListener("keydown", onKeyDown);
    globalThis.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      document.removeEventListener("copy", onCopy);
      document.removeEventListener("cut", onCopy);
      document.removeEventListener("paste", onPaste);
      globalThis.removeEventListener("keydown", onKeyDown);
      globalThis.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, []);
}

/** L'événement natif a-t-il été traité (sinon, repli au clavier après un court délai) ? */
interface ClipboardState {
  handled: boolean;
}

const blocked = () => Boolean(document.querySelector('[aria-modal="true"]'));

function copyEvent(state: ClipboardState, e: ClipboardEvent) {
  if (blocked() || textContext(e.target)) {
    return;
  }
  state.handled = true;
  const text = (e.type === "cut" ? cutSelection : copySelection)(activeDocument());
  if (!text) {
    return;
  }
  e.clipboardData?.setData("text/plain", text);
  e.preventDefault();
}

function pasteEvent(state: ClipboardState, e: ClipboardEvent) {
  if (blocked() || isEditable(e.target)) {
    return;
  }
  state.handled = true;
  // Contenu qui n'est pas une copie de ModelIt : ignoré, sans message.
  paste(activeDocument(), e.clipboardData?.getData("text/plain") ?? null);
  e.preventDefault();
}

function keyDown(state: ClipboardState, e: KeyboardEvent) {
  const mod = isMac ? e.metaKey : e.ctrlKey;
  if (!mod || e.altKey || blocked() || textContext(e.target)) {
    return;
  }
  const key = e.key.toLowerCase();
  if (key === "d") {
    // ⌘D : favori du navigateur, à éviter.
    e.preventDefault();
    const doc = activeDocument();
    if (duplicateSelection(doc)) {
      revealObjects(doc, doc.view.getState().selection);
    }
    return;
  }
  if (key !== "c" && key !== "x" && key !== "v") {
    return;
  }
  state.handled = false;
  globalThis.setTimeout(() => fallback(state, key), FALLBACK_DELAY);
}

/** Pas d'événement natif reçu à temps : copier, couper ou coller au clavier. */
function fallback(state: ClipboardState, key: string) {
  if (state.handled) {
    return;
  }
  const doc = activeDocument();
  if (key === "c") {
    copySelection(doc);
  } else if (key === "x") {
    cutSelection(doc);
  } else {
    paste(doc);
  }
}
