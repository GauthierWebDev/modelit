import { emptyDocument } from "@core/index";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as cmd from "../commands";
import { useDialogStore } from "../dialogStore";
import { createDocumentViewStore } from "../document/documentView";
import { documentName } from "../fileCommands";
import { activeDocument, closeTab, openInTab, resetWorkspace, useWorkspaceStore } from "../workspace";
import { startGuest } from "./guest";
import { startHost } from "./host";
import { buildLink, parseLink } from "./link";
import { memoryNetwork } from "./memoryNetwork";
import { verifier } from "./password";
import { answerPassword, joinFromLink, leaveSession, setCollabTransport, shareActiveTab, stopSharing, useCollabStore } from "./session";

/** Cycle d'une session (O-05 §4) : partager, rejoindre, arrêter, quitter. */
describe("gestionnaire de session", () => {
  let net: ReturnType<typeof memoryNetwork>;
  let peers = 0;

  beforeEach(() => {
    resetWorkspace();
    useDialogStore.setState({ queue: [] });
    useCollabStore.setState({ mode: "idle", tabId: null, links: null, participants: [], guest: null, error: null });
    net = memoryNetwork();
    setCollabTransport({
      startHost: async () => ({ addr: JSON.stringify({ id: "hote" }), link: net.hostLink, stop: async () => undefined }),
      connect: async () => net.connect(`peer${++peers}`),
    });
  });

  afterEach(async () => {
    await stopSharing();
    if (useCollabStore.getState().mode === "guest") await leaveSession();
  });

  describe("côté hôte", () => {
    it("partager l'onglet actif : même onglet, deux liens différents", async () => {
      const tab = activeDocument();
      cmd.addEntity(tab, { x: 0, y: 0 });
      expect(await shareActiveTab()).toBe(true);
      const { mode, links, tabId } = useCollabStore.getState();
      expect(mode).toBe("host");
      expect(tabId).toBe(tab.id);
      expect(parseLink(links!.edit)!.secret).not.toBe(parseLink(links!.read)!.secret);
      expect(activeDocument().id).toBe(tab.id);
      expect(activeDocument().store).not.toBe(tab.store);
      expect(activeDocument().store.getState().doc.entities).toHaveLength(1);
    });

    it("un invité rejoint et modifie : l'onglet de l'hôte suit", async () => {
      await shareActiveTab();
      const bob = startGuest({ link: net.connect("bob"), secret: parseLink(useCollabStore.getState().links!.edit)!.secret, name: "Bob", color: "#000" });
      await net.settle();
      expect(useCollabStore.getState().participants.map((p) => p.name)).toContain("Bob");
      cmd.addEntity({ id: "b", store: bob.store, view: createDocumentViewStore() }, { x: 0, y: 0 });
      await net.settle();
      expect(activeDocument().store.getState().doc.entities).toHaveLength(1);
    });

    it("arrêter : l'onglet redevient ordinaire, avec son fichier ; l'invité l'apprend", async () => {
      activeDocument().store.getState().markSaved("/m/bibliotheque.mcd");
      await shareActiveTab();
      const bob = startGuest({ link: net.connect("bob"), secret: parseLink(useCollabStore.getState().links!.read)!.secret, name: "Bob", color: "#000" });
      await net.settle();
      await stopSharing();
      await net.settle();
      expect(useCollabStore.getState().mode).toBe("idle");
      expect(activeDocument().store.getState().filePath).toBe("/m/bibliotheque.mcd");
      expect("applyRemote" in activeDocument().store.getState()).toBe(false);
      expect(bob.state.getState().ended).toBe("stopped");
    });

    it("fermer l'onglet partagé arrête la session", async () => {
      openInTab((d) => d.store.getState().markSaved("/m/autre.mcd"), { reuseBlank: false });
      const shared = activeDocument().id;
      await shareActiveTab();
      closeTab(shared);
      await net.settle();
      expect(useCollabStore.getState().mode).toBe("idle");
    });

    it("mot de passe trop court : refusé", async () => {
      expect(await shareActiveTab({ password: "court" })).toBe(false);
      expect(useCollabStore.getState()).toMatchObject({ mode: "idle", error: expect.stringContaining("10") });
    });
  });

  describe("côté invité", () => {
    function remoteHost(password?: Awaited<ReturnType<typeof verifier>>) {
      const doc = emptyDocument();
      doc.entities.push({ id: "e1", kind: "entity", name: "LIVRE", attributes: [], fictive: false });
      const host = startHost({ link: net.hostLink, doc, secrets: { editor: "a".repeat(32), reader: "b".repeat(32) }, me: { id: "alice", name: "Alice", color: "#f00" }, ...(password ? { password } : {}) });
      return { host, edit: buildLink(JSON.stringify({ id: "hote" }), "a".repeat(32)) };
    }

    it("rejoindre : nouvel onglet « Session de Alice » avec le document de l'hôte", async () => {
      remoteHost();
      const before = useWorkspaceStore.getState().documents.length;
      await joinFromLink(remoteHost().edit);
      await net.settle();
      expect(useCollabStore.getState().mode).toBe("guest");
      expect(useWorkspaceStore.getState().documents).toHaveLength(before + 1);
      expect(documentName(activeDocument())).toBe("Session de Alice");
      expect(activeDocument().store.getState().doc.entities.map((e) => e.name)).toEqual(["LIVRE"]);
    });

    it("lien invalide : message, aucune connexion", async () => {
      expect(await joinFromLink("modelit://join?a=x")).toBe(false);
      expect(useCollabStore.getState().error).toBeTruthy();
    });

    it("l'hôte arrête : l'invité garde une copie « Sans titre », et un message l'explique", async () => {
      const { host, edit } = remoteHost();
      await joinFromLink(edit);
      await net.settle();
      host.stop();
      await net.settle();
      expect(useCollabStore.getState().mode).toBe("idle");
      const copy = activeDocument();
      expect(copy.store.getState().doc.entities.map((e) => e.name)).toEqual(["LIVRE"]);
      expect(documentName(copy)).toMatch(/^Sans titre/);
      expect("applyRemote" in copy.store.getState()).toBe(false);
      expect(useDialogStore.getState().queue.at(-1)).toMatchObject({ message: "L'hôte a arrêté la session." });
    });

    it("session protégée : le mot de passe est demandé, puis l'onglet s'ouvre", async () => {
      const { edit } = remoteHost(await verifier("mot de passe solide"));
      await joinFromLink(edit);
      await net.settle();
      expect(useCollabStore.getState().guest).toMatchObject({ status: "password" });
      await answerPassword("mot de passe solide");
      await net.settle();
      expect(useCollabStore.getState()).toMatchObject({ mode: "guest", guest: { status: "connected", role: "editor" } });
    });

    it("quitter : copie gardée, pas de message", async () => {
      const { edit } = remoteHost();
      await joinFromLink(edit);
      await net.settle();
      await leaveSession();
      expect(useCollabStore.getState().mode).toBe("idle");
      expect(useDialogStore.getState().queue).toEqual([]);
      expect(activeDocument().store.getState().doc.entities).toHaveLength(1);
    });
  });
}, 30_000);
