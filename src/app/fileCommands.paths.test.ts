import { serializeModel } from "@core/index";
import { model } from "@core/testing/builder";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useCollabStore } from "./collab/session";
import { addEntity } from "./commands";
import { useDialogStore } from "./dialogStore";
import { selectIsDirty } from "./document/documentStore";
import { canReload, openDocument, openFiles, openPath, reloadDocument, saveDocument } from "./fileCommands";
import { usePreferencesStore } from "./preferencesStore";
import { RECENT_LIMIT, withRecent } from "./recentFiles";
import { dialogMessage, fakeFiles } from "./testing/files";
import { useUiStore } from "./uiStore";
import { activeDocument, resetWorkspace, useWorkspaceStore } from "./workspace";

const CLIENT = serializeModel(model().entity("Client", ["id*"]).build());
const FOURNISSEUR = serializeModel(model().entity("Fournisseur", ["id*"]).build());
const tabs = () => useWorkspaceStore.getState().documents.length;
const recent = () => usePreferencesStore.getState().recentFiles;
/** Lecture d'un chemin : les fichiers donnés, `null` (inexistant) pour les autres. */
const disk = (files: Record<string, string>) => ({
  readModel: (path: string) => Promise.resolve(path in files ? { path, content: files[path]! } : null),
});

beforeEach(() => {
  resetWorkspace();
  usePreferencesStore.setState({ recentFiles: [] });
});
afterEach(() => useDialogStore.setState({ queue: [] }));

describe("fichiers récents (O-65)", () => {
  it("en tête, sans doublon, au plus 5", () => {
    const list = ["a", "b", "c", "d", "e"].reduce<string[]>((l, p) => withRecent(l, p), []);
    expect(list).toEqual(["e", "d", "c", "b", "a"]);
    expect(withRecent(list, "c")).toEqual(["c", "e", "d", "b", "a"]);
    expect(withRecent(list, "f")).toHaveLength(RECENT_LIMIT);
  });

  it("retenus à l'ouverture (dialogue ou chemin) et à l'enregistrement", async () => {
    fakeFiles({
      openModel: () => Promise.resolve({ path: "/m/client.mcd", content: CLIENT }),
      ...disk({ "/m/f.mcd": FOURNISSEUR }),
    });
    await openDocument();
    await openPath("/m/f.mcd");
    await saveDocument(activeDocument(), true);
    expect(recent()).toEqual(["/choisi/nouveau.mcd", "/m/f.mcd", "/m/client.mcd"]);
  });

  it("fichier disparu : « Fichier inexistant… », retiré de la liste, aucun onglet", async () => {
    fakeFiles(disk({}));
    usePreferencesStore.setState({ recentFiles: ["/m/parti.mcd", "/m/f.mcd"] });
    const done = openPath("/m/parti.mcd");
    expect(await dialogMessage()).toMatch(/inexistant.*parti\.mcd/i);
    await done;
    expect(recent()).toEqual(["/m/f.mcd"]);
    expect(tabs()).toBe(1);
  });
});

describe("ouvrir par chemin, glisser-déposer (O-66)", () => {
  it("chemin déjà ouvert : son onglet est activé, sans relire le disque", async () => {
    let reads = 0;
    fakeFiles({
      readModel: (path) => {
        reads += 1;
        return Promise.resolve({ path, content: CLIENT });
      },
    });
    await openPath("/m/client.mcd");
    const opened = activeDocument();
    await openPath("/m/autre.mcd");
    await openPath("/m/client.mcd");
    expect(activeDocument()).toBe(opened);
    expect(reads).toBe(2);
  });

  it("dépôt : un onglet par modèle, les autres fichiers signalés et ignorés", async () => {
    fakeFiles(disk({ "/m/client.mcd": CLIENT, "/m/F.MCD": FOURNISSEUR }));
    await openFiles(["/m/client.mcd", "/m/notes.txt", "/m/F.MCD"]);
    const names = useWorkspaceStore.getState().documents.map((d) => d.store.getState().doc.entities[0]?.name);
    expect(names).toEqual(["Client", "Fournisseur"]);
    expect(useUiStore.getState().status).toMatchObject({ kind: "error" });
    expect(useUiStore.getState().status?.text).toMatch(/notes\.txt/);
  });
});

describe("rouvrir sans sauvegarder (O-67)", () => {
  it("document modifié : confirmation, puis fichier relu dans le même onglet, historique remis à zéro", async () => {
    const files = { "/m/client.mcd": CLIENT };
    fakeFiles(disk(files));
    await openPath("/m/client.mcd");
    const doc = activeDocument();
    addEntity(doc, { x: 0, y: 0 });
    const done = reloadDocument(doc);
    expect(await dialogMessage()).toMatch(/client\.mcd/);
    await done;
    expect(activeDocument()).toBe(doc);
    expect(doc.store.getState().doc.entities.map((e) => e.name)).toEqual(["Client"]);
    expect(doc.store.getState().past).toEqual([]);
    expect(selectIsDirty(doc.store.getState())).toBe(false);
  });

  it("confirmation refusée : rien ne change", async () => {
    fakeFiles(disk({ "/m/client.mcd": CLIENT }));
    await openPath("/m/client.mcd");
    const doc = activeDocument();
    addEntity(doc, { x: 0, y: 0 });
    const done = reloadDocument(doc);
    await dialogMessage(false);
    await done;
    expect(doc.store.getState().doc.entities).toHaveLength(2);
  });

  it("indisponible : jamais enregistré, onglet de session, navigateur", async () => {
    fakeFiles(disk({ "/m/client.mcd": CLIENT }));
    expect(canReload(activeDocument())).toBe(false);
    await openPath("/m/client.mcd");
    const doc = activeDocument();
    expect(canReload(doc)).toBe(true);
    useCollabStore.setState({ tabId: doc.id, mode: "host" });
    expect(canReload(doc)).toBe(false);
    useCollabStore.setState({ tabId: null, mode: "idle" });
    fakeFiles({ ...disk({}), readsPaths: false });
    expect(canReload(doc)).toBe(false);
  });
});
