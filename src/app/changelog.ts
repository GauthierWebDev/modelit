/**
 * Notes de version (`CHANGELOG.md`) : une section `## X.Y.Z — AAAA-MM-JJ` par version, découpée
 * en rubriques `### Titre` contenant des listes `- élément`.
 *
 * Module sans dépendance : il est aussi exécuté tel quel par Node en CI (`scripts/release-notes.ts`).
 */

export interface ChangelogSection {
  /** Vide pour les éléments placés avant la première rubrique. */
  title: string;
  items: string[];
}

export interface ChangelogEntry {
  version: string;
  date?: string;
  sections: ChangelogSection[];
  /** Corps Markdown de la version, tel qu'écrit (texte de la release GitHub). */
  body: string;
}

const VERSION_HEADING = /^##\s+v?(\d+\.\d+\.\d+\S*)(?:\s+[—–-]\s+(.+?))?\s*$/;

export function parseChangelog(markdown: string): ChangelogEntry[] {
  const entries: ChangelogEntry[] = [];
  let entry: ChangelogEntry | null = null;
  let lines: string[] = [];

  const close = () => {
    if (entry) {
      entry.body = lines.join("\n").trim();
    }
  };

  for (const line of markdown.split(/\r?\n/)) {
    const heading = VERSION_HEADING.exec(line);
    if (heading) {
      close();
      entry = { version: heading[1]!, ...(heading[2] ? { date: heading[2] } : {}), sections: [], body: "" };
      entries.push(entry);
      lines = [];
      continue;
    }
    // Titre de niveau 1 ou 2 hors format de version : fin de la version en cours.
    if (/^#{1,2}\s/.test(line)) {
      close();
      entry = null;
      continue;
    }
    if (!entry) {
      continue;
    }
    lines.push(line);
    addLine(entry, line);
  }
  close();
  return entries;
}

/** Ligne d'une version : titre de section (###), élément de liste, ou suite de l'élément précédent. */
function addLine(entry: ChangelogEntry, line: string) {
  const subheading = /^###\s+(.+?)\s*$/.exec(line);
  if (subheading) {
    entry.sections.push({ title: subheading[1]!, items: [] });
    return;
  }
  const item = /^\s*[-*]\s+(.+)$/.exec(line);
  const text = item ? item[1]!.trim() : line.trim();
  if (!text) {
    return;
  }
  let section = entry.sections.at(-1);
  if (!section) {
    section = { title: "", items: [] };
    entry.sections.push(section);
  }
  // Ligne de suite (indentée) : complète l'élément précédent.
  if (!item && /^\s/.test(line) && section.items.length > 0) {
    section.items[section.items.length - 1] += ` ${text}`;
  } else {
    section.items.push(text);
  }
}

export function changelogEntry(markdown: string, version: string): ChangelogEntry | undefined {
  return parseChangelog(markdown).find((e) => e.version === version);
}
