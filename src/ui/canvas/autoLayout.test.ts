import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/** Faux Worker : garde les lots reçus, ne répond jamais de lui-même ; `fail` simule une erreur du Worker. */
class FakeWorker {
  static all: FakeWorker[] = [];
  posted: unknown[] = [];
  terminated = false;
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: ((event: { message: string; preventDefault: () => void }) => void) | null = null;
  constructor() {
    FakeWorker.all.push(this);
  }
  postMessage(task: unknown) {
    this.posted.push(task);
  }
  terminate() {
    this.terminated = true;
  }
  fail(message: string) {
    this.onerror?.({ message, preventDefault: () => undefined });
  }
}

const live = () => FakeWorker.all.filter((w) => !w.terminated);
const nodes = [{ id: "a", width: 100, height: 40 }];

beforeAll(() => {
  vi.stubGlobal("Worker", FakeWorker);
  // Deux Workers (cœurs - 1) ; la langue sert aux options du poste.
  vi.stubGlobal("navigator", { hardwareConcurrency: 3, language: "fr-FR" });
});
afterAll(() => vi.unstubAllGlobals());

/** Adaptateur Workers du placement automatique (override O-62) : annulable, jamais sur le fil de l'interface. */
describe("placement automatique dans les Workers", () => {
  it("annulé pendant le calcul : rejeté aussitôt, Workers occupés arrêtés et remplacés", async () => {
    const { workerLayoutRunner } = await import("./autoLayout");
    const controller = new AbortController();
    const run = workerLayoutRunner.run(nodes, [], controller.signal);
    await vi.waitFor(() => expect(live().every((w) => w.posted.length === 1)).toBe(true));
    const busy = live();
    controller.abort();
    await expect(run).rejects.toThrow();
    expect(busy.every((w) => w.terminated)).toBe(true);
    expect(live()).toHaveLength(busy.length);
  });

  it("Worker en échec : placement rejeté, aucun calcul de repli sur le fil de l'interface", async () => {
    const { workerLayoutRunner } = await import("./autoLayout");
    const run = workerLayoutRunner.run(nodes, [], new AbortController().signal);
    await vi.waitFor(() => expect(live().every((w) => w.posted.length === 1)).toBe(true));
    live()[0]!.fail("boom");
    await expect(run).rejects.toThrow("boom");
  });

  it("annulé en attendant son tour : aucun lot envoyé", async () => {
    const { workerLayoutRunner } = await import("./autoLayout");
    const posts = () => FakeWorker.all.reduce((n, w) => n + w.posted.length, 0);
    const before = posts();
    const first = new AbortController();
    const blocking = workerLayoutRunner.run(nodes, [], first.signal);
    const queued = new AbortController();
    const waiting = workerLayoutRunner.run(nodes, [], queued.signal);
    queued.abort();
    await vi.waitFor(() => expect(posts() - before).toBe(2));
    first.abort();
    await expect(blocking).rejects.toThrow();
    await expect(waiting).rejects.toThrow();
    // Seuls les deux lots du premier placement sont partis.
    expect(posts() - before).toBe(2);
  });
});
