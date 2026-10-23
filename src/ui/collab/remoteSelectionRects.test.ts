import type { Rect } from "@core/index";
import { describe, expect, it } from "vitest";
import type { RemotePresence } from "@/app/collab/sessionState";
import { remoteSelectionRects } from "./remoteSelectionRects";

const box = (x: number): Rect => ({ x, y: 0, width: 100, height: 40 });
const boxes = new Map([
  ["client", box(0)],
  ["commande", box(200)],
]);
const at = (view: RemotePresence["view"], selection: string[]): RemotePresence => ({
  view,
  selection,
  cursor: null,
  movedAt: 0,
});
const participants = [
  { id: "me", name: "Alice", color: "#e11d48", role: "host" as const },
  { id: "bob", name: "Bob", color: "#2563eb", role: "editor" as const },
  { id: "eve", name: "Eve", color: "#16a34a", role: "reader" as const },
];

/** Sélection des autres participants (O-05 §5, précisé le 2026-10-23). */
describe("sélection des autres participants", () => {
  it("boîtes sélectionnées par les autres sur ma vue, à leur couleur ; pas la mienne", () => {
    const presence = { me: at("mcd", ["client"]), bob: at("mcd", ["client", "commande"]) };
    expect(remoteSelectionRects({ presence, participants, you: "me" }, "mcd", boxes)).toEqual([
      { key: "bob:client", color: "#2563eb", rect: box(0) },
      { key: "bob:commande", color: "#2563eb", rect: box(200) },
    ]);
  });

  it("autre vue, objet sans boîte (patte) ou participant sans présence : rien", () => {
    const presence = { bob: at("mld", ["client"]), eve: at("mcd", ["patte-1"]) };
    expect(remoteSelectionRects({ presence, participants, you: "me" }, "mcd", boxes)).toEqual([]);
  });
});
