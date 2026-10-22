// biome-ignore-all lint/suspicious/noBitwiseOperators: traitement des échantillons audio
/**
 * Moteur du vocal (O-48, D18) : capture du micro avec le traitement vocal du système (annulation
 * d'écho, réduction du bruit), compression Opus (WebCodecs), lecture de chaque participant avec son
 * propre tampon et son volume. Le transport (datagrammes) et la logique de session sont ailleurs
 * (`app/collab`) ; ce module ne connaît que les API audio du webview.
 */

export const SAMPLE_RATE = 48_000;
export const FRAME = 960; // 20 ms
const BITRATE = 24_000;
/** Seuil de parole (dBFS) et maintien après la dernière trame au-dessus : rien n'est envoyé dans les silences. */
const GATE_DB = -50;
const HANGOVER_MS = 400;

const ENCODER_CONFIG: AudioEncoderConfig = {
  codec: "opus",
  sampleRate: SAMPLE_RATE,
  numberOfChannels: 1,
  bitrate: BITRATE,
};
const DECODER_CONFIG: AudioDecoderConfig = { codec: "opus", sampleRate: SAMPLE_RATE, numberOfChannels: 1 };

/** Paquet produit par le moteur : 20 ms de voix compressée, numéro de séquence, niveau (0–255). */
export interface VoiceFrame {
  seq: number;
  level: number;
  payload: Uint8Array;
}

/** Niveau d'une trame : dBFS ramenés à 0–255 (−60 dB → 0, 0 dB → 255). */
export function levelOf(samples: Float32Array): number {
  let sum = 0;
  for (const s of samples) {
    sum += s * s;
  }
  const db = 10 * Math.log10(sum / samples.length + 1e-12);
  return Math.max(0, Math.min(255, Math.round(((db + 60) / 60) * 255)));
}
const GATE_LEVEL = ((GATE_DB + 60) / 60) * 255;

/** Le vocal est-il possible dans ce webview (micro exposé, WebCodecs Opus, AudioWorklet) ? */
export async function voiceSupport(): Promise<"ok" | "no-codec" | "no-media"> {
  if (
    typeof AudioWorkletNode === "undefined" ||
    typeof AudioEncoder === "undefined" ||
    typeof AudioDecoder === "undefined"
  ) {
    return "no-codec";
  }
  try {
    const [enc, dec] = await Promise.all([
      AudioEncoder.isConfigSupported(ENCODER_CONFIG),
      AudioDecoder.isConfigSupported(DECODER_CONFIG),
    ]);
    if (!(enc.supported && dec.supported)) {
      return "no-codec";
    }
  } catch {
    return "no-codec";
  }
  // Sans description d'usage du micro (macOS : Info.plist), WebKit n'expose pas `mediaDevices`.
  return typeof navigator.mediaDevices?.getUserMedia === "function" ? "ok" : "no-media";
}

export interface VoiceEngine {
  /** Micro coupé : plus rien n'est capturé ni envoyé. */
  setMuted: (muted: boolean) => void;
  /** Voix reçue d'un participant. */
  play: (speaker: string, frame: VoiceFrame) => void;
  /** Volume d'un participant, de 0 à 2 (200 %). */
  setVolume: (speaker: string, gain: number) => void;
  /** Participant parti : sa lecture s'arrête. */
  forget: (speaker: string) => void;
  stop: () => void;
}

export interface StartOptions {
  onFrame: (frame: VoiceFrame) => void;
  /** Mon niveau (0–255), à chaque trame : « qui parle » pour moi-même. */
  onLevel?: (level: number) => void;
  /** Source sonore imposée (tests : oscillateur) ; sinon le micro. */
  input?: (context: AudioContext) => AudioNode;
}

/**
 * Démarre le vocal. `mic` : faux si le micro est refusé ou absent (écoute seule, O-48 « Micro
 * refusé ») ; `micError` en donne la raison.
 */
// biome-ignore lint/complexity/noExcessiveLinesPerFunction: moteur du vocal sans test automatique ni test humain encore possible (O-48) ; découpage reporté après les tests sur deux postes
export async function startVoice({
  onFrame,
  onLevel,
  input,
}: StartOptions): Promise<{ engine: VoiceEngine; mic: boolean; micError?: string }> {
  const context = new AudioContext({ sampleRate: SAMPLE_RATE, latencyHint: "interactive" });
  await context.audioWorklet.addModule(new URL("./voiceWorklet.js", import.meta.url));
  if (context.state === "suspended") {
    await context.resume().catch(() => undefined);
  }

  // ——— Capture ———
  let stream: MediaStream | null = null;
  let source: AudioNode | null = null;
  let micError: string | undefined;
  if (input) {
    source = input(context);
  } else {
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
      });
      source = context.createMediaStreamSource(stream);
    } catch (e) {
      micError = e instanceof DOMException ? e.name : String(e);
    }
  }

  let muted = false;
  let seq = 0;
  let openUntil = 0;
  const levels: number[] = [];
  let timestamp = 0;
  const encoder = new AudioEncoder({
    output: (chunk) => {
      const payload = new Uint8Array(chunk.byteLength);
      chunk.copyTo(payload);
      const frameSeq = seq & 0xff_ff;
      seq += 1;
      onFrame({ seq: frameSeq, level: levels.shift() ?? 0, payload });
    },
    error: () => undefined,
  });
  encoder.configure(ENCODER_CONFIG);

  let capture: AudioWorkletNode | null = null;
  if (source) {
    capture = new AudioWorkletNode(context, "modelit-capture", {
      numberOfInputs: 1,
      numberOfOutputs: 0,
      channelCount: 1,
    });
    capture.port.onmessage = (event: MessageEvent<Float32Array<ArrayBuffer>>) => {
      const samples = event.data;
      const level = levelOf(samples);
      onLevel?.(muted ? 0 : level);
      const now = performance.now();
      if (level >= GATE_LEVEL) {
        openUntil = now + HANGOVER_MS;
      }
      // Silence ou micro coupé : rien n'est encodé ni envoyé.
      if (muted || now > openUntil || encoder.state !== "configured") {
        return;
      }
      levels.push(level);
      const data = new AudioData({
        format: "f32",
        sampleRate: SAMPLE_RATE,
        numberOfFrames: samples.length,
        numberOfChannels: 1,
        timestamp,
        data: samples,
      });
      timestamp += (samples.length / SAMPLE_RATE) * 1_000_000;
      encoder.encode(data);
      data.close();
    };
    source.connect(capture);
  }

  // ——— Lecture ———
  const players = new Map<string, { decoder: AudioDecoder; node: AudioWorkletNode; gain: GainNode; last: number }>();
  const volumes = new Map<string, number>();
  const playerOf = (speaker: string) => {
    let player = players.get(speaker);
    if (player) {
      return player;
    }
    const node = new AudioWorkletNode(context, "modelit-player", {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [1],
    });
    const gain = context.createGain();
    gain.gain.value = volumes.get(speaker) ?? 1;
    node.connect(gain).connect(context.destination);
    const decoder = new AudioDecoder({
      output: (data) => {
        const samples = new Float32Array(data.numberOfFrames);
        data.copyTo(samples, { planeIndex: 0, format: "f32-planar" });
        data.close();
        node.port.postMessage(samples, [samples.buffer]);
      },
      error: () => undefined,
    });
    decoder.configure(DECODER_CONFIG);
    player = { decoder, node, gain, last: -1 };
    players.set(speaker, player);
    return player;
  };

  const engine: VoiceEngine = {
    setMuted(value) {
      muted = value;
      for (const t of stream?.getAudioTracks() ?? []) {
        t.enabled = !value;
      }
    },
    play(speaker, frame) {
      const player = playerOf(speaker);
      // Paquet en retard (arrivé après un plus récent) : ignoré. Numéros sur 16 bits, qui bouclent.
      if (player.last >= 0) {
        const delta = (frame.seq - player.last + 0x1_00_00) & 0xff_ff;
        if (delta === 0 || delta > 0x80_00) {
          return;
        }
      }
      player.last = frame.seq;
      if (player.decoder.state !== "configured") {
        return;
      }
      player.decoder.decode(new EncodedAudioChunk({ type: "key", timestamp: frame.seq * 20_000, data: frame.payload }));
    },
    setVolume(speaker, gain) {
      const value = Math.max(0, Math.min(2, gain));
      volumes.set(speaker, value);
      const player = players.get(speaker);
      if (player) {
        player.gain.gain.setTargetAtTime(value, context.currentTime, 0.02);
      }
    },
    forget(speaker) {
      const player = players.get(speaker);
      if (!player) {
        return;
      }
      players.delete(speaker);
      if (player.decoder.state !== "closed") {
        player.decoder.close();
      }
      player.node.disconnect();
      player.gain.disconnect();
    },
    stop() {
      for (const speaker of [...players.keys()]) {
        engine.forget(speaker);
      }
      capture?.disconnect();
      source?.disconnect();
      for (const t of stream?.getTracks() ?? []) {
        t.stop();
      }
      if (encoder.state !== "closed") {
        encoder.close();
      }
      void context.close();
    },
  };
  return { engine, mic: source !== null, ...(micError ? { micError } : {}) };
}
