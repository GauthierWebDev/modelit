import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Garde-fou : le cœur métier ne dépend que de lui-même.
 * Interdit : React, Zustand, Tauri, et tout import qui sort de `src/core`.
 */
const CORE = fileURLToPath(new URL(".", import.meta.url));
const FORBIDDEN = /from\s+["'](react|react-dom|zustand|immer|@tauri-apps\/[^"']+|@\/[^"']*)["']/;

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return /\.tsx?$/.test(entry.name) && !entry.name.endsWith(".test.ts") ? [path] : [];
  });
}

describe("architecture", () => {
  it("src/core est indépendant de l'interface et de la plateforme", () => {
    const offenders: string[] = [];
    for (const file of sources(CORE)) {
      const text = readFileSync(file, "utf8");
      for (const match of text.matchAll(/from\s+["'](\.\.?\/[^"']+)["']/g)) {
        const resolved = relative(CORE, join(file, "..", match[1]!));
        if (resolved.startsWith("..")) offenders.push(`${relative(CORE, file)} → ${match[1]}`);
      }
      if (FORBIDDEN.test(text)) offenders.push(`${relative(CORE, file)} → ${FORBIDDEN.exec(text)![1]}`);
    }
    expect(offenders).toEqual([]);
  });
});
