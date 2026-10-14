import { resolveVersion } from "../dbms/versions";
import { migrateLegacyPattern } from "../naming/patterns";
import { MSG } from "../validation/messages";
import type { ModelDocument } from "../model/document";
import { defaultSettings, type DocumentSettings } from "../model/settings";

/**
 * Format de fichier natif : JSON textuel, versionné, lisible et compatible git (NF5).
 *
 * Toute évolution incompatible du modèle incrémente `CURRENT_VERSION` et ajoute
 * une migration `n → n+1` dans `MIGRATIONS`. Les fichiers anciens restent lisibles.
 */
export const FILE_FORMAT = "modelit/model";
export const CURRENT_VERSION = 2;
export const FILE_EXTENSION = "mcd";

type RawModel = Record<string, unknown>;

/** MIGRATIONS[n] transforme un modèle de version n en version n+1. */
const MIGRATIONS: Record<number, (model: RawModel) => RawModel> = {
  // v1 → v2 : cascades booléennes → actions référentielles (override O-29).
  1: (model) => ({
    ...model,
    links: asArray(model.links).map((link) => {
      if (!isRecord(link)) return link;
      const { onDeleteCascade, onUpdateCascade, ...rest } = link;
      return {
        ...rest,
        ...(onDeleteCascade === true ? { onDelete: "cascade" } : {}),
        ...(onUpdateCascade === true ? { onUpdate: "cascade" } : {}),
      };
    }),
  }),
};

export class ModelFileError extends Error {}

export interface LoadResult {
  doc: ModelDocument;
  warnings: string[];
}

export function serializeModel(doc: ModelDocument): string {
  return `${JSON.stringify({ format: FILE_FORMAT, version: CURRENT_VERSION, model: doc }, null, 2)}\n`;
}

export function deserializeModel(text: string): LoadResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new ModelFileError(MSG.fileUnreadable);
  }
  if (!isRecord(parsed) || parsed.format !== FILE_FORMAT || typeof parsed.version !== "number") {
    throw new ModelFileError(MSG.fileNotModel);
  }

  const warnings: string[] = [];
  let version = parsed.version;
  let model = isRecord(parsed.model) ? parsed.model : {};

  if (version > CURRENT_VERSION) {
    warnings.push(MSG.newerFile);
  }
  while (version < CURRENT_VERSION) {
    const migrate = MIGRATIONS[version];
    if (!migrate) throw new ModelFileError(MSG.noMigration(version));
    model = migrate(model);
    version++;
  }

  return { doc: normalize(model), warnings };
}

/** Complète les champs absents, pour tolérer les fichiers partiels ou plus récents. */
function normalize(model: RawModel): ModelDocument {
  const raw = isRecord(model.settings) ? model.settings : {};
  const settings = deepMerge(defaultSettings(), raw) as DocumentSettings;
  // Version absente ou étrangère au SGBD du fichier : la plus récente de ce SGBD.
  delete (settings.display as { showTypes?: unknown }).showTypes; // retiré (override O-11)
  // Schémas de clés : syntaxe [Classe] / [Table]… des versions précédentes → <entity> / <table>… (O-26).
  settings.autoIdMask = migrateLegacyPattern(settings.autoIdMask);
  settings.keys.primary = migrateLegacyPattern(settings.keys.primary);
  settings.keys.foreign = migrateLegacyPattern(settings.keys.foreign);
  settings.dbmsVersion = resolveVersion(settings.dbms, typeof raw.dbmsVersion === "string" ? raw.dbmsVersion : undefined);
  return {
    settings,
    entities: asArray(model.entities),
    // `forceTable` retiré (override O-19) : ignoré dans les anciens fichiers.
    associations: asArray(model.associations).map((a) => {
      if (!isRecord(a)) return a;
      const { forceTable: _ignored, ...rest } = a;
      return rest;
    }),
    links: asArray(model.links),
    inheritances: asArray(model.inheritances),
    inheritanceLinks: asArray(model.inheritanceLinks),
  } as ModelDocument;
}

const isRecord = (v: unknown): v is RawModel => typeof v === "object" && v !== null && !Array.isArray(v);
const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

function deepMerge(base: object, override: RawModel): object {
  const out: RawModel = { ...base };
  for (const [key, value] of Object.entries(override)) {
    const current = out[key];
    out[key] = isRecord(current) && isRecord(value) ? deepMerge(current, value) : value;
  }
  return out;
}
