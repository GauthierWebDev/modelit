import { model } from "@core/testing/builder";
import { describe, expect, it } from "vitest";
import { createDocumentHandle } from "../document/handle";
import { applyChanges, type Operation } from "./apply";
import { describeModel } from "./describe";

/** Cours : un étudiant suit un cours ; PERSONNE → ÉTUDIANT, ENSEIGNANT. */
const cours = () =>
  createDocumentHandle(
    model()
      .entity("ETUDIANT", ["num*"])
      .entity("COURS", ["code*"])
      .entity("SALLE", ["no*"])
      .entity("PERSONNE", ["id*"])
      .entity("ENSEIGNANT", ["matricule"])
      .association("SUIVRE", ["ETUDIANT 0,n", "COURS 0,n"])
      .inherit("PERSONNE", ["ETUDIANT", "ENSEIGNANT"])
      .build(),
  );
type Handle = ReturnType<typeof cours>;
const apply = (handle: Handle, operations: unknown[]) => applyChanges(handle, operations as Operation[]);

/** Écarts comblés entre l'IA et l'interface (audit du 2026-10-24, O-69). */
describe("MCP : écarts avec l'interface comblés (O-69)", () => {
  it("add_link : nouvelle patte d'une association existante, avec sa cardinalité ; patte en double refusée", () => {
    const handle = cours();
    expect(apply(handle, [{ op: "add_link", association: "SUIVRE", entity: "SALLE", cardinality: "1,n" }]).ok).toBe(
      true,
    );
    const legs = handle.store.getState().doc.links;
    expect(legs).toHaveLength(3);
    expect(legs[2]!.cardinality).toEqual({ min: 1, max: "n" });
    expect(apply(handle, [{ op: "add_link", association: "SUIVRE", entity: "SALLE" }]).ok).toBe(false);
  });

  it("set_link sur un lien d'héritage : texte du trait seulement, identifiant donné par get_model", () => {
    const handle = cours();
    const [inheritance] = describeModel(handle.store.getState().doc, "m").inheritances;
    const link = inheritance!.links.find((l) => l.entity === "ETUDIANT")!;
    expect(apply(handle, [{ op: "set_link", link: link.id, relationLabel: "est un" }]).ok).toBe(true);
    expect(handle.store.getState().doc.inheritanceLinks.find((l) => l.id === link.id)!.relationLabel).toBe("est un");
    expect(apply(handle, [{ op: "set_link", link: link.id, role: "x" }]).ok).toBe(false);
  });

  it("set_physical : casse significative du nom de la table", () => {
    const handle = cours();
    expect(apply(handle, [{ op: "set_physical", target: "COURS", caseSensitive: true }]).ok).toBe(true);
    expect(handle.store.getState().doc.entities[1]!.caseSensitive).toBe(true);
    expect(apply(handle, [{ op: "set_physical", target: "COURS", caseSensitive: false }]).ok).toBe(true);
    expect(handle.store.getState().doc.entities[1]!.caseSensitive).toBeUndefined();
  });
});
