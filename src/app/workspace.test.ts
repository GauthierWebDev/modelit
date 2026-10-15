import { emptyDocument } from "@core/index";
import { beforeEach, describe, expect, it } from "vitest";
import { addEntity } from "./commands";
import { documentName } from "./fileCommands";
import {
  activate,
  activateNeighbour,
  activeDocument,
  closeTab,
  findByPath,
  moveTab,
  openInTab,
  resetWorkspace,
  syncUntitled,
  useWorkspaceStore,
} from "./workspace";

const ids = () => useWorkspaceStore.getState().documents.map((d) => d.id);
const names = () => useWorkspaceStore.getState().documents.map((d) => documentName(d));
const openFile = (path: string) => openInTab((d) => d.store.getState().load(emptyDocument(), path));

/** Onglets (override O-44). */
describe("espace de travail", () => {
  beforeEach(resetWorkspace);

  it("un document vierge au départ", () => {
    expect(ids()).toHaveLength(1);
    expect(names()).toEqual(["Sans titre"]);
  });

  it("un onglet vierge actif est réutilisé, sinon le nouvel onglet s'ouvre à droite de l'actif", () => {
    const first = activeDocument();
    const a = openFile("/m/a.mcd");
    expect(ids()).toEqual([a.id]);
    expect(first.id).not.toBe(a.id);

    const b = openFile("/m/b.mcd");
    activate(a.id);
    const c = openFile("/m/c.mcd");
    expect(ids()).toEqual([a.id, c.id, b.id]);
    expect(activeDocument()).toBe(c);
  });

  it("numérotation « Sans titre N » : plus petit numéro libre", () => {
    addEntity(activeDocument(), { x: 0, y: 0 });
    const second = openInTab();
    addEntity(second, { x: 0, y: 0 });
    const third = openInTab();
    expect(names()).toEqual(["Sans titre", "Sans titre 2", "Sans titre 3"]);
    closeTab(second.id);
    addEntity(third, { x: 0, y: 0 });
    openInTab();
    expect(names()).toEqual(["Sans titre", "Sans titre 3", "Sans titre 2"]);
  });

  it("un document enregistré quitte la numérotation", () => {
    const doc = activeDocument();
    doc.store.getState().markSaved("/m/x.mcd");
    syncUntitled(doc);
    expect(useWorkspaceStore.getState().untitled).toEqual({});
    expect(names()).toEqual(["x.mcd"]);
  });

  it("fichier déjà ouvert : retrouvé par son chemin", () => {
    const a = openFile("/m/a.mcd");
    openFile("/m/b.mcd");
    expect(findByPath("/m/a.mcd")).toBe(a);
    expect(findByPath("/m/z.mcd")).toBeUndefined();
  });

  it("fermer l'onglet actif active le voisin de droite, sinon de gauche", () => {
    const a = openFile("/m/a.mcd");
    const b = openFile("/m/b.mcd");
    const c = openFile("/m/c.mcd");
    activate(b.id);
    closeTab(b.id);
    expect(activeDocument()).toBe(c);
    closeTab(c.id);
    expect(activeDocument()).toBe(a);
  });

  it("fermer un onglet inactif ne change pas l'onglet actif", () => {
    const a = openFile("/m/a.mcd");
    const b = openFile("/m/b.mcd");
    closeTab(a.id);
    expect(activeDocument()).toBe(b);
  });

  it("fermer le dernier onglet le remplace par un document vierge", () => {
    const a = openFile("/m/a.mcd");
    closeTab(a.id);
    expect(ids()).toHaveLength(1);
    expect(activeDocument().id).not.toBe(a.id);
    expect(names()).toEqual(["Sans titre"]);
  });

  it("Ctrl + Tab : onglet suivant ou précédent, en boucle", () => {
    const a = openFile("/m/a.mcd");
    const b = openFile("/m/b.mcd");
    activateNeighbour(1);
    expect(activeDocument()).toBe(a);
    activateNeighbour(-1);
    expect(activeDocument()).toBe(b);
  });

  it("glisser-déposer : réordonne sans changer l'onglet actif", () => {
    const a = openFile("/m/a.mcd");
    const b = openFile("/m/b.mcd");
    const c = openFile("/m/c.mcd");
    moveTab(c.id, 0);
    expect(ids()).toEqual([c.id, a.id, b.id]);
    moveTab(c.id, 99);
    expect(ids()).toEqual([a.id, b.id, c.id]);
    expect(activeDocument()).toBe(c);
  });
});
