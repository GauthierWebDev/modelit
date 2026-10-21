// Worklets du vocal (O-48, D18), exécutés dans le fil audio. JavaScript simple : un AudioWorklet
// est chargé par URL (CSP `script-src 'self'`), sans passer par la compilation TypeScript.

/** Trames de 20 ms à 48 kHz. */
const FRAME = 960;

/** Capture : découpe le micro en trames de 20 ms, envoyées au fil principal. */
class CaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.frame = new Float32Array(FRAME);
    this.filled = 0;
  }

  process(inputs) {
    const input = inputs[0]?.[0];
    if (!input) {
      return true;
    }
    let offset = 0;
    while (offset < input.length) {
      const n = Math.min(FRAME - this.filled, input.length - offset);
      this.frame.set(input.subarray(offset, offset + n), this.filled);
      this.filled += n;
      offset += n;
      if (this.filled === FRAME) {
        this.port.postMessage(this.frame, [this.frame.buffer]);
        this.frame = new Float32Array(FRAME);
        this.filled = 0;
      }
    }
    return true;
  }
}

/**
 * Lecture d'un participant : tampon de gigue. La lecture démarre quand 60 ms sont en réserve ;
 * au-delà de 240 ms de retard, le plus ancien est abandonné (la latence ne s'accumule pas) ; un
 * manque produit du silence, puis la réserve se reconstitue.
 */
class PlayerProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.capacity = 48_000; // 1 s
    this.buffer = new Float32Array(this.capacity);
    this.read = 0;
    this.size = 0;
    this.playing = false;
    this.start = 2880; // 60 ms
    this.max = 11_520; // 240 ms
    this.port.onmessage = (event) => this.push(event.data);
  }

  push(samples) {
    // biome-ignore lint/style/useForOf: boucle du fil audio temps réel, gardée en indices
    for (let i = 0; i < samples.length; i += 1) {
      if (this.size === this.capacity) {
        this.read = (this.read + 1) % this.capacity;
        this.size -= 1;
      }
      this.buffer[(this.read + this.size) % this.capacity] = samples[i];
      this.size += 1;
    }
    if (this.size > this.max) {
      const drop = this.size - this.start;
      this.read = (this.read + drop) % this.capacity;
      this.size -= drop;
    }
  }

  process(_inputs, outputs) {
    const output = outputs[0][0];
    if (!this.playing && this.size >= this.start) {
      this.playing = true;
    }
    for (let i = 0; i < output.length; i += 1) {
      if (this.playing && this.size > 0) {
        output[i] = this.buffer[this.read];
        this.read = (this.read + 1) % this.capacity;
        this.size -= 1;
      } else {
        output[i] = 0;
        this.playing = false;
      }
    }
    for (let c = 1; c < outputs[0].length; c += 1) {
      outputs[0][c].set(output);
    }
    return true;
  }
}

registerProcessor("modelit-capture", CaptureProcessor);
registerProcessor("modelit-player", PlayerProcessor);
