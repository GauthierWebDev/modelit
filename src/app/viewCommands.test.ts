import { describe, expect, it } from "vitest";
import { toolAvailable } from "./viewCommands";

/** Outils selon la vue (override O-54). */
describe("outils disponibles", () => {
  it("Entité et Lien partout ; Association et Héritage seulement dans le MCD", () => {
    for (const view of ["mcd", "mld", "mpd"] as const) {
      expect(toolAvailable("select", view)).toBe(true);
      expect(toolAvailable("entity", view)).toBe(true);
      expect(toolAvailable("link", view)).toBe(true);
      expect(toolAvailable("association", view)).toBe(view === "mcd");
      expect(toolAvailable("inheritance", view)).toBe(view === "mcd");
    }
  });
});
