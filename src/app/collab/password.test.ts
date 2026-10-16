import { emptyDocument } from "@core/index";
import { describe, expect, it } from "vitest";
import { startGuest } from "./guest";
import { startHost } from "./host";
import { memoryNetwork } from "./memoryNetwork";
import { failureDelay, verifier } from "./password";

/** Mot de passe d'une session (O-05 §4.2, §9) : défi-réponse vérifié par l'hôte. */
describe("session protégée par mot de passe", () => {
  async function protectedSession() {
    const net = memoryNetwork();
    const host = startHost({
      link: net.hostLink,
      doc: emptyDocument(),
      secrets: { editor: "e", reader: "r" },
      me: { id: "alice", name: "Alice", color: "#000" },
      password: await verifier("correct horse battery"),
    });
    const bob = startGuest({ link: net.connect("bob"), secret: "e", name: "Bob", color: "#111" });
    await net.settle();
    return { net, host, bob };
  }

  it("le mot de passe est demandé avant d'entrer", async () => {
    const { bob, host } = await protectedSession();
    expect(bob.state.getState()).toMatchObject({ status: "password", password: { attemptsLeft: 3, wrong: false } });
    expect(host.state.getState().participants.map((p) => p.id)).toEqual(["alice"]);
  });

  it("bon mot de passe : entrée dans la session", async () => {
    const { bob, net, host } = await protectedSession();
    await bob.answer("correct horse battery");
    await net.settle();
    expect(bob.state.getState()).toMatchObject({ status: "connected", role: "editor" });
    expect(host.state.getState().participants.map((p) => p.id)).toEqual(["alice", "bob"]);
  });

  it("trois erreurs : refusé et déconnecté", async () => {
    const { bob, net } = await protectedSession();
    await bob.answer("faux 1");
    await net.settle();
    expect(bob.state.getState()).toMatchObject({ status: "password", password: { attemptsLeft: 2, wrong: true } });
    await bob.answer("faux 2");
    await net.settle();
    await bob.answer("faux 3");
    await net.settle();
    expect(bob.state.getState()).toMatchObject({ status: "ended", ended: "bad-password" });
  });

  it("le mot de passe ne circule jamais", async () => {
    const net = memoryNetwork();
    const sent: string[] = [];
    const link = net.connect("bob");
    const spy = { ...link, send: (m: Parameters<typeof link.send>[0]) => (sent.push(JSON.stringify(m)), link.send(m)) };
    startHost({
      link: net.hostLink,
      doc: emptyDocument(),
      secrets: { editor: "e", reader: "r" },
      me: { id: "a", name: "A", color: "#000" },
      password: await verifier("secret-tres-long"),
    });
    const bob = startGuest({ link: spy, secret: "e", name: "Bob", color: "#111" });
    await net.settle();
    await bob.answer("secret-tres-long");
    await net.settle();
    expect(bob.state.getState().status).toBe("connected");
    expect(sent.join("")).not.toContain("secret-tres-long");
  });

  it("attente croissante après 3 erreurs, comptée sur toute la session", async () => {
    expect([1, 2, 3, 4, 5, 6, 9, 20].map(failureDelay)).toEqual([0, 0, 0, 1000, 2000, 4000, 30_000, 30_000]);
    const net = memoryNetwork();
    const waits: number[] = [];
    startHost({
      link: net.hostLink,
      doc: emptyDocument(),
      secrets: { editor: "e", reader: "r" },
      me: { id: "alice", name: "Alice", color: "#000" },
      password: await verifier("le bon mot de passe"),
      wait: async (ms) => void waits.push(ms),
    });
    // Deux connexions successives : le compte continue.
    for (const peer of ["eve1", "eve2"]) {
      const eve = startGuest({ link: net.connect(peer), secret: "e", name: "Eve", color: "#222" });
      await net.settle();
      for (let i = 0; i < 3; i++) {
        await eve.answer(`faux ${i}`);
        await net.settle();
      }
    }
    expect(waits).toEqual([0, 0, 0, 1000, 2000, 4000]);
  });
}, 30_000);
