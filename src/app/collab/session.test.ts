import { emptyDocument } from "@core/index";
import { byCodeUnit } from "@core/testing/order";
import { describe, expect, it } from "vitest";
import * as cmd from "../commands";
import { createDocumentViewStore } from "../document/documentView";
import type { DocumentHandle } from "../document/handle";
import { type GuestSession, startGuest } from "./guest";
import { type HostSession, startHost } from "./host";
import { memoryNetwork as network } from "./memoryNetwork";
import type { SessionStore } from "./sessionStore";

const handle = (store: SessionStore): DocumentHandle => ({
  id: crypto.randomUUID(),
  store,
  view: createDocumentViewStore(),
});
/** Comparaison indépendante de l'ordre des clés (la géométrie est un dictionnaire). */
const canonical = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map(canonical)
    : value && typeof value === "object"
      ? Object.fromEntries(
          Object.entries(value)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([k, v]) => [k, canonical(v)]),
        )
      : value;
const names = (store: SessionStore) =>
  store
    .getState()
    .doc.entities.map((e) => e.name)
    .sort(byCodeUnit);

function session() {
  const net = network();
  const host: HostSession = startHost({
    link: net.hostLink,
    doc: emptyDocument(),
    secrets: { editor: "edit-secret", reader: "read-secret" },
    me: { id: "alice", name: "Alice", color: "#e11d48" },
  });
  const join = (peer: string, secret = "edit-secret"): GuestSession =>
    startGuest({ link: net.connect(peer), secret, name: peer, color: "#2563eb" });
  const bob = join("bob");
  const claire = join("claire");
  net.flush();
  const h = { alice: handle(host.store), bob: handle(bob.store), claire: handle(claire.store) };
  const converged = () => {
    net.flush();
    const reference = JSON.stringify(canonical(host.store.getState().doc));
    expect(JSON.stringify(canonical(bob.store.getState().doc))).toBe(reference);
    expect(JSON.stringify(canonical(claire.store.getState().doc))).toBe(reference);
  };
  return { net, host, bob, claire, join, h, converged };
}

/** Session collaborative (O-05 ; J-01, phase 5a, D11) : hôte et deux invités en mémoire. */
describe("session collaborative", () => {
  it("arrivée : document de l'hôte, rôles, liste des participants", () => {
    const { host, bob, net } = session();
    cmd.addEntity(handle(host.store), { x: 0, y: 0 });
    net.flush();
    const late = startGuest({ link: net.connect("david"), secret: "read-secret", name: "David", color: "#000" });
    net.flush();
    expect(late.state.getState()).toMatchObject({ status: "connected", role: "reader" });
    expect(late.store.getState().doc.entities).toHaveLength(1);
    expect(bob.state.getState().participants.map((p) => p.id)).toEqual(["alice", "bob", "claire", "david"]);
  });

  it("lien inconnu : refusé", () => {
    const { net } = session();
    const intruder = startGuest({ link: net.connect("eve"), secret: "deviné", name: "Eve", color: "#000" });
    net.flush();
    expect(intruder.state.getState()).toMatchObject({ status: "ended", ended: "unknown-link" });
  });

  it("modifications de chacun visibles par tous", () => {
    const { h, host, converged } = session();
    const a = cmd.addEntity(h.alice, { x: 0, y: 0 });
    cmd.renameNode(h.alice, a, "CLIENT");
    const b = cmd.addEntity(h.bob, { x: 300, y: 0 });
    cmd.renameNode(h.bob, b, "COMMANDE");
    converged();
    expect(names(host.store)).toEqual(["CLIENT", "COMMANDE"]);
  });

  it("modifications simultanées : tous convergent sur l'état de l'hôte", () => {
    const { h, net, host, converged } = session();
    const id = cmd.addEntity(h.alice, { x: 0, y: 0 });
    net.flush();
    // Sans livraison entre les deux : même champ renommé par Bob et Claire.
    cmd.renameNode(h.bob, id, "PAR_BOB");
    cmd.renameNode(h.claire, id, "PAR_CLAIRE");
    converged();
    expect(names(host.store)).toEqual(["PAR_CLAIRE"]); // la dernière reçue l'emporte
  });

  it("rubriques différentes d'une même entité modifiées en même temps : les deux sont gardées", () => {
    const { h, net, host, converged } = session();
    const id = cmd.addEntity(h.alice, { x: 0, y: 0 });
    cmd.setAttributes(h.alice, id, [
      { id: "r1", name: "code", identifier: true, notNull: true, unique: false },
      { id: "r2", name: "nom", identifier: false, notNull: false, unique: false },
    ]);
    net.flush();
    const attrs = () => h.bob.store.getState().doc.entities[0]!.attributes;
    cmd.setAttributes(
      h.bob,
      id,
      attrs().map((a) => (a.id === "r1" ? { ...a, name: "code_client" } : a)),
    );
    cmd.setAttributes(
      h.claire,
      id,
      h.claire.store
        .getState()
        .doc.entities[0]!.attributes.map((a) => (a.id === "r2" ? { ...a, name: "nom_complet" } : a)),
    );
    converged();
    expect(host.store.getState().doc.entities[0]!.attributes.map((a) => a.name)).toEqual([
      "code_client",
      "nom_complet",
    ]);
  });

  it("annuler n'annule que ses propres actions", () => {
    const { h, net, host, converged } = session();
    cmd.renameNode(h.alice, cmd.addEntity(h.alice, { x: 0, y: 0 }), "PAR_ALICE");
    net.flush();
    cmd.renameNode(h.bob, cmd.addEntity(h.bob, { x: 300, y: 0 }), "PAR_BOB");
    net.flush();
    // Alice annule deux fois (renommage, création) : l'entité de Bob reste.
    h.alice.store.getState().undo();
    h.alice.store.getState().undo();
    converged();
    expect(names(host.store)).toEqual(["PAR_BOB"]);
    h.alice.store.getState().redo();
    converged();
    expect(names(host.store).length).toBe(2);
  });

  it("lecteur : aucune modification locale, et une modification forgée est refusée par l'hôte", () => {
    const { net, host, join } = session();
    const reader = join("david", "read-secret");
    net.flush();
    const rh = handle(reader.store);
    cmd.addEntity(rh, { x: 0, y: 0 });
    expect(reader.store.getState().doc.entities).toEqual([]);
    // Modification envoyée malgré tout (client modifié) : l'hôte refuse.
    const link = net.connect("mallory");
    startGuest({ link, secret: "read-secret", name: "M", color: "#000" });
    net.flush();
    link.send({
      type: "ops",
      ops: [
        {
          t: "add",
          coll: "entities",
          value: { id: "x", kind: "entity", name: "X", attributes: [], fictive: false },
          after: null,
        },
      ],
    });
    net.flush();
    expect(host.store.getState().doc.entities).toEqual([]);
  });

  it("IA d'un invité : refusée tant que l'hôte ne l'autorise pas", () => {
    const { h, net, host, bob, converged } = session();
    h.bob.store
      .getState()
      .change(
        "history.ai",
        (d) => void d.entities.push({ id: "ia", kind: "entity", name: "IA", attributes: [], fictive: false }),
      );
    net.flush();
    expect(host.store.getState().doc.entities).toEqual([]);
    expect(bob.state.getState().rejected).toBe("ai-disabled");
    host.setAiAllowed(true);
    net.flush();
    h.bob.store
      .getState()
      .change(
        "history.ai",
        (d) => void d.entities.push({ id: "ia2", kind: "entity", name: "IA2", attributes: [], fictive: false }),
      );
    converged();
    expect(names(host.store)).toContain("IA2");
  });

  it("glisser-déposer de l'hôte pendant une modification d'un invité : rien n'est perdu", () => {
    const { h, net, host, converged } = session();
    const id = cmd.addEntity(h.alice, { x: 0, y: 0 });
    net.flush();
    const store = h.alice.store.getState();
    store.begin();
    h.alice.store.getState().preview((d) => {
      d.layout.positions[id] = { x: 100, y: 100 };
    });
    cmd.renameNode(h.bob, id, "RENOMME_PAR_BOB");
    net.flush(); // reçu pendant le glisser
    h.alice.store.getState().commit("history.move");
    converged();
    const doc = host.store.getState().doc;
    expect(doc.entities[0]!.name).toBe("RENOMME_PAR_BOB");
    expect(doc.layout.positions[id]).toEqual({ x: 100, y: 100 });
  });

  it("fin : l'hôte arrête, les invités l'apprennent et gardent leur copie", () => {
    const { h, net, host, bob } = session();
    cmd.addEntity(h.alice, { x: 0, y: 0 });
    net.flush();
    host.stop();
    net.flush();
    expect(bob.state.getState()).toMatchObject({ status: "ended", ended: "stopped" });
    expect(bob.snapshot().entities).toHaveLength(1);
  });

  it("exclusion, départ, perte de connexion", () => {
    const { net, host, bob, claire } = session();
    host.kick("bob");
    net.flush();
    expect(bob.state.getState()).toMatchObject({ status: "ended", ended: "kicked" });
    expect(host.state.getState().participants.map((p) => p.id)).toEqual(["alice", "claire"]);
    claire.leave();
    net.flush();
    expect(host.state.getState().participants.map((p) => p.id)).toEqual(["alice"]);
    // Déconnecté : lecture seule (pas de modification hors ligne, D14).
    const david = startGuest({ link: net.connect("david"), secret: "edit-secret", name: "D", color: "#000" });
    net.flush();
    net.hostLink.close("david");
    net.flush();
    expect(david.state.getState().status).toBe("disconnected");
    cmd.addEntity(handle(david.store), { x: 0, y: 0 });
    expect(david.store.getState().doc.entities).toHaveLength(0);
  });

  it("200 actions mêlées, livraisons irrégulières : tous convergent (graine fixe)", () => {
    for (const seed of [1, 7, 42]) {
      let state = seed;
      const random = () => {
        state = (state * 1_103_515_245 + 12_345) % 2 ** 31;
        return state / 2 ** 31;
      };
      const pick = <T>(list: T[]): T | undefined => list[Math.floor(random() * list.length)];
      const { h, net, converged } = session();
      const actors = [h.alice, h.bob, h.claire];
      for (let step = 0; step < 200; step += 1) {
        const actor = pick(actors)!;
        const doc = actor.store.getState().doc;
        const entity = pick(doc.entities);
        switch (Math.floor(random() * 7)) {
          case 0:
            cmd.addEntity(actor, { x: step * 10, y: 0 });
            break;
          case 1:
            if (entity) {
              cmd.renameNode(actor, entity.id, `E${step}`);
            }
            break;
          case 2:
            if (entity) {
              cmd.deleteObjects(actor, [entity.id]);
            }
            break;
          case 3:
            if (entity) {
              cmd.setAttributes(actor, entity.id, [
                ...entity.attributes,
                { id: `a${seed}-${step}`, name: `r${step}`, identifier: false, notNull: false, unique: false },
              ]);
            }
            break;
          case 4:
            if (entity) {
              cmd.moveNodes(actor, new Map([[entity.id, { x: step, y: step }]]));
            }
            break;
          case 5:
            actor.store.getState().undo();
            break;
          case 6: {
            const other = pick(doc.entities);
            if (entity && other && entity.id !== other.id) {
              cmd.connectNodes(actor, entity.id, other.id, { associationPosition: { x: 0, y: 0 } });
            }
            break;
          }
        }
        if (random() < 0.3) {
          net.flush();
        }
      }
      converged();
    }
  });
});
