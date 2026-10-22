import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { flushAutosave, startAutosave } from "./autosave";
import { entryKey, INDEX_KEY } from "./autosaveCopies";
import { addEntity } from "./commands";
import { setLocalStore } from "./localStore";
import { usePreferencesStore } from "./preferencesStore";
import { activeDocument, closeTab, openInTab } from "./workspace";

/** Stockage local en mémoire, branché sur le port (à la place d'IndexedDB). */
const data: Record<string, string> = {};
setLocalStore({
  get: (key) => Promise.resolve(data[key] ?? null),
  set: (key, value) => {
    data[key] = value;
    return Promise.resolve();
  },
  remove: (key) => {
    delete data[key];
    return Promise.resolve();
  },
});

const copyOf = (id: string) => data[entryKey(id)];
const indexed = () => JSON.parse(data[INDEX_KEY] ?? "[]") as string[];

beforeAll(async () => {
  usePreferencesStore.setState({ autosave: "indexeddb", autosaveDelay: 0 });
  startAutosave();
  // Récupération proposée au démarrage : aucune copie, le suivi des onglets commence.
  await vi.waitFor(() => expect(copyOf(activeDocument().id)).toBeUndefined());
});

afterEach(() => {
  vi.useRealTimers();
  usePreferencesStore.setState({ autosave: "indexeddb", autosaveDelay: 0 });
});

/** Sauvegarde automatique, une copie par onglet (overrides O-22, O-44). */
describe("sauvegarde automatique : copies des onglets", () => {
  it("modification : copie écrite et inscrite à l'index", async () => {
    const doc = activeDocument();
    addEntity(doc, { x: 0, y: 0 });
    await vi.waitFor(() => expect(copyOf(doc.id)).toBeDefined());
    expect(JSON.parse(copyOf(doc.id)!).content).toMatch(/"entities"/);
    expect(indexed()).toContain(doc.id);
  });

  it("document enregistré : copie effacée sans attendre", async () => {
    const doc = activeDocument();
    addEntity(doc, { x: 0, y: 0 });
    await vi.waitFor(() => expect(copyOf(doc.id)).toBeDefined());
    doc.store.getState().markSaved("/m/a.mcd");
    await vi.waitFor(() => expect(copyOf(doc.id)).toBeUndefined());
  });

  it("onglet fermé : copie effacée", async () => {
    const doc = openInTab(undefined, { reuseBlank: false });
    addEntity(doc, { x: 0, y: 0 });
    await vi.waitFor(() => expect(copyOf(doc.id)).toBeDefined());
    closeTab(doc.id);
    await vi.waitFor(() => expect(copyOf(doc.id)).toBeUndefined());
  });

  it("sauvegarde désactivée : toutes les copies effacées", async () => {
    const doc = activeDocument();
    addEntity(doc, { x: 0, y: 0 });
    await vi.waitFor(() => expect(copyOf(doc.id)).toBeDefined());
    usePreferencesStore.setState({ autosave: "off" });
    await vi.waitFor(() => expect(Object.keys(data)).toEqual([]));
  });
});

describe("sauvegarde automatique : délai entre deux écritures", () => {
  it("délai de N minutes : écriture à l'échéance, ou sans attendre quand la fenêtre passe en arrière-plan", async () => {
    vi.useFakeTimers();
    usePreferencesStore.setState({ autosaveDelay: 5 });
    const doc = openInTab(undefined, { reuseBlank: false });
    addEntity(doc, { x: 0, y: 0 }); // première écriture : immédiate
    await vi.advanceTimersByTimeAsync(0);
    const first = copyOf(doc.id);
    expect(first).toBeDefined();
    addEntity(doc, { x: 200, y: 0 }); // seconde : retenue jusqu'à l'échéance
    await vi.advanceTimersByTimeAsync(60_000);
    expect(copyOf(doc.id)).toBe(first);
    await vi.advanceTimersByTimeAsync(4 * 60_000); // échéance : 5 minutes après la première écriture
    const second = copyOf(doc.id);
    expect(second).not.toBe(first);
    addEntity(doc, { x: 400, y: 0 }); // troisième : retenue, puis écrite au passage en arrière-plan
    await vi.advanceTimersByTimeAsync(0);
    expect(copyOf(doc.id)).toBe(second);
    flushAutosave();
    await vi.advanceTimersByTimeAsync(0);
    expect(copyOf(doc.id)).not.toBe(second);
  });
});
