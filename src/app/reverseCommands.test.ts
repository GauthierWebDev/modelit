import { beforeEach, describe, expect, it } from "vitest";
import { addEntity } from "./commands";
import { reverseIntoNewTab } from "./reverseCommands";
import { activeDocument, resetWorkspace, useWorkspaceStore } from "./workspace";

const tabs = () => useWorkspaceStore.getState().documents.length;

beforeEach(() => resetWorkspace());

/** Rétroconception dans un nouvel onglet, commune à la boîte et à l'assistant IA (O-28, O-44 ; A-01, U-3). */
describe("rétroconception dans un nouvel onglet", () => {
  it("script reconnu : nouvel onglet actif, modèle chargé, rapport rendu", () => {
    // L'onglet actif est modifié : il n'est pas remplacé (seul un onglet vierge l'est, O-44).
    addEntity(activeDocument(), { x: 0, y: 0 });
    const before = tabs();
    const { doc, report } = reverseIntoNewTab("CREATE TABLE client (id INT PRIMARY KEY, nom VARCHAR(50));");
    expect(report.tables).toBe(1);
    expect(doc).not.toBeNull();
    expect(tabs()).toBe(before + 1);
    expect(activeDocument()).toBe(doc);
    expect(doc!.store.getState().doc.entities.map((e) => e.name)).toEqual(["client"]);
  });

  it("aucune table : pas d'onglet", () => {
    const before = tabs();
    const { doc, report } = reverseIntoNewTab("SELECT 1;");
    expect(report.tables).toBe(0);
    expect(doc).toBeNull();
    expect(tabs()).toBe(before);
  });
});
