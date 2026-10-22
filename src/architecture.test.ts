import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Garde-fou des couches (esprit hexagonal, audit A-01 / M-00) : `core` au centre, `app` orchestre les cas
 * d'usage et définit les ports, `platform` les implémente, `ui` est l'adaptateur d'entrée.
 * Les exceptions TEMPORAIRES ne peuvent que diminuer : chacune nomme le lot qui la supprimera, et une
 * exception devenue inutile fait échouer le test jusqu'à son retrait de la liste.
 * `src/core/architecture.test.ts` garde en plus l'indépendance de `core`.
 */
const SRC = fileURLToPath(new URL(".", import.meta.url));

/**
 * Couches qu'une couche peut importer (hors elle-même). La racine (`main.tsx`) assemble : tout lui est permis.
 * `app` → `platform` et `ui` → `platform` sont restreints par un test dédié ; `platform` → `app` aux types.
 */
const ALLOWED: Record<string, string[]> = {
  core: [],
  i18n: ["core"],
  app: ["core", "i18n", "platform"],
  platform: ["core", "app"],
  ui: ["app", "core", "i18n", "platform"],
};

/** `ui` → `platform` permis en permanence : enveloppe de l'interface (fenêtre, liens, fenêtres natives). */
const UI_PLATFORM_SHELL = ["platform/window", "platform/links", "platform/floatWindows"];

/** `ui` → `platform` permis : indicateurs de disponibilité lus par l'interface. */
const UI_PLATFORM_FLAGS = [
  "ui/collab/ShareDialog.tsx → platform/collab",
  "ui/options/OptionsDialog.tsx → platform/mcp",
  "ui/options/OptionsDialog.tsx → platform/updater",
];

/** TEMPORAIRE — à supprimer en M-00 L3 (point d'assemblage unique, ports fichiers / mises à jour / stockage). */
const TEMPORARY = [
  "ui/collab/CollabBridge.tsx → platform/collab",
  "ui/collab/CollabBridge.tsx → platform/voice",
  "ui/mcp/McpBridge.tsx → platform/mcp",
];

/** TEMPORAIRE — cycle entre sous-dossiers de `core`, dû au catalogue `MSG` de `validation` : M-02 (A-01, C-5). */
const CORE_CYCLES = ["dbms, model, naming, validation"];

interface Import {
  from: string; // fichier, relatif à src
  target: string; // module cible, relatif à src (ou paquet npm)
  layer: string; // couche cible, ou "npm"
  typeOnly: boolean;
}

const IMPORT = /^\s*(import|export)\s+(type\s+)?(?:[^;(]*?\s+from\s+)?["']([^"']+)["']/gm;

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      return sources(path);
    }
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) && !entry.name.endsWith(".d.ts")
      ? [path]
      : [];
  });
}

/** Couche d'un fichier source : premier dossier sous `src` ; un fichier à la racine (`main.tsx`) assemble. */
const layerOf = (path: string) => (path.includes("/") ? path.split("/")[0]! : "(racine)");
/** Couche d'une cible : premier segment (`i18n` = `src/i18n/index.ts`) ; hors de `src` : ressource. */
const targetLayer = (target: string) => (target.startsWith("..") ? "asset" : target.split("/")[0]!);

function resolve(file: string, specifier: string): { target: string; layer: string } {
  if (specifier.startsWith("@/")) {
    const target = specifier.slice(2);
    return { target, layer: targetLayer(target) };
  }
  if (specifier.startsWith("@core")) {
    return { target: `core${specifier.slice(5)}`, layer: "core" };
  }
  if (specifier.startsWith(".")) {
    const target = relative(SRC, join(dirname(join(SRC, file)), specifier));
    return { target, layer: targetLayer(target) };
  }
  return { target: specifier, layer: "npm" };
}

const IMPORTS: Import[] = sources(SRC).flatMap((path) => {
  const from = relative(SRC, path);
  return [...readFileSync(path, "utf8").matchAll(IMPORT)].map((m) => ({
    from,
    ...resolve(from, m[3]!),
    typeOnly: Boolean(m[2]),
  }));
});

const edge = (i: Import) => `${i.from} → ${i.target}`;
const fileEdge = (i: Import) => `${i.from} → ${i.target.replace(/\.tsx?$/, "")}`;

describe("architecture des couches", () => {
  it("chaque couche n'importe que les couches permises", () => {
    const offenders = IMPORTS.filter((i) => {
      const own = layerOf(i.from);
      return (
        own in ALLOWED && !["npm", "asset"].includes(i.layer) && i.layer !== own && !ALLOWED[own]!.includes(i.layer)
      );
    }).map(edge);
    expect(offenders).toEqual([]);
  });

  it("platform n'importe d'app que des types de ports (il les implémente)", () => {
    const offenders = IMPORTS.filter((i) => layerOf(i.from) === "platform" && i.layer === "app" && !i.typeOnly);
    expect(offenders.map(edge)).toEqual([]);
  });

  it("app n'importe pas platform ; ui seulement l'enveloppe de l'interface (exceptions temporaires à part)", () => {
    const toPlatform = IMPORTS.filter((i) => ["app", "ui"].includes(layerOf(i.from)) && i.layer === "platform");
    const permitted = (i: Import) =>
      (layerOf(i.from) === "ui" && UI_PLATFORM_SHELL.includes(i.target)) ||
      UI_PLATFORM_FLAGS.includes(fileEdge(i)) ||
      TEMPORARY.includes(fileEdge(i));
    expect(toPlatform.filter((i) => !permitted(i)).map(fileEdge)).toEqual([]);
    // Cliquet : une exception temporaire qui ne sert plus doit être retirée de la liste.
    const used = new Set(toPlatform.map(fileEdge));
    expect([...TEMPORARY, ...UI_PLATFORM_FLAGS].filter((e) => !used.has(e))).toEqual([]);
  });

  it("Tauri n'est connu que de platform", () => {
    const offenders = IMPORTS.filter((i) => i.target.startsWith("@tauri-apps/") && layerOf(i.from) !== "platform");
    expect(offenders.map(edge)).toEqual([]);
  });
});

const byName = (a: string, b: string) => a.localeCompare(b);

/** Composantes fortement connexes (Tarjan) d'un graphe orienté, de taille ≥ 2. */
function cycles(graph: Map<string, Set<string>>): string[] {
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const stack: string[] = [];
  const found: string[] = [];
  const visit = (v: string) => {
    index.set(v, index.size);
    low.set(v, index.get(v)!);
    stack.push(v);
    for (const w of graph.get(v) ?? []) {
      if (!index.has(w)) {
        visit(w);
        low.set(v, Math.min(low.get(v)!, low.get(w)!));
      } else if (stack.includes(w)) {
        low.set(v, Math.min(low.get(v)!, index.get(w)!));
      }
    }
    if (low.get(v) === index.get(v)) {
      const component = stack.splice(stack.indexOf(v));
      if (component.length > 1) {
        found.push(component.sort(byName).join(", "));
      }
    }
  };
  for (const v of [...graph.keys()].sort(byName)) {
    if (!index.has(v)) {
      visit(v);
    }
  }
  return found.sort(byName);
}

describe("architecture du cœur", () => {
  const coreImports = IMPORTS.filter((i) => layerOf(i.from) === "core" && !i.from.startsWith("core/testing/"));
  const folder = (path: string) => path.split("/")[1]!;

  it("aucun paquet externe ni module node: hors core/testing (domaine pur)", () => {
    expect(coreImports.filter((i) => i.layer === "npm").map(edge)).toEqual([]);
  });

  it("aucun cycle d'import entre sous-dossiers de core (exceptions temporaires à part)", () => {
    const graph = new Map<string, Set<string>>();
    for (const i of coreImports) {
      const [a, b] = [folder(i.from), folder(i.target)];
      if (i.layer === "core" && i.target.includes("/", 5) && a !== b && b !== "testing") {
        graph.set(a, (graph.get(a) ?? new Set()).add(b));
      }
    }
    expect(cycles(graph)).toEqual(CORE_CYCLES);
  });
});
