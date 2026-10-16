import { emptyDocument } from "@core/index";
import { describe, expect, it } from "vitest";
import { addEntity, connectNodes, deleteObjects, moveNodes, renameNode } from "../commands";
import { ddlOf, logicalModelOf } from "../derived";
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

  it("outil de la fenêtre : Association et Héritage seulement dans le MCD (O-54)", () => {
    const doc = createDocumentHandle(emptyDocument());
    chooseTool(doc, "entity");
    showView(doc, "mld");
    expect(useUiStore.getState().tool).toBe("entity");
    showView(doc, "mcd");
    chooseTool(doc, "association");
    showView(doc, "mpd");
    expect(useUiStore.getState().tool).toBe("select");
    chooseTool(doc, "inheritance");
    expect(useUiStore.getState().tool).toBe("select");
    chooseTool(doc, "link");
    expect(useUiStore.getState().tool).toBe("link");
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

/** Géométrie séparée de la sémantique (docs/jalons/J-01, phase 3). */
describe("géométrie du schéma", () => {
  it("déplacer un objet ne recalcule ni le MLD ni le SQL", () => {
    const doc = createDocumentHandle(emptyDocument());
    const id = addEntity(doc, { x: 0, y: 0 });
    const before = doc.store.getState().doc;
    const logical = logicalModelOf(before);
    const ddl = ddlOf(before);

    moveNodes(doc, new Map([[id, { x: 300, y: 120 }]]), new Map(), "history.move");
    const after = doc.store.getState().doc;
    expect(after).not.toBe(before);
    expect(after.layout.positions[id]).toEqual({ x: 300, y: 120 });
    expect(logicalModelOf(after)).toBe(logical);
    expect(ddlOf(after)).toBe(ddl);

    renameNode(doc, id, "CLIENT");
    expect(logicalModelOf(doc.store.getState().doc)).not.toBe(logical);
  });

  it("supprimer un objet retire sa position et les cassures de ses traits", () => {
    const doc = createDocumentHandle(emptyDocument());
    const a = addEntity(doc, { x: 0, y: 0 });
    const b = addEntity(doc, { x: 400, y: 0 });
    const result = connectNodes(doc, a, b, { associationPosition: { x: 200, y: 0 } });
    if (!result || !("created" in result)) throw new Error("association non créée");
    const [leg] = doc.store.getState().doc.links;
    moveNodes(doc, new Map(), new Map([[leg!.id, [{ x: 100, y: 50 }]]]));
    expect(Object.keys(doc.store.getState().doc.layout.bends)).toEqual([leg!.id]);

    deleteObjects(doc, [a]);
    const { layout } = doc.store.getState().doc;
    expect(Object.keys(layout.positions).sort()).toEqual([b, result.created].sort());
    expect(layout.bends).toEqual({});
  });
});
