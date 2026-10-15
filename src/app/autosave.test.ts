import { describe, expect, it } from "vitest";
import type { LocalStore } from "@/platform/localStore";
import { readCopies, type AutosaveEntry } from "./autosave";

const memoryStore = (data: Record<string, string>): LocalStore => ({
  get: async (key) => data[key] ?? null,
  set: async (key, value) => void (data[key] = value),
  remove: async (key) => void delete data[key],
});

const entry = (filePath: string | null): AutosaveEntry => ({ savedAt: "2026-10-15T10:00:00.000Z", filePath, content: "{}" });

/** Récupération après un arrêt brutal, une copie par onglet (overrides O-22, O-44). */
describe("copies de la sauvegarde automatique", () => {
  it("dans l'ordre des onglets, avec l'ancienne copie unique des versions 0.1.x", async () => {
    const store = memoryStore({
      "modelit/autosave/documents": JSON.stringify(["b", "a"]),
      "modelit/autosave/document/a": JSON.stringify(entry("/m/a.mcd")),
      "modelit/autosave/document/b": JSON.stringify(entry(null)),
      "modelit/autosave": JSON.stringify(entry("/m/ancien.mcd")),
    });
    const { keys, copies } = await readCopies(store);
    expect(copies.map((c) => c.filePath)).toEqual([null, "/m/a.mcd", "/m/ancien.mcd"]);
    expect(keys).toEqual([
      "modelit/autosave/documents",
      "modelit/autosave/document/b",
      "modelit/autosave/document/a",
      "modelit/autosave",
    ]);
  });

  it("aucune copie", async () => {
    expect(await readCopies(memoryStore({}))).toEqual({ keys: [], copies: [] });
  });

  it("copie référencée mais absente : ignorée, sa clé reste à nettoyer", async () => {
    const store = memoryStore({ "modelit/autosave/documents": JSON.stringify(["x"]) });
    const { keys, copies } = await readCopies(store);
    expect(copies).toEqual([]);
    expect(keys).toContain("modelit/autosave/document/x");
  });
});
