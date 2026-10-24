import { serializeModel } from "@core/index";
import { model } from "@core/testing/builder";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { addEntity } from "./commands";
import { useDialogStore } from "./dialogStore";
import { selectIsDirty } from "./document/documentStore";
import { newTab, openDocument, saveDocument } from "./fileCommands";
import { dialogMessage, fakeFiles } from "./testing/files";
import { useUiStore } from "./uiStore";
import { activeDocument, resetWorkspace, useWorkspaceStore } from "./workspace";

const CLIENT = serializeModel(model().entity("Client", ["id*"]).build());

const tabs = () => useWorkspaceStore.getState().documents.length;

beforeEach(() => resetWorkspace());
afterEach(() => useDialogStore.setState({ queue: [] }));

/** Ouvrir un modèle (override O-44 : dans un onglet). */
describe("commandes Fichier : ouvrir", () => {
  it("annulé : rien ne change", async () => {
    fakeFiles();
    await openDocument();
    expect(tabs()).toBe(1);
    expect(useDialogStore.getState().queue).toEqual([]);
  });

  it("modèle lu : chargé dans l'onglet, chemin retenu", async () => {
    fakeFiles({ openModel: () => Promise.resolve({ path: "/m/client.mcd", content: CLIENT }) });
    await openDocument();
    const { doc, filePath } = activeDocument().store.getState();
    expect(doc.entities.map((e) => e.name)).toEqual(["Client"]);
    expect(filePath).toBe("/m/client.mcd");
  });

  it("fichier déjà ouvert : son onglet est activé, pas de second onglet", async () => {
    fakeFiles({ openModel: () => Promise.resolve({ path: "/m/client.mcd", content: CLIENT }) });
    await openDocument();
    const opened = activeDocument();
    newTab();
    await openDocument();
    expect(tabs()).toBe(2);
    expect(activeDocument()).toBe(opened);
  });

  it("fichier qui n'est pas un modèle : message de l'erreur de fichier", async () => {
    fakeFiles({ openModel: () => Promise.resolve({ path: "/m/x.mcd", content: "pas du json" }) });
    const done = openDocument();
    expect(await dialogMessage()).toMatch(/JSON/);
    await done;
  });

  it("échec de lecture : message d'échec avec la cause", async () => {
    fakeFiles({ openModel: () => Promise.reject(new Error("disque absent")) });
    const done = openDocument();
    expect(await dialogMessage()).toMatch(/disque absent/);
    await done;
  });
});

describe("commandes Fichier : enregistrer", () => {
  it("document neuf : emplacement demandé, document marqué enregistré, annonce", async () => {
    const saved = fakeFiles();
    const doc = activeDocument();
    addEntity(doc, { x: 0, y: 0 });
    await saveDocument(doc);
    expect(saved).toHaveLength(1);
    expect(saved[0]!.path).toBeNull();
    expect(doc.store.getState().filePath).toBe("/choisi/nouveau.mcd");
    expect(selectIsDirty(doc.store.getState())).toBe(false);
    expect(useUiStore.getState().status?.text).toMatch(/nouveau\.mcd/);
  });

  it("document déjà enregistré : même chemin ; « Enregistrer sous » redemande l'emplacement", async () => {
    const saved = fakeFiles();
    const doc = activeDocument();
    doc.store.getState().markSaved("/m/a.mcd");
    await saveDocument(doc);
    await saveDocument(doc, true);
    expect(saved.map((s) => s.path)).toEqual(["/m/a.mcd", null]);
  });

  it("emplacement annulé : document toujours modifié", async () => {
    fakeFiles({ saveModel: () => Promise.resolve(null) });
    const doc = activeDocument();
    addEntity(doc, { x: 0, y: 0 });
    await saveDocument(doc);
    expect(selectIsDirty(doc.store.getState())).toBe(true);
  });

  it("échec d'écriture : message d'échec avec la cause", async () => {
    fakeFiles({ saveModel: () => Promise.reject(new Error("lecture seule")) });
    const done = saveDocument(activeDocument());
    expect(await dialogMessage()).toMatch(/lecture seule/);
    await done;
  });
});
