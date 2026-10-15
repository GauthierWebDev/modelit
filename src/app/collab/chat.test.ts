import { emptyDocument } from "@core/index";
import { describe, expect, it } from "vitest";
import { startGuest } from "./guest";
import { startHost } from "./host";
import { memoryNetwork } from "./memoryNetwork";
import { CHAT_MAX } from "./protocol";

/** Chat de session (O-05 §6). */
describe("chat", () => {
  function session() {
    const net = memoryNetwork();
    const host = startHost({ link: net.hostLink, doc: emptyDocument(), secrets: { editor: "e", reader: "r" }, me: { id: "host", name: "Alice", color: "#000" } });
    const bob = startGuest({ link: net.connect("bob"), secret: "e", name: "Bob", color: "#111" });
    const carol = startGuest({ link: net.connect("carol"), secret: "r", name: "Carol", color: "#222" });
    net.flush();
    return { net, host, bob, carol };
  }
  const lines = (chat: { kind: string; name: string; text: string }[]) => chat.map((m) => (m.kind === "text" ? `${m.name}: ${m.text}` : `${m.kind} ${m.name}`));

  it("tout le monde reçoit les messages, lecteurs compris, dans l'ordre d'arrivée chez l'hôte", () => {
    const { net, host, bob, carol } = session();
    bob.sendChat("Je prends CLIENT");
    carol.sendChat("Je regarde seulement");
    net.flush();
    host.sendChat("OK");
    net.flush();
    const expected = ["joined Bob", "joined Carol", "Bob: Je prends CLIENT", "Carol: Je regarde seulement", "Alice: OK"];
    expect(lines(host.state.getState().chat)).toEqual(expected);
    expect(lines(bob.state.getState().chat).slice(-3)).toEqual(expected.slice(-3));
    expect(lines(carol.state.getState().chat)).toEqual(expected);
  });

  it("un nouveau venu reçoit les messages déjà échangés", () => {
    const { net, bob } = session();
    bob.sendChat("Bonjour");
    net.flush();
    const dave = startGuest({ link: net.connect("dave"), secret: "e", name: "Dave", color: "#333" });
    net.flush();
    expect(lines(dave.state.getState().chat)).toEqual(["joined Bob", "joined Carol", "Bob: Bonjour", "joined Dave"]);
  });

  it("messages de service : départ et exclusion", () => {
    const { net, host, bob } = session();
    bob.leave();
    host.kick("carol");
    net.flush();
    expect(lines(host.state.getState().chat).slice(-2)).toEqual(["left Bob", "kicked Carol"]);
  });

  it("message vide ignoré, message trop long tronqué à 2 000 caractères", () => {
    const { net, host, bob } = session();
    bob.sendChat("   ");
    bob.sendChat("x".repeat(CHAT_MAX + 50));
    net.flush();
    const chat = host.state.getState().chat.filter((m) => m.kind === "text");
    expect(chat).toHaveLength(1);
    expect(chat[0]!.text).toHaveLength(CHAT_MAX);
  });
});
