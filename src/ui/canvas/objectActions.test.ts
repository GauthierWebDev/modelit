import { bendsOf, setBends } from "@core/index";
import { model } from "@core/testing/builder";
import { afterEach, describe, expect, it } from "vitest";
import { copySelection } from "@/app/clipboardCommands";
import { useCollabStore } from "@/app/collab/session";
import { createDocumentHandle, type DocumentHandle } from "@/app/document/handle";
import { INHERITANCE_SIZE } from "./geometry";
import { type Action, type ActionItem, arrangeActions, contextActions, quickActions } from "./objectActions";

/**
 * Bouton « ⋯ » et menu contextuel (override O-53), complétés par O-55 (Paramètres du modèle dans
 * le menu du vide) et O-57 (rangée Aligner / Répartir d'une sélection multiple).
 */

/** Contenu d'un menu : identifiants, « | » pour un séparateur, « row:… » pour une rangée d'icônes. */
const ids = (actions: Action[]) =>
  actions.map((a) => (a.kind === "separator" ? "|" : a.kind === "row" ? `row:${a.id}` : a.id));
const item = (actions: Action[], id: string) => actions.find((a): a is ActionItem => a.kind === "item" && a.id === id)!;

function setup(): DocumentHandle {
  const doc = model()
    .entity("CLIENT", ["id_client*", "nom"])
    .entity("COMMANDE", ["id_commande*"])
    .entity("PERSONNE", ["id_personne*"])
    .entity("SALARIE", ["matricule*"])
    .entity("STAGIAIRE", ["numero*"])
    .association("PASSER", ["CLIENT 0,n", "COMMANDE 1,1"])
    .inherit("PERSONNE", ["SALARIE", "STAGIAIRE"])
    .build();
  doc.entities.forEach((e, i) => {
    doc.layout.positions[e.id] = { x: 200 * i, y: 0 };
  });
  return createDocumentHandle(doc);
}
const model_ = (doc: DocumentHandle) => doc.store.getState().doc;
const entity = (doc: DocumentHandle, name: string) => model_(doc).entities.find((e) => e.name === name)!;
const menuOn = (doc: DocumentHandle, id: string | null, point = { x: 0, y: 0 }) => {
  if (id) doc.view.getState().select([id]);
  return contextActions(doc, id, point);
};

afterEach(() => {
  useCollabStore.setState({ mode: "idle", guest: null, tabId: null } as never);
});

describe("menu contextuel du vide (O-53, O-55)", () => {
  it("MCD : coller ici ; créer entité, association, héritage ; tout sélectionner, placement, ajuster ; paramètres", () => {
    expect(ids(menuOn(setup(), null))).toEqual([
      "pasteHere",
      "|",
      "newEntity",
      "newAssociation",
      "newInheritance",
      "|",
      "selectAll",
      "autoLayout",
      "fit",
      "|",
      "modelSettings",
    ]);
  });

  it("MLD / MPD : ni association ni héritage", () => {
    for (const view of ["mld", "mpd"] as const) {
      const doc = setup();
      doc.view.getState().setView(view);
      const content = ids(contextActions(doc, null, { x: 0, y: 0 }));
      expect(content).toContain("newEntity");
      expect(content).not.toContain("newAssociation");
      expect(content).not.toContain("newInheritance");
    }
  });

  it("« Coller ici » grisé tant que rien n'a été copié dans cette instance", () => {
    const doc = setup();
    // Presse-papiers interne : propre à ce fichier de test (modules isolés), rien copié avant.
    expect(item(menuOn(doc, null), "pasteHere").disabled).toBe(true);
    doc.view.getState().select([entity(doc, "CLIENT").id]);
    copySelection(doc);
    expect(item(contextActions(doc, null, { x: 0, y: 0 }), "pasteHere").disabled).toBe(false);
  });

  it("nouvelle entité au point du clic, alignée sur la grille, puis sélectionnée", () => {
    const doc = setup();
    item(menuOn(doc, null, { x: 123, y: 47 }), "newEntity").run();
    const created = model_(doc).entities.at(-1)!;
    expect(model_(doc).layout.positions[created.id]).toEqual({ x: 120, y: 50 });
    expect(doc.view.getState().selection).toEqual([created.id]);
  });

  it("nouvel héritage centré sur le point, comme à la création au clic", () => {
    const doc = setup();
    item(menuOn(doc, null, { x: 300, y: 300 }), "newInheritance").run();
    const created = model_(doc).inheritances.at(-1)!;
    const at = model_(doc).layout.positions[created.id]!;
    // Coin aligné sur la grille (pas de 10) : centre à moins d'un demi-pas du point.
    expect(at).toEqual({ x: 270, y: 270 });
    expect(Math.abs(at.x + INHERITANCE_SIZE.width / 2 - 300)).toBeLessThanOrEqual(5);
    expect(Math.abs(at.y + INHERITANCE_SIZE.height / 2 - 300)).toBeLessThanOrEqual(5);
  });
});

describe("menu contextuel d'un objet (O-53)", () => {
  it("entité : copier, couper, dupliquer, supprimer ; ajouter une rubrique, discriminant ; entité fictive (case)", () => {
    const doc = setup();
    const menu = menuOn(doc, entity(doc, "CLIENT").id);
    expect(ids(menu)).toEqual([
      "copy",
      "cut",
      "duplicate",
      "delete",
      "|",
      "addAttribute",
      "autoDiscriminant",
      "fictive",
    ]);
    expect(item(menu, "fictive").checked).toBe(false);
    item(menu, "fictive").run();
    expect(entity(doc, "CLIENT").fictive).toBe(true);
    expect(item(menuOn(doc, entity(doc, "CLIENT").id), "fictive").checked).toBe(true);
  });

  it("association : copier, couper, dupliquer, supprimer ; ajouter une rubrique", () => {
    const doc = setup();
    expect(ids(menuOn(doc, model_(doc).associations[0]!.id))).toEqual([
      "copy",
      "cut",
      "duplicate",
      "delete",
      "|",
      "addAttribute",
    ]);
  });

  it("héritage : copier, couper, dupliquer, supprimer", () => {
    const doc = setup();
    expect(ids(menuOn(doc, model_(doc).inheritances[0]!.id))).toEqual(["copy", "cut", "duplicate", "delete"]);
  });

  it("patte : cardinalités (case), identifiant relatif (case), supprimer", () => {
    const doc = setup();
    const link = model_(doc).links.find((l) => l.cardinality.max === 1)!;
    const menu = menuOn(doc, link.id);
    expect(ids(menu)).toEqual([
      "cardinality-0-1",
      "cardinality-1-1",
      "cardinality-0-n",
      "cardinality-1-n",
      "|",
      "relativeId",
      "|",
      "delete",
    ]);
    expect(menu.filter((a) => a.kind === "item" && a.checked).map((a) => (a as ActionItem).id)).toEqual([
      "cardinality-1-1",
    ]);
    item(menu, "cardinality-0-1").run();
    expect(model_(doc).links.find((l) => l.id === link.id)!.cardinality).toEqual({ min: 0, max: 1 });
  });

  it("patte brisée : « Redresser le trait » en plus, qui retire ses cassures", () => {
    const doc = setup();
    const link = model_(doc).links[0]!;
    doc.store.getState().change("history.createBend", (d) => {
      setBends(d.layout, link.id, [{ x: 50, y: 50 }]);
    });
    const menu = menuOn(doc, link.id);
    expect(ids(menu)).toContain("straighten");
    item(menu, "straighten").run();
    expect(bendsOf(model_(doc).layout, link.id)).toEqual([]);
  });

  it("lien d'héritage : supprimer", () => {
    const doc = setup();
    expect(ids(menuOn(doc, model_(doc).inheritanceLinks[0]!.id))).toEqual(["delete"]);
  });
});

describe("sélection multiple (O-53, O-57)", () => {
  it("clic droit sur un objet de la sélection : rangée Aligner / Répartir, puis actions sur toute la sélection", () => {
    const doc = setup();
    const selection = ["CLIENT", "COMMANDE", "PERSONNE"].map((n) => entity(doc, n).id);
    doc.view.getState().select(selection);
    const menu = contextActions(doc, selection[0]!, { x: 0, y: 0 });
    expect(ids(menu)).toEqual(["row:arrange", "|", "copy", "cut", "duplicate", "delete"]);
    item(menu, "delete").run();
    expect(model_(doc).entities.map((e) => e.name)).not.toContain("CLIENT");
    expect(model_(doc).entities.map((e) => e.name)).not.toContain("PERSONNE");
  });

  it("deux objets suffisent ; un objet hors de la sélection a son propre menu", () => {
    const doc = setup();
    const pair = ["CLIENT", "COMMANDE"].map((n) => entity(doc, n).id);
    doc.view.getState().select(pair);
    expect(ids(contextActions(doc, pair[0]!, { x: 0, y: 0 }))[0]).toBe("row:arrange");
    const outside = contextActions(doc, entity(doc, "PERSONNE").id, { x: 0, y: 0 });
    expect(ids(outside)).toContain("fictive");
    expect(ids(outside)).not.toContain("row:arrange");
  });

  it("aligner à partir de deux objets, répartir à partir de trois (O-57)", () => {
    const doc = setup();
    const disabled = () => Object.fromEntries(arrangeActions(doc).map((a) => [a.id, Boolean(a.disabled)]));
    doc.view.getState().select([entity(doc, "CLIENT").id]);
    expect(Object.values(disabled()).every(Boolean)).toBe(true);
    doc.view.getState().select(["CLIENT", "COMMANDE"].map((n) => entity(doc, n).id));
    expect(disabled()["align-left"]).toBe(false);
    expect(disabled()["distribute-horizontal"]).toBe(true);
    doc.view.getState().select(["CLIENT", "COMMANDE", "PERSONNE"].map((n) => entity(doc, n).id));
    expect(Object.values(disabled()).some(Boolean)).toBe(false);
  });
});

describe("session en lecture seule (O-05, O-53, O-55)", () => {
  const readOnly = (doc: DocumentHandle) =>
    useCollabStore.setState({ mode: "guest", guest: { role: "reader", status: "connected" }, tabId: doc.id } as never);

  it("vide : tout sélectionner, ajuster, et les paramètres du modèle (consultés sans être modifiés)", () => {
    const doc = setup();
    readOnly(doc);
    expect(ids(contextActions(doc, null, { x: 0, y: 0 }))).toEqual(["selectAll", "fit", "|", "modelSettings"]);
  });

  it("objet : copier seulement, sans séparateur orphelin", () => {
    const doc = setup();
    readOnly(doc);
    expect(ids(menuOn(doc, entity(doc, "CLIENT").id))).toEqual(["copy"]);
    expect(ids(menuOn(doc, model_(doc).links[0]!.id))).toEqual([]);
  });

  it("autre onglet que celui de la session : menu complet", () => {
    const doc = setup();
    useCollabStore.setState({ mode: "guest", guest: { role: "reader", status: "connected" }, tabId: "autre" } as never);
    expect(ids(menuOn(doc, entity(doc, "CLIENT").id))).toContain("delete");
  });
});

describe("bouton « ⋯ » (O-53)", () => {
  it("ajouter une rubrique, copier, dupliquer, supprimer", () => {
    const doc = setup();
    expect(ids(quickActions(doc, entity(doc, "CLIENT").id))).toEqual(["addAttribute", "copy", "duplicate", "delete"]);
  });
});
