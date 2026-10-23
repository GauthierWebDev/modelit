import {
  registerVoiceActions,
  useCollabStore,
  VOICE_OFF,
  type VoiceAction,
  type VoiceState,
  voiceLink,
} from "../session";
import { clearSpeaking, noteLevel } from "./speaking";
import type { VoiceEngine, VoiceFrame } from "./voiceEngine";

/**
 * Vocal d'une session (O-48, D18) : relie le moteur audio (micro, Opus, lecture) au canal de la
 * session. Personne n'est dans le vocal par défaut ; le micro ne s'ouvre qu'après « Rejoindre
 * l'audio ». Le vocal s'arrête avec la session.
 */

export interface VoiceBackend {
  support: () => Promise<"ok" | "no-codec" | "no-media">;
  start: (options: {
    onFrame: (frame: VoiceFrame) => void;
    onLevel: (level: number) => void;
  }) => Promise<{ engine: VoiceEngine; mic: boolean; micError?: string }>;
}

let backend: VoiceBackend | null = null;
/** Moteur utilisé (webview dans l'application, factice dans les tests). */
export const setVoiceBackend = (value: VoiceBackend) => {
  backend = value;
};

let engine: VoiceEngine | null = null;
let offAudio: (() => void) | null = null;

const voice = () => useCollabStore.getState().voice;
const setVoiceState = (patch: Partial<VoiceState>) =>
  useCollabStore.setState((s) => ({ voice: { ...s.voice, ...patch } }));
const inSession = () => {
  const { mode } = useCollabStore.getState();
  return mode === "host" || mode === "guest";
};

/** Rejoindre l'audio : micro demandé au système ; refusé, on écoute seulement (O-48). */
export async function joinAudio() {
  const link = voiceLink();
  if (!(backend && link && inSession()) || voice().status !== "off") {
    return;
  }
  setVoiceState({ status: "starting", unavailable: null, micError: null });
  const support = await backend.support();
  if (support === "no-codec") {
    return setVoiceState({ status: "off", unavailable: support });
  }
  const you = () => useCollabStore.getState().you ?? "";
  let started: Awaited<ReturnType<VoiceBackend["start"]>>;
  try {
    started = await backend.start({
      onFrame: (frame) => voiceLink()?.sendAudio(frame),
      onLevel: (level) => noteLevel(you(), level),
    });
  } catch (e) {
    return setVoiceState({ status: "off", micError: String(e) });
  }
  // Session terminée ou vocal quitté pendant l'ouverture du micro.
  if (!inSession() || voice().status !== "starting") {
    return started.engine.stop();
  }
  ({ engine } = started);
  for (const [peer, gain] of Object.entries(voice().volumes)) {
    engine.setVolume(peer, gain);
  }
  offAudio = link.onAudio((packet) => {
    engine?.play(packet.speaker, packet);
    noteLevel(packet.speaker, packet.level);
  });
  // Écoute seule : présenté comme micro coupé chez les autres.
  const muted = !started.mic;
  engine.setMuted(muted);
  link.setVoice(true, muted);
  setVoiceState({
    status: "on",
    mic: started.mic,
    muted,
    micError: started.micError ?? null,
    unavailable: support === "no-media" ? support : null,
  });
}

function release() {
  offAudio?.();
  offAudio = null;
  engine?.stop();
  engine = null;
  clearSpeaking();
}

export function leaveAudio() {
  if (voice().status === "off") {
    return;
  }
  release();
  voiceLink()?.setVoice(false, false);
  setVoiceState({ status: "off", muted: false, mic: false });
}

export function setMuted(muted: boolean) {
  const state = voice();
  if (state.status !== "on" || !state.mic || state.muted === muted) {
    return;
  }
  engine?.setMuted(muted);
  voiceLink()?.setVoice(true, muted);
  setVoiceState({ muted });
  if (muted) {
    clearSpeaking(useCollabStore.getState().you ?? undefined);
  }
}

export const toggleMute = () => setMuted(!voice().muted);

export function setVolume(peer: string, gain: number) {
  const value = Math.max(0, Math.min(2, gain));
  engine?.setVolume(peer, value);
  setVoiceState({ volumes: { ...voice().volumes, [peer]: value } });
}

/**
 * Vocal de la fenêtre principale, démarré par `src/bootstrap.ts` ; renvoie la désinscription (audit A-01,
 * A-3) : actions vocales relayées par la session (rejoindre, quitter, micro, volume) ; fin de session : vocal
 * arrêté, volumes oubliés (O-48 « Fin de session ») ; participant parti : sa lecture s'arrête.
 */
export function startVoiceSync(): () => void {
  registerVoiceActions((action: VoiceAction) => {
    switch (action.kind) {
      case "join":
        return void joinAudio();
      case "leave":
        return leaveAudio();
      case "mute":
        return setMuted(action.muted);
      case "volume":
        return setVolume(action.peer, action.gain);
    }
  });
  return useCollabStore.subscribe((s, p) => {
    // Fin de session : vocal arrêté, volumes oubliés (O-48 « Fin de session »).
    const active = s.mode === "host" || s.mode === "guest";
    if (!active && (engine || s.voice !== VOICE_OFF)) {
      release();
      useCollabStore.setState({ voice: VOICE_OFF });
      return;
    }
    // Participant parti : sa lecture s'arrête.
    if (engine && s.participants !== p.participants) {
      const ids = new Set(s.participants.map((x) => x.id));
      for (const x of p.participants) {
        if (!ids.has(x.id)) {
          engine.forget(x.id);
          clearSpeaking(x.id);
        }
      }
    }
  });
}
