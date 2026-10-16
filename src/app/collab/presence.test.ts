import { emptyDocument } from "@core/index";
import { describe, expect, it } from "vitest";
import { startGuest } from "./guest";
import { startHost } from "./host";
import { memoryNetwork } from "./memoryNetwork";
import type { Presence } from "./protocol";

const at = (x: number, y: number, view: Presence["view"] = "mcd"): Presence => ({
  view,
  cursor: { x, y },
  selection: [],
});

/** Présence (O-05 §5) : relayée par l'hôte à tous les autres, jamais renvoyée à son auteur. */
describe("présence", () => {
  function session() {
    const net = memoryNetwork();
    const host = startHost({
      link: net.hostLink,
      doc: emptyDocument(),
      secrets: { editor: "e", reader: "r" },
      me: { id: "host", name: "Alice", color: "#000" },
    });
    const bob = startGuest({ link: net.connect("bob"), secret: "e", name: "Bob", color: "#111" });
    const carol = startGuest({ link: net.connect("carol"), secret: "r", name: "Carol", color: "#222" });
    net.flush();
    return { net, host, bob, carol };
  }

  it("le curseur d'un invité parvient à l'hôte et aux autres invités, pas à lui-même", () => {
    const { net, host, bob, carol } = session();
    bob.setPresence(at(120, 80));
    net.flush();
    expect(host.state.getState().presence.bob).toEqual(at(120, 80));
    expect(carol.state.getState().presence.bob).toEqual(at(120, 80));
    expect(bob.state.getState().presence.bob).toBeUndefined();
  });

  it("le curseur de l'hôte parvient à tous ; un lecteur envoie aussi le sien", () => {
    const { net, host, bob, carol } = session();
    host.setPresence(at(1, 2, "mld"));
    carol.setPresence(at(3, 4));
    net.flush();
    expect(bob.state.getState().presence).toEqual({ host: at(1, 2, "mld"), carol: at(3, 4) });
    expect(host.state.getState().presence.host).toBeUndefined();
  });

  it("un nouveau venu reçoit la présence de ceux déjà là", () => {
    const { net, host, bob } = session();
    host.setPresence(at(5, 5));
    bob.setPresence(at(6, 6));
    net.flush();
    const dave = startGuest({ link: net.connect("dave"), secret: "e", name: "Dave", color: "#333" });
    net.flush();
    expect(dave.state.getState().presence).toEqual({ host: at(5, 5), bob: at(6, 6) });
  });

  it("un participant parti ou exclu disparaît", () => {
    const { net, host, bob, carol } = session();
    bob.setPresence(at(1, 1));
    carol.setPresence(at(2, 2));
    net.flush();
    bob.leave();
    host.kick("carol");
    net.flush();
    expect(host.state.getState().presence).toEqual({});
  });

  it("un invité qui attend le mot de passe n'envoie rien", () => {
    const net = memoryNetwork();
    const host = startHost({
      link: net.hostLink,
      doc: emptyDocument(),
      secrets: { editor: "e", reader: "r" },
      me: { id: "host", name: "A", color: "#000" },
    });
    const eve = startGuest({ link: net.connect("eve"), secret: "inconnu", name: "Eve", color: "#444" });
    eve.setPresence(at(9, 9));
    net.flush();
    expect(host.state.getState().presence).toEqual({});
  });
});
