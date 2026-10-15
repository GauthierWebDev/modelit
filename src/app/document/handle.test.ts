import { emptyDocument } from "@core/index";
import { describe, expect, it } from "vitest";
import { addEntity, deleteObjects, renameNode } from "../commands";
import { logicalModelOf } from "../derived";
import { useUiStore } from "../uiStore";
import { chooseTool, showView } from "../viewCommands";
import { createDocumentHandle } from "./handle";

/** Plusieurs documents ouverts en même temps restent indépendants (docs/jalons/J-01, phase 1). */
describe("documents instanciables", () => {
  it("contenu et historique propres à chaque document", () => {
    const a = createDocumentHandle(emptyDocument());
    const b = createDocumentHandle(emptyDocument());
    expect(a.id).not.toBe(b.id);

    const id = addEntity(a, { x: 0, y: 0 });
    expect(a.store.getState().doc.entities.map((e) => e.id)).toEqual([id]);
    expect(b.store.getState().doc.entities).toEqual([]);
    expect(b.store.getState().past).toEqual([]);

    b.store.getState().undo();
    expect(a.store.getState().doc.entities).toHaveLength(1);
    a.store.getState().undo();
    expect(a.store.getState().doc.entities).toEqual([]);
  });

  it("la validation porte sur le document visé", () => {
    const a = createDocumentHandle(emptyDocument());
    const b = createDocumentHandle(emptyDocument());
    const inA = addEntity(a, { x: 0, y: 0 });
    const inB = addEntity(b, { x: 0, y: 0 });
    expect(renameNode(a, inA, "CLIENT")).toBeNull();
    // Même nom, autre document : aucun conflit.
    expect(renameNode(b, inB, "CLIENT")).toBeNull();
    const other = addEntity(a, { x: 100, y: 0 });
    expect(renameNode(a, other, "CLIENT")).not.toBeNull();
  });

  it("sélection et vue propres à chaque document", () => {
    const a = createDocumentHandle(emptyDocument());
    const b = createDocumentHandle(emptyDocument());
    const id = addEntity(a, { x: 0, y: 0 });
    a.view.getState().select([id]);
    b.view.getState().select(["autre"]);
    deleteObjects(a, [id]);
    expect(a.view.getState().selection).toEqual([]);
    expect(b.view.getState().selection).toEqual(["autre"]);

    showView(b, "mpd");
    expect(a.view.getState().view).toBe("mcd");
    expect(b.view.getState().view).toBe("mpd");
  });

  it("outil de la fenêtre : seulement dans le MCD, remis à Sélection en quittant le MCD", () => {
    const doc = createDocumentHandle(emptyDocument());
    chooseTool(doc, "entity");
    expect(useUiStore.getState().tool).toBe("entity");
    showView(doc, "mld");
    expect(useUiStore.getState().tool).toBe("select");
    chooseTool(doc, "entity");
    expect(useUiStore.getState().tool).toBe("select");
  });

  it("MLD dérivé mis en cache par document : deux documents ne se chassent pas", () => {
    const a = createDocumentHandle(emptyDocument());
    const b = createDocumentHandle(emptyDocument());
    addEntity(a, { x: 0, y: 0 });
    const docA = a.store.getState().doc;
    const docB = b.store.getState().doc;
    const first = logicalModelOf(docA);
    logicalModelOf(docB);
    expect(logicalModelOf(docA)).toBe(first);
  });
});
