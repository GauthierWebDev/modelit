import { describe, expect, it } from "vitest";
import { decodePacket, encodePacket, MAX_PAYLOAD } from "./packet";

/** Paquets audio du vocal (O-48, D18). */
describe("paquet audio", () => {
  it("aller-retour, identifiant accentué compris", () => {
    const packet = { speaker: "hôte", seq: 65_535, level: 200, payload: new Uint8Array([1, 2, 3]) };
    expect(decodePacket(encodePacket(packet))).toEqual(packet);
  });

  it("niveau borné à 0–255", () => {
    expect(decodePacket(encodePacket({ speaker: "", seq: 1, level: 900, payload: new Uint8Array([9]) }))!.level).toBe(
      255,
    );
  });

  it("malformé ou d'une autre version : ignoré", () => {
    expect(decodePacket(new Uint8Array([2, 0, 0, 0, 0, 1]))).toBeNull();
    expect(decodePacket(new Uint8Array([1, 9, 0]))).toBeNull();
    expect(decodePacket(new Uint8Array([1, 0, 0, 1, 50]))).toBeNull();
  });

  it("charge trop grande : refusée à l'envoi", () => {
    expect(() => encodePacket({ speaker: "", seq: 0, level: 0, payload: new Uint8Array(MAX_PAYLOAD + 1) })).toThrow();
  });
});
