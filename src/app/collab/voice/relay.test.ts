import { emptyDocument } from "@core/index";
import { describe, expect, it } from "vitest";
import { type GuestSession, startGuest } from "../guest";
import { startHost } from "../host";
import { memoryNetwork } from "../memoryNetwork";
import { type AudioPacket, encodePacket } from "./packet";

const voice = (n: number) => ({ seq: n, level: 120, payload: new Uint8Array([n, n, n]) });

/** Vocal (O-48, D18) : état dans la liste des participants, voix relayée par l'hôte. */
describe("vocal : relais par l'hôte", () => {
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
    const dave = startGuest({ link: net.connect("dave"), secret: "e", name: "Dave", color: "#333" });
    net.flush();
    const heard = (who: { onAudio: (h: (p: AudioPacket) => void) => () => void }) => {
      const packets: AudioPacket[] = [];
      who.onAudio((p) => packets.push(p));
      return packets;
    };
    return { net, host, bob, carol, dave, heard };
  }
  const audioOf = (g: GuestSession) =>
    Object.fromEntries(g.state.getState().participants.map((p) => [p.id, p.audio ?? null]));

  it("personne n'est dans le vocal par défaut ; rejoindre et couper le micro se voit chez tous", () => {
    const { net, host, bob, carol } = session();
    expect(audioOf(carol)).toEqual({ host: null, bob: null, carol: null, dave: null });
    bob.setVoice(true, false);
    host.setVoice(true, true);
    net.flush();
    expect(audioOf(carol)).toMatchObject({ host: { muted: true }, bob: { muted: false }, carol: null });
    bob.setVoice(false, false);
    net.flush();
    expect(audioOf(carol).bob).toBeNull();
  });

  it("la voix d'un invité va aux autres participants du vocal, pas à lui-même ni aux absents", () => {
    const { net, host, bob, carol, dave, heard } = session();
    const [atHost, atBob, atCarol, atDave] = [heard(host), heard(bob), heard(carol), heard(dave)];
    host.setVoice(true, false);
    bob.setVoice(true, false);
    carol.setVoice(true, false); // lectrice : elle peut parler et écouter
    net.flush();
    bob.sendAudio(voice(1));
    carol.sendAudio(voice(2));
    net.flush();
    expect(atHost.map((p) => [p.speaker, p.seq])).toEqual([
      ["bob", 1],
      ["carol", 2],
    ]);
    expect(atCarol.map((p) => p.speaker)).toEqual(["bob"]);
    expect(atBob.map((p) => p.speaker)).toEqual(["carol"]);
    expect(atDave).toEqual([]);
    expect(atCarol[0]!.payload).toEqual(new Uint8Array([1, 1, 1]));
  });

  it("la voix de l'hôte va aux invités du vocal ; micro coupé : rien ne part", () => {
    const { net, host, bob, dave, heard } = session();
    const [atBob, atDave] = [heard(bob), heard(dave)];
    bob.setVoice(true, false);
    host.setVoice(true, false);
    net.flush();
    host.sendAudio(voice(7));
    host.setVoice(true, true);
    host.sendAudio(voice(8));
    net.flush();
    expect(atBob.map((p) => [p.speaker, p.seq])).toEqual([["host", 7]]);
    expect(atDave).toEqual([]);
  });

  it("un invité ne peut pas parler au nom d'un autre, ni hors du vocal, ni micro coupé", () => {
    const net = memoryNetwork();
    const host = startHost({
      link: net.hostLink,
      doc: emptyDocument(),
      secrets: { editor: "e", reader: "r" },
      me: { id: "host", name: "Alice", color: "#000" },
    });
    const atHost: AudioPacket[] = [];
    host.onAudio((p) => atHost.push(p));
    host.setVoice(true, false);
    // Canal brut : l'invité envoie des datagrammes forgés, sans passer par `startGuest`.
    const raw = net.connect("mallory");
    raw.send({ type: "hello", secret: "e", name: "Mallory", color: "#444" });
    net.flush();
    const forged = encodePacket({ speaker: "host", seq: 1, level: 99, payload: new Uint8Array([1]) });
    raw.sendDatagram(forged); // hors du vocal
    raw.send({ type: "voice", joined: true, muted: true });
    net.flush();
    raw.sendDatagram(forged); // micro coupé
    raw.send({ type: "voice", joined: true, muted: false });
    net.flush();
    raw.sendDatagram(forged);
    net.flush();
    expect(atHost.map((p) => p.speaker)).toEqual(["mallory"]);
  });

  it("paquet perdu : les suivants passent quand même", () => {
    const { net, host, bob, heard } = session();
    const atHost = heard(host);
    host.setVoice(true, false);
    bob.setVoice(true, false);
    net.flush();
    net.lose(1);
    for (let i = 1; i <= 3; i++) bob.sendAudio(voice(i));
    net.flush();
    expect(atHost.map((p) => p.seq)).toEqual([2, 3]);
  });

  it("après une reconnexion, l'invité est de nouveau dans le vocal", () => {
    const { net, host, bob } = session();
    bob.setVoice(true, true);
    net.flush();
    bob.reconnect(net.connect("bob2"));
    net.flush();
    expect(host.state.getState().participants.find((p) => p.id === "bob2")?.audio).toEqual({ muted: true });
  });
});
