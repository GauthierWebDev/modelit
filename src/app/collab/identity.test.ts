import { describe, expect, it } from "vitest";
import { displayName, IDENTITY_COLORS, newIdentity, randomName } from "./identity";

/** Identité d'un participant (O-05 §3). */
describe("identité", () => {
  it("nom aléatoire accordé en français, dans l'ordre anglais en anglais", () => {
    expect(randomName([0, 0], "fr")).toBe("Castor curieux");
    expect(randomName([0, 1], "fr")).toBe("Loutre curieuse");
    expect(randomName([0, 0], "en")).toBe("Curious Beaver");
  });

  it("le même tirage donne le même animal dans les deux langues", () => {
    expect(randomName([5, 2], "fr")).toBe("Renard rêveur");
    expect(randomName([5, 2], "en")).toBe("Dreamy Fox");
  });

  it("un nom saisi remplace le nom aléatoire ; un nom vide ou blanc ne compte pas", () => {
    const identity = newIdentity();
    expect(displayName({ ...identity, name: "Gauthier" })).toBe("Gauthier");
    expect(displayName({ ...identity, name: "   " })).toBe(randomName(identity.seed));
  });

  it("nouvelle identité : couleur de la palette", () => {
    expect(IDENTITY_COLORS).toContain(newIdentity().color);
  });
});
