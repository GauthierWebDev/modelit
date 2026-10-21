import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useCollabStore } from "../collab/session";
import { addEntity, renameNode } from "../commands";
import { selectUndoLabel } from "../document/documentStore";
import { activeDocument, openInTab, resetWorkspace } from "../workspace";
import { startOwner } from "./owner";
import type { Channel, MainCommand, ToMain, ToReplica } from "./protocol";
import { startReplica } from "./replica";

/** Canal en mémoire : ce qu'envoie un côté est reçu par l'autre, immédiatement. */
function memoryChannels() {
  const toMain = new Set<(m: ToMain) => void>();
  const toReplica = new Set<(m: ToReplica) => void>();
  const sent: ToReplica[] = [];
  const owner: Channel<ToReplica, ToMain> = {
    send: (m) => {
      sent.push(m);
      for (const h of toReplica) {
        h(structuredClone(m));
      }
    },
    listen: (h) => {
      toMain.add(h);
      return () => toMain.delete(h);
    },
  };
  const replica: Channel<ToMain, ToReplica> = {
    send: (m) => {
      for (const h of toMain) {
        h(structuredClone(m));
      }
    },
    listen: (h) => {
      toReplica.add(h);
      return () => toReplica.delete(h);
    },
  };
  return { owner, replica, sent };
}

/** Fenêtres flottantes synchronisées avec la principale (J-01, phase 4, D6). */
describe("synchronisation entre fenêtres", () => {
  let commands: MainCommand[];
  let channels: ReturnType<typeof memoryChannels>;
  let replica: ReturnType<typeof startReplica>;
  let stopOwner: () => void;

  beforeEach(() => {
    resetWorkspace();
    commands = [];
    channels = memoryChannels();
    stopOwner = startOwner(channels.owner, (c) => commands.push(c), { schedule: (f) => f() });
    replica = startReplica(channels.replica);
  });

  afterEach(() => {
    replica.stop();
    stopOwner();
  });

  it("la flottante reçoit le document actif dès son ouverture", () => {
    expect(replica.handle.store.getState().doc.entities).toEqual([]);
    addEntity(activeDocument(), { x: 0, y: 0 });
    expect(replica.handle.store.getState().doc.entities).toHaveLength(1);
  });

  it("une modification faite dans la flottante entre dans l'historique de la principale", () => {
    const id = addEntity(activeDocument(), { x: 0, y: 0 });
    expect(renameNode(replica.handle, id, "CLIENT")).toBeNull();
    const main = activeDocument().store.getState();
    expect(main.doc.entities[0]!.name).toBe("CLIENT");
    expect(selectUndoLabel(main)).toBe("history.rename");
    // Libellé d'annulation et indicateur de modification relayés.
    expect(selectUndoLabel(replica.handle.store.getState())).toBe("history.rename");
  });

  it("annuler depuis la flottante annule dans la principale", () => {
    const id = addEntity(activeDocument(), { x: 0, y: 0 });
    renameNode(replica.handle, id, "CLIENT");
    replica.handle.store.getState().undo();
    expect(activeDocument().store.getState().doc.entities[0]!.name).not.toBe("CLIENT");
    expect(replica.handle.store.getState().doc.entities[0]!.name).not.toBe("CLIENT");
  });

  it("sélection partagée dans les deux sens", () => {
    const id = addEntity(activeDocument(), { x: 0, y: 0 });
    activeDocument().view.getState().select([id]);
    expect(replica.handle.view.getState().selection).toEqual([id]);
    replica.handle.view.getState().select([]);
    expect(activeDocument().view.getState().selection).toEqual([]);
  });

  it("changer d'onglet dans la principale change le document de la flottante", () => {
    addEntity(activeDocument(), { x: 0, y: 0 });
    openInTab();
    expect(replica.handle.store.getState().doc.entities).toEqual([]);
  });

  it("une modification visant un autre onglet que l'actif est ignorée", () => {
    const id = addEntity(activeDocument(), { x: 0, y: 0 });
    const stale = replica.handle;
    openInTab();
    // La flottante a reçu le nouvel onglet : son document courant est vide, rien à renommer.
    expect(renameNode(stale, id, "X")).toBeNull();
    expect(activeDocument().store.getState().doc.entities).toEqual([]);
  });

  it("pendant un glisser-déposer, une seule diffusion, à la fin", () => {
    const id = addEntity(activeDocument(), { x: 0, y: 0 });
    const store = activeDocument().store;
    const before = channels.sent.length;
    store.getState().begin();
    for (let x = 1; x <= 10; x += 1) {
      store.getState().preview((d) => {
        d.layout.positions[id] = { x, y: 0 };
      });
    }
    expect(channels.sent.length).toBe(before);
    store.getState().commit("history.move");
    expect(channels.sent.length).toBe(before + 1);
  });

  it("la session collaborative est reflétée dans la flottante, sans les curseurs", () => {
    useCollabStore.setState({
      mode: "host",
      participants: [{ id: "host", name: "Alice", color: "#000", role: "host" }],
      presence: { bob: { view: "mld", cursor: { x: 1, y: 2 }, selection: [], movedAt: 1 } },
    });
    const mirrored = channels.sent.at(-1)!.state.collab;
    expect(mirrored).toMatchObject({ mode: "host", views: { bob: "mld" } });
    expect("presence" in mirrored).toBe(false);
    useCollabStore.setState({ mode: "idle", participants: [], presence: {} });
  });

  it("commandes réservées à la principale : relayées", () => {
    replica.command({ name: "zoomBy", factor: 1.2 });
    replica.command({ name: "open" });
    expect(commands).toEqual([{ name: "zoomBy", factor: 1.2 }, { name: "open" }]);
  });
});
