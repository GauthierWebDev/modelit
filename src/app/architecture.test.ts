import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Garde-fou (docs/jalons/J-01, phase 1) : un document n'est jamais un état global.
 * Il se reçoit en paramètre (`DocumentHandle`) ou se lit dans le contexte React
 * (`useDocument`, `useDocumentView`) ; seul `workspace.ts` connaît la liste des documents.
 */
const SRC = fileURLToPath(new URL("..", import.meta.url));
const DOCUMENT_DIR = join(SRC, "app", "document");

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      return sources(path);
    }
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

describe("architecture des documents", () => {
  it("aucun store de document global", () => {
    const offenders = sources(SRC)
      .filter((file) =>
        /\buseDocumentStore\b|\bcreate<(DocumentState|DocumentViewState)>/.test(readFileSync(file, "utf8")),
      )
      .map((file) => relative(SRC, file));
    expect(offenders).toEqual([]);
  });

  it("app/document ne crée que des stores instanciables (zustand/vanilla)", () => {
    const offenders = sources(DOCUMENT_DIR)
      .filter(
        (file) => /from\s+["']zustand["']/.test(readFileSync(file, "utf8")) && !file.endsWith("DocumentContext.tsx"),
      )
      .map((file) => relative(SRC, file));
    expect(offenders).toEqual([]);
  });
});
