import { displayedSqlType, type ModelDocument, targetOf, toLogicalModel } from "@core/index";
import { model } from "@core/testing/builder";
import { describe, expect, it } from "vitest";
import { BOLD_WEIGHT, ROW_HEIGHT, TITLE_HEIGHT } from "./geometry";
import { columnStyle, KEY_INDENT, referenceGeometries, type TableLayout, tableLayouts } from "./logicalGeometry";

/**
 * Mise en page des vues MLD et MPD (overrides O-01, O-14) : position commune aux trois vues,
 * notation Merise des colonnes, clé primaire composée, traits des clés étrangères.
 */

function setup(): ModelDocument {
  const doc = model()
    .entity("CLIENT", ["id_client*", "nom"])
    .entity("COMMANDE", ["id_commande*"])
    .entity("PRODUIT", ["id_produit*"])
    .entity("EMPLOYE", ["id_employe*"])
    .association("PASSER", ["CLIENT 0,n", "COMMANDE 1,1"])
    .association("CONTENIR", ["COMMANDE 0,n", "PRODUIT 0,n"], ["quantite"])
    .association("DIRIGER", ["EMPLOYE 0,n", "EMPLOYE 0,1"])
    .typed("CLIENT", "id_client", { kind: "integer", bits: 32 })
    .build();
  // Objets du MCD éloignés les uns des autres.
  doc.entities.forEach((e, i) => {
    doc.layout.positions[e.id] = { x: 300 * i, y: 0 };
  });
  doc.layout.positions[doc.associations.find((a) => a.name === "CONTENIR")!.id] = { x: 300, y: 400 };
  return doc;
}

const layoutsOf = (doc: ModelDocument, mode: "mld" | "mpd") => tableLayouts(toLogicalModel(doc), doc, mode);
const table = (layouts: TableLayout[], name: string) => layouts.find((l) => l.table.name === name)!;

describe("tables du MLD et du MPD", () => {
  it("une table a pour coin haut-gauche la position de l'objet du MCD dont elle est issue (O-01)", () => {
    const doc = setup();
    for (const l of layoutsOf(doc, "mld")) {
      expect({ x: l.x, y: l.y }).toEqual(doc.layout.positions[l.sourceId]);
    }
  });

  it("objet du MCD sans position : table à l'origine", () => {
    const doc = setup();
    const client = doc.entities.find((e) => e.name === "CLIENT")!;
    delete doc.layout.positions[client.id];
    const l = table(layoutsOf(doc, "mld"), "CLIENT");
    expect({ x: l.x, y: l.y }).toEqual({ x: 0, y: 0 });
  });

  it("clé étrangère préfixée par # ; une ligne par colonne sous le titre", () => {
    const l = table(layoutsOf(setup(), "mld"), "COMMANDE");
    expect(l.rows.map((r) => r.label)).toEqual(["id_commande", "#id_client"]);
    expect(l.rows.map((r) => r.y)).toEqual([TITLE_HEIGHT + 4, TITLE_HEIGHT + 4 + ROW_HEIGHT]);
  });

  it("clé primaire composée (O-14) : colonnes de la clé en tête, en retrait, réunies par un trait", () => {
    const l = table(layoutsOf(setup(), "mld"), "CONTENIR");
    expect(l.rows.map((r) => [r.label, r.primaryKey, r.indent])).toEqual([
      ["#id_commande", true, KEY_INDENT],
      ["#id_produit", true, KEY_INDENT],
      ["quantite", false, 0],
    ]);
    expect(l.compositeKey).toEqual({ top: l.rows[0]!.y + 2, bottom: l.rows[1]!.y + ROW_HEIGHT - 2 });
  });

  it("clé primaire en tête, même déclarée après les autres colonnes (O-14)", () => {
    const doc = model().entity("CLIENT", ["nom", "ville", "id_client*"]).build();
    const [l] = layoutsOf(doc, "mld");
    expect(l!.rows.map((r) => r.label)).toEqual(["id_client", "nom", "ville"]);
  });

  it("clé primaire composée dans l'ordre de la clé, quel que soit l'ordre des colonnes (O-14)", () => {
    const doc = setup();
    const logical = toLogicalModel(doc);
    const contenir = logical.tables.find((t) => t.name === "CONTENIR")!;
    contenir.columns.reverse();
    const l = table(tableLayouts(logical, doc, "mld"), "CONTENIR");
    expect(l.rows.map((r) => r.column.name)).toEqual([...contenir.primaryKey, "quantite"]);
  });

  it("clé primaire simple : ni retrait ni trait", () => {
    const l = table(layoutsOf(setup(), "mld"), "CLIENT");
    expect(l.compositeKey).toBeNull();
    expect(l.rows.every((r) => r.indent === 0)).toBe(true);
  });

  it("MLD sans types ni contraintes ; MPD : type du SGBD cible et NOT NULL de la clé primaire", () => {
    const doc = setup();
    const mld = table(layoutsOf(doc, "mld"), "CLIENT");
    expect(mld.rows.every((r) => r.type === null && r.constraints === null)).toBe(true);
    const mpd = table(layoutsOf(doc, "mpd"), "CLIENT");
    const key = mpd.rows.find((r) => r.column.name === "id_client")!;
    expect(key.type).toBe(displayedSqlType(key.column, targetOf(doc.settings)));
    expect(key.type).not.toBeNull();
    expect(key.constraints).toBe("NOT NULL");
    expect(mpd.width).toBeGreaterThan(mld.width);
  });

  it("table sans colonne : hauteur d'une ligne au moins", () => {
    const doc = model().entity("VIDE").build();
    const [l] = layoutsOf(doc, "mld");
    expect(l!.rows).toEqual([]);
    expect(l!.height).toBe(TITLE_HEIGHT + 4 + ROW_HEIGHT + 6);
  });
});

describe("style des colonnes (notation Merise)", () => {
  const column = (foreign: boolean) => ({ name: "c", foreign, notNull: false, unique: false });

  it("clé primaire ou colonne unique en gras ; clé étrangère en italique ; les marques se cumulent", () => {
    expect(columnStyle({ column: column(false), primaryKey: true, unique: false })).toEqual({
      weight: BOLD_WEIGHT,
      italic: false,
    });
    expect(columnStyle({ column: column(false), primaryKey: false, unique: true }).weight).toBe(BOLD_WEIGHT);
    expect(columnStyle({ column: column(true), primaryKey: true, unique: false })).toEqual({
      weight: BOLD_WEIGHT,
      italic: true,
    });
    expect(columnStyle({ column: column(false), primaryKey: false, unique: false })).toEqual({
      weight: 400,
      italic: false,
    });
  });
});

describe("traits des clés étrangères", () => {
  it("un trait par clé étrangère, de la table qui la porte vers la table référencée", () => {
    const layouts = layoutsOf(setup(), "mld");
    const refs = referenceGeometries(layouts);
    const pairs = refs.map(
      (r) => `${layouts.find((l) => l.sourceId === r.sourceId)!.table.name}->${r.fk.referencedTable}`,
    );
    expect(pairs.sort()).toEqual(["COMMANDE->CLIENT", "CONTENIR->COMMANDE", "CONTENIR->PRODUIT", "EMPLOYE->EMPLOYE"]);
    expect(new Set(refs.map((r) => r.key)).size).toBe(refs.length);
  });

  it("le trait part du bord de la table et porte la patte d'où vient la clé (O-25)", () => {
    const doc = setup();
    const layouts = layoutsOf(doc, "mld");
    const ref = referenceGeometries(layouts).find((r) => r.fk.referencedTable === "CLIENT")!;
    const from = table(layouts, "COMMANDE");
    const [x, y] = /^M([-\d.e]+),([-\d.e]+)/.exec(ref.path)!.slice(1).map(Number);
    const onBorder =
      ((Math.abs(x! - from.x) < 1e-6 || Math.abs(x! - from.x - from.width) < 1e-6) &&
        y! >= from.y &&
        y! <= from.y + from.height) ||
      ((Math.abs(y! - from.y) < 1e-6 || Math.abs(y! - from.y - from.height) < 1e-6) &&
        x! >= from.x &&
        x! <= from.x + from.width);
    expect(onBorder).toBe(true);
    expect(doc.links.some((l) => l.id === ref.relationId)).toBe(true);
  });

  it("auto-référence : boucle qui part du côté droit de la table", () => {
    const layouts = layoutsOf(setup(), "mld");
    const employe = table(layouts, "EMPLOYE");
    const loop = referenceGeometries(layouts).find((r) => r.fk.referencedTable === "EMPLOYE")!;
    expect(loop.path.startsWith(`M${employe.x + employe.width},`)).toBe(true);
    expect(loop.label.y).toBeLessThan(employe.y);
  });

  it("table référencée absente : pas de trait", () => {
    const layouts = layoutsOf(setup(), "mld").filter((l) => l.table.name !== "CLIENT");
    expect(referenceGeometries(layouts).some((r) => r.fk.referencedTable === "CLIENT")).toBe(false);
  });

  it("plusieurs clés étrangères entre les mêmes tables : traits distincts", () => {
    const doc = model()
      .entity("PERSONNE", ["id_personne*"])
      .entity("COLIS", ["id_colis*"])
      .association("ENVOYER", ["PERSONNE 0,n", "COLIS 1,1"])
      .association("RECEVOIR", ["PERSONNE 0,n", "COLIS 1,1"])
      .build();
    doc.layout.positions[doc.entities[1]!.id] = { x: 400, y: 300 };
    const refs = referenceGeometries(layoutsOf(doc, "mld"));
    expect(refs).toHaveLength(2);
    expect(refs[0]!.path).not.toBe(refs[1]!.path);
  });
});
