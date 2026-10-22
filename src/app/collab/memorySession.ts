import { emptyDocument } from "@core/index";
import { byCodeUnit } from "@core/testing/order";
import { expect } from "vitest";
import { createDocumentViewStore } from "../document/documentView";
import type { DocumentHandle } from "../document/handle";
import { type GuestSession, startGuest } from "./guest";
import { type HostSession, startHost } from "./host";
import { memoryNetwork as network } from "./memoryNetwork";
import type { SessionStore } from "./sessionStore";

/** Session en mémoire pour les tests (O-05) : hôte Alice et deux invités, Bob et Claire. */
export const handle = (store: SessionStore): DocumentHandle => ({
  id: crypto.randomUUID(),
  store,
  view: createDocumentViewStore(),
});
/** Comparaison indépendante de l'ordre des clés (la géométrie est un dictionnaire). */
export const canonical = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map(canonical)
    : value && typeof value === "object"
      ? Object.fromEntries(
          Object.entries(value)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([k, v]) => [k, canonical(v)]),
        )
      : value;
export const names = (store: SessionStore) =>
  store
    .getState()
    .doc.entities.map((e) => e.name)
    .sort(byCodeUnit);

export function session() {
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
