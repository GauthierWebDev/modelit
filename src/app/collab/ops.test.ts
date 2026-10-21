import { emptyDocument, type ModelDocument } from "@core/index";
import { describe, expect, it } from "vitest";
import * as cmd from "../commands";
import { createDocumentHandle } from "../document/handle";
import { apply, diff } from "./ops";

/** Document de départ : deux entités reliées, avec rubriques, paramètres et géométrie. */
function sample() {
  const doc = createDocumentHandle(emptyDocument());
  const client = cmd.addEntity(doc, { x: 0, y: 0 });
  cmd.renameNode(doc, client, "CLIENT");
  const commande = cmd.addEntity(doc, { x: 400, y: 0 });
  cmd.renameNode(doc, commande, "COMMANDE");
  const result = cmd.connectNodes(doc, client, commande, { associationPosition: { x: 200, y: 0 } });
  if (!result || !("created" in result)) {
    throw new Error("association");
  }
  cmd.addAutoIdentifier(doc, client);
  return { doc, client, commande, association: result.created };
}

const roundTrip = (before: ModelDocument, after: ModelDocument) =>
  expect(apply(before, diff(before, after))).toEqual(after);

/** Opérations de session (O-05, J-01 D11). */
describe("opérations par identifiant", () => {
  it("aller-retour exact sur des modifications variées", () => {
    const { doc, client, commande, association } = sample();
    const steps: (() => void)[] = [
      () => cmd.renameNode(doc, client, "CLIENTS"),
      () => cmd.addEntity(doc, { x: 50, y: 300 }),
      () =>
        cmd.setAttributes(doc, commande, [
          ...doc.store.getState().doc.entities[1]!.attributes,
          ...doc.store.getState().doc.entities[0]!.attributes.map((a) => ({ ...a, id: `${a.id}-copie` })),
        ]),
      () => cmd.setLinkCardinality(doc, doc.store.getState().doc.links[0]!.id, { min: 1, max: "n" }),
      () => cmd.setTargetDbms(doc, "mysql"),
      () =>
        cmd.moveNodes(
          doc,
          new Map([[client, { x: 10, y: 20 }]]),
          new Map([[doc.store.getState().doc.links[0]!.id, [{ x: 5, y: 5 }]]]),
        ),
      () => cmd.updateEntity(doc, commande, { comment: "à revoir" }),
      () => cmd.updateEntity(doc, commande, { comment: undefined }),
      () => cmd.deleteObjects(doc, [association]),
      () => cmd.deleteObjects(doc, [client]),
    ];
    for (const step of steps) {
      const before = doc.store.getState().doc;
      step();
      roundTrip(before, doc.store.getState().doc);
    }
  });

  it("ordre des rubriques", () => {
    const { doc, client } = sample();
    cmd.setAttributes(doc, client, [
      ...doc.store.getState().doc.entities[0]!.attributes,
      { id: "b", name: "nom", identifier: false, notNull: false, unique: false },
    ]);
    const before = doc.store.getState().doc;
    cmd.setAttributes(doc, client, [...before.entities[0]!.attributes].reverse());
    const ops = diff(before, doc.store.getState().doc);
    expect(ops.map((o) => o.t)).toEqual(["order"]);
    roundTrip(before, doc.store.getState().doc);
  });

  it("deux participants modifient deux rubriques d'une même entité : les deux sont gardées", () => {
    const { doc, client } = sample();
    cmd.setAttributes(doc, client, [
      ...doc.store.getState().doc.entities[0]!.attributes,
      { id: "nom", name: "nom", identifier: false, notNull: false, unique: false },
    ]);
    const base = doc.store.getState().doc;
    const alice = produceAttr(base, client, 0, "code_client");
    const bob = produceAttr(base, client, 1, "nom_complet");
    const merged = apply(apply(base, diff(base, alice)), diff(base, bob));
    expect(merged.entities[0]!.attributes.map((a) => a.name)).toEqual(["code_client", "nom_complet"]);
  });

  it("même champ modifié par deux participants : la dernière opération appliquée l'emporte", () => {
    const { doc, client } = sample();
    const base = doc.store.getState().doc;
    const rename = (name: string) =>
      apply(base, [{ t: "set", coll: "entities", id: client, field: "name", value: name }]);
    const merged = apply(apply(base, diff(base, rename("A"))), diff(base, rename("B")));
    expect(merged.entities[0]!.name).toBe("B");
  });

  it("opération sur un objet supprimé entre-temps : ignorée", () => {
    const { doc, client } = sample();
    const base = doc.store.getState().doc;
    const renamed = diff(base, apply(base, [{ t: "set", coll: "entities", id: client, field: "name", value: "X" }]));
    const deleted = apply(base, [{ t: "remove", coll: "entities", id: client }]);
    expect(apply(deleted, renamed)).toEqual(deleted);
  });

  it("ajout reçu deux fois (écho) : un seul objet", () => {
    const { doc } = sample();
    const before = doc.store.getState().doc;
    cmd.addEntity(doc, { x: 0, y: 500 });
    const ops = diff(before, doc.store.getState().doc);
    const once = apply(before, ops);
    expect(apply(once, ops).entities).toHaveLength(once.entities.length);
  });
});

function produceAttr(base: ModelDocument, owner: string, index: number, name: string): ModelDocument {
  return apply(base, [
    {
      t: "set",
      coll: "entities",
      owner,
      id: base.entities.find((e) => e.id === owner)!.attributes[index]!.id,
      field: "name",
      value: name,
    },
  ]);
}
