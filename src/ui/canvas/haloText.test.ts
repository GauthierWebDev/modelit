import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { resolveColors } from "../export/svgColors";
import { HaloText } from "./haloText";

const tsxFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? tsxFiles(join(dir, e.name)) : e.name.endsWith(".tsx") ? [join(dir, e.name)] : [],
  );

/** Halo des textes posés sur un trait (cardinalités, rôles, libellés des liens) : lisible dans tout lecteur SVG. */
describe("halo des textes", () => {
  it("le trait du halo est un texte à part, dessous, sans paint-order", () => {
    const markup = renderToStaticMarkup(createElement(HaloText, { x: 10, y: 20, fill: "var(--mcd-text)" }, "1,n"));
    const [halo, text] = markup.split("</text>");
    expect(halo).toContain('data-halo=""');
    expect(halo).toContain('fill="none"');
    expect(halo).toContain('stroke="var(--mcd-halo)"');
    expect(halo).toContain('stroke-linejoin="round"');
    expect(text).toContain('fill="var(--mcd-text)"');
    expect(text).not.toContain("stroke");
    expect(markup).not.toContain("paint-order");
  });

  it("aucun paintOrder dans l'interface : ignoré par beaucoup de lecteurs SVG, qui peignent le trait sur les lettres", () => {
    const offenders = tsxFiles("src/ui").filter((f) => /paintOrder=|paint-order=/.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });

  it("export : halo de la couleur du fond choisi, autres couleurs du thème", () => {
    const values = new Map([
      ["--mcd-text", "#f4f4f5"],
      ["--mcd-halo", "#18181b"],
    ]);
    const svg = '<text stroke="var(--mcd-halo)"/><text fill="var(--mcd-text)"/><rect fill="var(--inconnue)"/>';
    expect(resolveColors(svg, values, "#ffffff")).toBe(
      '<text stroke="#ffffff"/><text fill="#f4f4f5"/><rect fill="currentColor"/>',
    );
  });
});
