import type { Presence } from "./protocol";
import { live, PRESENCE_EVERY } from "./sessionState";

let presenceSent: Presence | null = null;

let presenceNext: Presence | null = null;

let presenceAt = 0;

let presenceTimer: ReturnType<typeof setTimeout> | undefined;

const samePresence = (a: Presence, b: Presence) =>
  a.view === b.view &&
  a.cursor?.x === b.cursor?.x &&
  a.cursor?.y === b.cursor?.y &&
  a.selection.join() === b.selection.join() &&
  a.viewport?.center.x === b.viewport?.center.x &&
  a.viewport?.center.y === b.viewport?.center.y &&
  a.viewport?.zoom === b.viewport?.zoom &&
  (a.following ?? null) === (b.following ?? null);

function flushPresence() {
  presenceTimer = undefined;
  if (!presenceNext) {
    return;
  }
  const value = presenceNext;
  presenceNext = null;
  presenceAt = Date.now();
  presenceSent = value;
  live.host?.session.setPresence(value);
  live.guest?.session.setPresence(value);
}

/**
 * Ma présence (vue, curseur en coordonnées du modèle, sélection) : envoyée aux autres participants,
 * au plus 20 fois par seconde ; le dernier état part toujours.
 */
export function reportPresence(value: Presence) {
  if (!(live.host || live.guest)) {
    return;
  }
  if (presenceSent && samePresence(presenceSent, value)) {
    presenceNext = null;
    return;
  }
  presenceNext = value;
  if (presenceTimer !== undefined) {
    return;
  }
  const wait = PRESENCE_EVERY - (Date.now() - presenceAt);
  if (wait <= 0) {
    flushPresence();
  } else {
    presenceTimer = setTimeout(flushPresence, wait);
  }
}

/** Nouvelle session : la prochaine présence est envoyée, même identique à la dernière. */
export function forgetSentPresence() {
  presenceSent = null;
}
