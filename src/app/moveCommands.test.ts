import { describe, expect, it } from "vitest";
import { addEntity } from "./commands";
import { createDocumentHandle } from "./document/handle";
import { newModelDocument } from "./modelDefaults";
import { beginMove } from "./moveCommands";

const setup = () => {
  const doc = createDocumentHandle(newModelDocument());
  const a = addEntity(doc, { x: 0, y: 0 });
  const b = addEntity(doc, { x: 300, y: 0 });
  return { doc, a, b, position: (id: string) => doc.store.getState().doc.layout.positions[id] };
};

/** Déplacement en une transaction (glisser, flèches ; audit A-01, U-1). */
describe("transaction de déplacement", () => {
  it("aperçus successifs puis validation : une seule entrée d'historique", () => {
    const { doc, a, b, position } = setup();
    const before = doc.store.getState().past.length;
    const move = beginMove(doc, [a, b], null)!;
    expect(move.count).toBe(2);
    move.update({ x: 10, y: 0 });
    move.update({ x: 40, y: 20 });
    move.commit("history.moveSelection");
    expect(position(a)).toEqual({ x: 40, y: 20 });
    expect(position(b)).toEqual({ x: 340, y: 20 });
    expect(doc.store.getState().past.length).toBe(before + 1);
    doc.store.getState().undo();
    expect(position(a)).toEqual({ x: 0, y: 0 });
  });

  it("annulée : positions d'origine, historique inchangé", () => {
    const { doc, a, position } = setup();
    const before = doc.store.getState().past.length;
    const move = beginMove(doc, [a], 10)!;
    move.update({ x: 33, y: 0 });
    move.cancel();
    expect(position(a)).toEqual({ x: 0, y: 0 });
    expect(doc.store.getState().past.length).toBe(before);
  });

  it("rien à déplacer : pas de transaction", () => {
    const { doc } = setup();
    expect(beginMove(doc, [], null)).toBeNull();
    expect(doc.store.getState().transactionStart).toBeNull();
  });
});
