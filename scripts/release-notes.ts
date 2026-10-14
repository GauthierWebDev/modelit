// Affiche les notes de la version demandée, extraites de CHANGELOG.md (texte de la release GitHub).
// Échoue si la version n'y figure pas : pas de release sans notes.
// Usage : node scripts/release-notes.ts 0.2.0
import { readFileSync } from "node:fs";
import { changelogEntry } from "../src/app/changelog.ts";

const version = process.argv[2]?.replace(/^v/, "");
if (!version) {
  console.error("Usage : node scripts/release-notes.ts <version>");
  process.exit(2);
}
const entry = changelogEntry(readFileSync(new URL("../CHANGELOG.md", import.meta.url), "utf8"), version);
if (!entry?.body) {
  console.error(`CHANGELOG.md : aucune section « ## ${version} » (ou section vide).`);
  process.exit(1);
}
console.log(entry.body);
