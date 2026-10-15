import { emptyDocument } from "@core/index";
import { describe, expect, it } from "vitest";
import { startGuest } from "./guest";
import { startHost } from "./host";
import { memoryNetwork } from "./memoryNetwork";
import { MAX_PARTICIPANTS } from "./protocol";

/** Limites d'une session (O-05 §10). */
describe("limites", () => {
  it("20 participants au plus, hôte compris : le suivant est refusé", () => {
    const net = memoryNetwork();
    const host = startHost({ link: net.hostLink, doc: emptyDocument(), secrets: { editor: "e", reader: "r" }, me: { id: "host", name: "A", color: "#000" } });
    const guests = Array.from({ length: MAX_PARTICIPANTS }, (_, i) => startGuest({ link: net.connect(`g${i}`), secret: "e", name: `G${i}`, color: "#111" }));
    net.flush();
    expect(host.state.getState().participants).toHaveLength(MAX_PARTICIPANTS);
    expect(guests.at(-1)!.state.getState()).toMatchObject({ status: "ended", ended: "full" });
    expect(guests.at(-2)!.state.getState().status).toBe("connected");
  });
});
