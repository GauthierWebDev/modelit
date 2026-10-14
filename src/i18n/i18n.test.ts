import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { MSG, setMessagesLocale } from "@core/index";
import { en } from "./en";
import { fr } from "./fr";

const params = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe("traductions (override O-23)", () => {
  it("chaque texte anglais a les mêmes paramètres que le français", () => {
    const mismatches = Object.entries(fr).filter(([key, text]) => params(text).join() !== params(en[key as keyof typeof fr]).join());
    expect(mismatches).toEqual([]);
  });

  it("aucun texte anglais vide", () => {
    expect(Object.entries(en).filter(([, text]) => !text.trim())).toEqual([]);
  });

  it("les messages du cœur changent de langue", () => {
    setMessagesLocale("en");
    expect(MSG.circularReferences).toBe("Warning! Circular references");
    setMessagesLocale("fr");
    expect(MSG.circularReferences).toBe("Attention ! Références circulaires");
  });
});

describe("infobulles (override O-20)", () => {
  const ui = fileURLToPath(new URL("../ui", import.meta.url));
  const files = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? files(join(dir, e.name)) : e.name.endsWith(".tsx") ? [join(dir, e.name)] : [],
    );

  it("aucun attribut title ni élément SVG <title> : les infobulles passent par data-tooltip", () => {
    const offenders = files(ui).filter((f) => {
      const text = readFileSync(f, "utf8");
      return /<title>|\stitle=\{?["`]/.test(text) || /<(button|span|div|label|svg|g|circle|line|rect|path|a|input)\b[^>]*\stitle=/.test(text);
    });
    expect(offenders).toEqual([]);
  });
});
