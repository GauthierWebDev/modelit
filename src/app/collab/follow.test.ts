import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setCanvasMetrics } from "../canvasMetrics";
import { addEntity } from "../commands";
import { useUiStore } from "../uiStore";
import { activeDocument, resetWorkspace } from "../workspace";
import { follow, startFollowSync } from "./follow";
import { viewportCenter } from "./presenceSync";
import type { Presence } from "./protocol";
import { useCollabStore } from "./sessionState";

setCanvasMetrics({ canvasSize: () => ({ width: 800, height: 600 }) });

const ME = { id: "me", name: "Alice", color: "#e11d48", role: "host" as const };
const BOB = { id: "bob", name: "Bob", color: "#2563eb", role: "editor" as const };
const bobAt = (presence: Partial<Presence>) =>
  useCollabStore.setState((s) => ({
    presence: {
      ...s.presence,
      bob: { view: "mcd", cursor: null, selection: [], movedAt: 0, ...s.presence.bob, ...presence },
    },
  }));
const following = () => useCollabStore.getState().following;

let stop: () => void;
beforeAll(() => {
  stop = startFollowSync();
});
afterAll(() => stop());

beforeEach(() => {
  resetWorkspace();
  useCollabStore.setState({
    mode: "host",
    tabId: activeDocument().id,
    you: "me",
    participants: [ME, BOB],
    presence: {},
    following: null,
  });
  bobAt({ view: "mld", viewport: { center: { x: 100, y: 50 }, zoom: 2 } });
});

afterEach(() => {
  useCollabStore.setState({ mode: "idle", tabId: null, participants: [], presence: {}, following: null });
});

/** « Suivre » un participant (O-05 §5, précisé le 2026-10-23). */
describe("suivre un participant", () => {
  it("ma vue et mon cadrage suivent les siens : même centre, même zoom", () => {
    follow("bob");
    const { view, viewport } = activeDocument().view.getState();
    expect(view).toBe("mld");
    expect(viewport).toEqual({ x: 800 / 2 - 100 * 2, y: 600 / 2 - 50 * 2, zoom: 2 });
    expect(viewportCenter(viewport)).toEqual({ center: { x: 100, y: 50 }, zoom: 2 });
  });

  it("le participant se déplace : je suis ; son curseur seul ne change pas mon cadrage", () => {
    follow("bob");
    bobAt({ view: "mpd", viewport: { center: { x: 0, y: 0 }, zoom: 1 } });
    expect(activeDocument().view.getState().view).toBe("mpd");
    const { viewport } = activeDocument().view.getState();
    expect(viewport).toEqual({ x: 400, y: 300, zoom: 1 });
    bobAt({ cursor: { x: 5, y: 5 } });
    expect(activeDocument().view.getState().viewport).toBe(viewport);
    expect(following()).toBe("bob");
  });

  it("cadrage reçu invalide : vue suivie, cadrage inchangé", () => {
    bobAt({ viewport: { center: { x: Number.NaN, y: 0 }, zoom: 0 } });
    const before = activeDocument().view.getState().viewport;
    follow("bob");
    expect(activeDocument().view.getState().view).toBe("mld");
    expect(activeDocument().view.getState().viewport).toEqual(before);
  });
});

describe("suivre un participant : fin du suivi", () => {
  it("je déplace ou zoome la vue", () => {
    follow("bob");
    activeDocument().view.getState().setViewport({ x: 0, y: 0, zoom: 1 });
    expect(following()).toBeNull();
  });

  it("je change de vue", () => {
    follow("bob");
    activeDocument().view.getState().setView("mcd");
    expect(following()).toBeNull();
  });

  it("je modifie le modèle", () => {
    follow("bob");
    addEntity(activeDocument(), { x: 0, y: 0 });
    expect(following()).toBeNull();
  });

  it("j'annule une modification", () => {
    addEntity(activeDocument(), { x: 0, y: 0 });
    follow("bob");
    activeDocument().store.getState().undo();
    expect(following()).toBeNull();
  });

  it("je commence un glisser", () => {
    follow("bob");
    activeDocument().store.getState().begin();
    expect(following()).toBeNull();
    activeDocument().store.getState().cancel();
  });

  it("le participant part : arrêt annoncé", () => {
    follow("bob");
    useCollabStore.setState({ participants: [ME] });
    expect(following()).toBeNull();
    expect(useUiStore.getState().status?.text).toMatch(/Bob/);
  });

  it("la session se termine", () => {
    follow("bob");
    useCollabStore.setState({ mode: "idle" });
    expect(following()).toBeNull();
  });
});

describe("suivre un participant : sans effet", () => {
  it("les modifications des autres (document changé, mon historique intact, comme applyRemote) n'arrêtent pas le suivi", () => {
    follow("bob");
    const { store } = activeDocument();
    const { doc } = store.getState();
    store.setState({ doc: { ...doc, entities: [...doc.entities] } });
    expect(following()).toBe("bob");
  });
});
