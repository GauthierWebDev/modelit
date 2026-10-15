import { describe, expect, it } from "vitest";
import { buildLink, newSecret, parseLink } from "./link";

const ADDR = JSON.stringify({ id: "a1b2c3", addrs: [{ Relay: "https://euw1-1.relay.iroh.link./" }, { Ip: "192.168.1.12:51000" }] });

/** Liens d'invitation (O-05 §4.1, D15). */
describe("liens d'invitation", () => {
  it("aller-retour : adresse et secret retrouvés", () => {
    const secret = newSecret();
    const link = buildLink(ADDR, secret);
    expect(link).toMatch(/^modelit:\/\/join\?a=[\w-]+&s=[0-9a-f]{32}$/);
    expect(parseLink(link)).toEqual({ addr: ADDR, secret });
  });

  it("deux secrets différents : édition et lecture", () => {
    expect(newSecret()).not.toBe(newSecret());
  });

  it("refuse ce qui n'est pas un lien ModelIt valide", () => {
    const secret = newSecret();
    expect(parseLink(`https://join?a=x&s=${secret}`)).toBeNull();
    expect(parseLink("modelit://join?a=e30")).toBeNull();
    expect(parseLink(`modelit://join?a=pas-du-json&s=${secret}`)).toBeNull();
    expect(parseLink(`modelit://autre?a=e30&s=${secret}`)).toBeNull();
    expect(parseLink("n'importe quoi")).toBeNull();
  });

  it("tolère les espaces autour d'un lien collé", () => {
    const secret = newSecret();
    expect(parseLink(`  ${buildLink(ADDR, secret)}\n`)?.secret).toBe(secret);
  });
});
