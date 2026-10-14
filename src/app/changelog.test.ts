import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { changelogEntry, parseChangelog } from "./changelog";

const SAMPLE = `# Notes de version

Texte d'introduction, ignoré.

## 0.2.0 — 2026-11-03

### Nouveautés

- Premier élément.
- Élément sur
  deux lignes.

### Corrections

* Correction.

## v0.1.0

Paragraphe sans rubrique.
`;

describe("notes de version", () => {
  it("découpe versions, dates, rubriques et éléments", () => {
    const entries = parseChangelog(SAMPLE);
    expect(entries.map((e) => [e.version, e.date])).toEqual([
      ["0.2.0", "2026-11-03"],
      ["0.1.0", undefined],
    ]);
    expect(entries[0]!.sections).toEqual([
      { title: "Nouveautés", items: ["Premier élément.", "Élément sur deux lignes."] },
      { title: "Corrections", items: ["Correction."] },
    ]);
    expect(entries[1]!.sections).toEqual([{ title: "", items: ["Paragraphe sans rubrique."] }]);
  });

  it("restitue le corps Markdown d'une version (texte de la release)", () => {
    expect(changelogEntry(SAMPLE, "0.2.0")!.body).toBe(
      "### Nouveautés\n\n- Premier élément.\n- Élément sur\n  deux lignes.\n\n### Corrections\n\n* Correction.",
    );
    expect(changelogEntry(SAMPLE, "9.9.9")).toBeUndefined();
  });

  it("CHANGELOG.md contient la version de package.json", () => {
    const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
    const { version } = JSON.parse(read("../../package.json")) as { version: string };
    const entry = changelogEntry(read("../../CHANGELOG.md"), version);
    expect(entry?.sections.some((s) => s.items.length > 0)).toBe(true);
  });
});
