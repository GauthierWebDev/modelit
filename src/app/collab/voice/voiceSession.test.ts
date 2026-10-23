import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { resetWorkspace } from "../../workspace";
import { type GuestSession, startGuest } from "../guest";
import { parseLink } from "../link";
import { memoryNetwork } from "../memoryNetwork";
import { setCollabTransport, shareActiveTab, stopSharing, useCollabStore, VOICE_OFF } from "../session";
import type { AudioPacket } from "./packet";
import { useSpeakingStore } from "./speaking";
import type { VoiceEngine, VoiceFrame } from "./voiceEngine";
import { joinAudio, leaveAudio, setMuted, setVoiceBackend, setVolume, startVoiceSync } from "./voiceSession";

/** Moteur factice : enregistre ce qu'on lui fait jouer ; `speak` simule 20 ms de voix captée. */
function fakeBackend(options: { mic?: boolean; support?: "ok" | "no-codec" | "no-media" } = {}) {
  const engines: (VoiceEngine & {
    played: [string, number][];
    muted: boolean;
    volumes: Record<string, number>;
    forgotten: string[];
    stopped: boolean;
  })[] = [];
  let emit: ((frame: VoiceFrame) => void) | null = null;
  let level: ((level: number) => void) | null = null;
  setVoiceBackend({
    support: async () => options.support ?? "ok",
    start: ({ onFrame, onLevel }) => {
      emit = onFrame;
      level = onLevel;
      const engine = {
        played: [] as [string, number][],
        muted: false,
        volumes: {} as Record<string, number>,
        forgotten: [] as string[],
        stopped: false,
        setMuted(m: boolean) {
          engine.muted = m;
        },
        play(speaker: string, frame: VoiceFrame) {
          engine.played.push([speaker, frame.seq]);
        },
        setVolume(speaker: string, gain: number) {
          engine.volumes[speaker] = gain;
        },
        forget(speaker: string) {
          engine.forgotten.push(speaker);
        },
        stop() {
          engine.stopped = true;
        },
      };
      engines.push(engine);
      return Promise.resolve(
        options.mic === false ? { engine, mic: false, micError: "NotAllowedError" } : { engine, mic: true },
      );
    },
  });
  return {
    engines,
    speak: (seq: number, value = 200) => {
      level?.(value);
      emit?.({ seq, level: value, payload: new Uint8Array([seq]) });
    },
  };
}

let net: ReturnType<typeof memoryNetwork>;
let bob: GuestSession;
let atBob: AudioPacket[];

// Suivi du vocal démarré comme par l'assemblage de la fenêtre principale (src/bootstrap.ts).
let stopVoiceSync: () => void;
beforeAll(() => {
  stopVoiceSync = startVoiceSync();
});
afterAll(() => stopVoiceSync());

beforeEach(async () => {
  resetWorkspace();
  useCollabStore.setState({ mode: "idle", tabId: null, voice: VOICE_OFF, participants: [] });
  net = memoryNetwork();
  setCollabTransport({
    startHost: async () => ({ addr: "{}", link: net.hostLink, stop: async () => undefined }),
    connect: async () => net.connect("x"),
  });
  await shareActiveTab();
  bob = startGuest({
    link: net.connect("bob"),
    secret: parseLink(useCollabStore.getState().links!.edit)!.secret,
    name: "Bob",
    color: "#111",
  });
  atBob = [];
  bob.onAudio((p) => atBob.push(p));
  await net.settle();
});
afterEach(async () => {
  await stopSharing();
});

const hostAudio = () => useCollabStore.getState().participants.find((p) => p.id === "host")?.audio;

describe("vocal en session (O-48)", () => {
  it("personne dans le vocal par défaut ; rejoindre ouvre le micro et se voit dans la liste", async () => {
    const backend = fakeBackend();
    expect(hostAudio()).toBeUndefined();
    expect(backend.engines).toHaveLength(0);
    await joinAudio();
    await net.settle();
    expect(useCollabStore.getState().voice).toMatchObject({ status: "on", mic: true, muted: false });
    expect(bob.state.getState().participants.find((p) => p.id === "host")?.audio).toEqual({ muted: false });
  });

  it("voix dans les deux sens ; « qui parle » s'allume", async () => {
    const backend = fakeBackend();
    await joinAudio();
    bob.setVoice(true, false);
    await net.settle();
    backend.speak(1);
    bob.sendAudio({ seq: 9, level: 200, payload: new Uint8Array([9]) });
    await net.settle();
    expect(atBob.map((p) => [p.speaker, p.seq])).toEqual([["host", 1]]);
    expect(backend.engines[0]!.played).toEqual([["bob", 9]]);
    expect(useSpeakingStore.getState().ids).toEqual(expect.arrayContaining(["bob", "host"]));
  });

  it("micro coupé : rien ne part, l'icône se voit chez les autres", async () => {
    const backend = fakeBackend();
    await joinAudio();
    bob.setVoice(true, false);
    setMuted(true);
    await net.settle();
    backend.speak(1);
    await net.settle();
    expect(atBob).toEqual([]);
    expect(backend.engines[0]!.muted).toBe(true);
    expect(bob.state.getState().participants.find((p) => p.id === "host")?.audio).toEqual({ muted: true });
  });
});

describe("vocal en session (O-48)", () => {
  it("micro refusé : écoute seule, avec la raison", async () => {
    fakeBackend({ mic: false });
    await joinAudio();
    expect(useCollabStore.getState().voice).toMatchObject({
      status: "on",
      mic: false,
      muted: true,
      micError: "NotAllowedError",
    });
    setMuted(false); // impossible sans micro
    expect(useCollabStore.getState().voice.muted).toBe(true);
  });

  it("système sans Opus : vocal indisponible, rien n'est ouvert", async () => {
    const backend = fakeBackend({ support: "no-codec" });
    await joinAudio();
    expect(useCollabStore.getState().voice).toMatchObject({ status: "off", unavailable: "no-codec" });
    expect(backend.engines).toHaveLength(0);
  });

  it("volume par participant, retenu en quittant puis rejoignant l'audio", async () => {
    const backend = fakeBackend();
    await joinAudio();
    setVolume("bob", 1.5);
    setVolume("bob", 7); // borné à 200 %
    leaveAudio();
    expect(backend.engines[0]!.stopped).toBe(true);
    await joinAudio();
    expect(backend.engines[1]!.volumes).toEqual({ bob: 2 });
  });

  it("fin de session : vocal arrêté pour tous, volumes oubliés", async () => {
    const backend = fakeBackend();
    await joinAudio();
    setVolume("bob", 0.5);
    await stopSharing();
    await net.settle();
    expect(backend.engines[0]!.stopped).toBe(true);
    expect(useCollabStore.getState().voice).toEqual(VOICE_OFF);
    expect(bob.state.getState().ended).toBe("stopped");
  });
});

describe("vocal en session (O-48)", () => {
  it("participant parti : sa lecture s'arrête", async () => {
    const backend = fakeBackend();
    await joinAudio();
    bob.leave();
    await net.settle();
    expect(backend.engines[0]!.forgotten).toContain("bob");
  });
});
