import { emptyDocument } from "@core/index";
import { describe, expect, it } from "vitest";
import { createDocumentStore, selectIsDirty, selectRedoLabel, selectUndoLabel } from "./documentStore";

const rename = (name: string) => (d: { settings: { naming: { typology: string } } }) => {
  d.settings.naming.typology = name;
};
const typology = (store: ReturnType<typeof createDocumentStore>) => store.getState().doc.settings.naming.typology;

describe("store de document", () => {
  it("change : une entrée d'historique, annuler puis rétablir", () => {
    const store = createDocumentStore(emptyDocument());
    const before = store.getState().doc;
    store.getState().change("history.typology", rename("a"));
    expect(typology(store)).toBe("a");
    expect(selectUndoLabel(store.getState())).toBe("history.typology");

    store.getState().undo();
    expect(store.getState().doc).toBe(before);
    expect(selectRedoLabel(store.getState())).toBe("history.typology");

    store.getState().redo();
    expect(typology(store)).toBe("a");
    expect(selectRedoLabel(store.getState())).toBeUndefined();
  });

  it("une modification sans effet n'ajoute rien à l'historique", () => {
    const store = createDocumentStore(emptyDocument());
    store.getState().change("history.typology", () => undefined);
    expect(store.getState().past).toEqual([]);
  });

  it("transaction : aperçus multiples, une seule entrée ; annulation possible", () => {
    const store = createDocumentStore(emptyDocument());
    const before = store.getState().doc;
    store.getState().begin();
    store.getState().preview(rename("a"));
    store.getState().preview(rename("b"));
    expect(() => store.getState().change("history.typology", rename("c"))).toThrow();
    store.getState().commit("history.move");
    expect(typology(store)).toBe("b");
    expect(store.getState().past.map((e) => e.label)).toEqual(["history.move"]);
    expect(store.getState().past[0]!.doc).toBe(before);

    store.getState().begin();
    store.getState().preview(rename("z"));
    store.getState().cancel();
    expect(typology(store)).toBe("b");
    expect(store.getState().past).toHaveLength(1);
  });

  it("historique limité à 200 entrées", () => {
    const store = createDocumentStore(emptyDocument());
    for (let i = 0; i < 205; i++) {
      store.getState().change("history.typology", rename(`v${i}`));
    }
    expect(store.getState().past).toHaveLength(200);
  });

  it("indicateur de modification : chargement, modification, enregistrement, récupération", () => {
    const store = createDocumentStore(emptyDocument());
    expect(selectIsDirty(store.getState())).toBe(false);
    store.getState().change("history.typology", rename("a"));
    expect(selectIsDirty(store.getState())).toBe(true);
    store.getState().markSaved("/tmp/a.mcd");
    expect(selectIsDirty(store.getState())).toBe(false);
    expect(store.getState().filePath).toBe("/tmp/a.mcd");

    store.getState().load(emptyDocument(), null, true);
    expect(selectIsDirty(store.getState())).toBe(true);
    expect(store.getState().past).toEqual([]);

    store.getState().restore(emptyDocument(), "/tmp/b.mcd");
    expect(store.getState().recovered).toBe(true);
    expect(selectIsDirty(store.getState())).toBe(true);
  });
});
