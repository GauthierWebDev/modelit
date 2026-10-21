import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";

/**
 * Worklets du vocal (O-48, D18), hors navigateur : le fichier est évalué avec des remplaçants des
 * globales d'AudioWorklet, pour vérifier le découpage en trames et le tampon de gigue.
 */
type Port = { postMessage: (data: Float32Array) => void; onmessage?: (event: { data: Float32Array }) => void };
type Processor = { port: Port; process: (inputs: Float32Array[][], outputs: Float32Array[][]) => boolean };
const processors = new Map<string, new () => Processor>();

beforeAll(() => {
  class AudioWorkletProcessor {
    port: Port = { postMessage: () => undefined };
  }
  const source = readFileSync(new URL("./voiceWorklet.js", import.meta.url), "utf8");
  new Function("AudioWorkletProcessor", "registerProcessor", source)(
    AudioWorkletProcessor,
    (name: string, cls: new () => Processor) => processors.set(name, cls),
  );
});

const block = (value: number, n = 128) => new Float32Array(n).fill(value);

describe("worklets du vocal", () => {
  it("capture : trames de 960 échantillons (20 ms), quel que soit le découpage du fil audio", () => {
    const capture = new (processors.get("modelit-capture")!)();
    const frames: Float32Array[] = [];
    capture.port.postMessage = (f) => frames.push(f);
    for (let i = 0; i < 16; i += 1) {
      capture.process([[block(i)]], []); // 16 × 128 = 2048 échantillons
    }
    expect(frames.map((f) => f.length)).toEqual([960, 960]);
    expect(frames[1]![0]).toBe(7); // 960 = 7 × 128 + 64 : la 2ᵉ trame commence au milieu du 8ᵉ bloc
  });

  function player() {
    const p = new (processors.get("modelit-player")!)();
    const push = (samples: Float32Array) => p.port.onmessage!({ data: samples });
    const pull = () => {
      const out = [new Float32Array(128)];
      p.process([], [out]);
      return out[0]!;
    };
    return { push, pull };
  }

  it("lecture : silence tant que 60 ms ne sont pas en réserve, puis la voix", () => {
    const { push, pull } = player();
    push(block(0.5, 960)); // 20 ms
    expect(pull().every((x) => x === 0)).toBe(true);
    push(block(0.5, 1920)); // 60 ms en tout
    expect(pull().every((x) => x === 0.5)).toBe(true);
  });

  it("lecture : un manque produit du silence, puis la réserve se reconstitue", () => {
    const { push, pull } = player();
    push(block(0.5, 2880));
    for (let i = 0; i < 22; i += 1) {
      pull(); // 22 × 128 = 2816 : il reste 64 échantillons
    }
    const last = pull();
    expect(last.slice(0, 64).every((x) => x === 0.5)).toBe(true);
    expect(last.slice(64).every((x) => x === 0)).toBe(true);
    push(block(0.25, 960));
    expect(pull().every((x) => x === 0)).toBe(true); // 20 ms ne suffisent pas pour repartir
  });

  it("lecture : au-delà de 240 ms de retard, le plus ancien est abandonné", () => {
    const { push, pull } = player();
    push(block(0.125, 9600)); // 200 ms
    push(block(0.75, 4800)); // + 100 ms → 300 ms : on revient à 60 ms, les plus récents
    expect(pull().every((x) => x === 0.75)).toBe(true);
    let played = 128;
    while (pull().some((x) => x !== 0)) {
      played += 128;
    }
    expect(played).toBeLessThanOrEqual(2880 + 128);
  });
});
