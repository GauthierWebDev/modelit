import { create } from "zustand";

/**
 * « Qui parle » (O-48) : participants dont la voix a dépassé le seuil il y a moins de 300 ms.
 * Mis à jour plusieurs fois par seconde : gardé hors de l'état de session, qui est reflété dans les
 * fenêtres flottantes avec le document.
 */

/** Niveau (0–255) à partir duquel on parle : environ −40 dBFS. */
export const SPEAKING_LEVEL = 85;
const HOLD_MS = 300;

export const useSpeakingStore = create<{ ids: string[] }>(() => ({ ids: [] }));

const loud = new Map<string, number>();
let timer: ReturnType<typeof setInterval> | undefined;

function publish(now = Date.now()) {
  for (const [id, at] of loud) if (now - at > HOLD_MS) loud.delete(id);
  const ids = [...loud.keys()].sort();
  if (ids.join() !== useSpeakingStore.getState().ids.join()) useSpeakingStore.setState({ ids });
  if (!loud.size && timer !== undefined) {
    clearInterval(timer);
    timer = undefined;
  }
}

export function noteLevel(id: string, level: number, now = Date.now()) {
  if (level < SPEAKING_LEVEL) return;
  const isNew = !loud.has(id);
  loud.set(id, now);
  if (isNew) publish(now);
  timer ??= setInterval(publish, 100);
}

export function clearSpeaking(id?: string) {
  if (id) loud.delete(id);
  else loud.clear();
  publish();
}
