import { type DocumentSettings, emptyDocument, type ModelDocument, resolveVersion } from "@core/index";
import type { Draft } from "immer";
import { usePreferencesStore } from "./preferencesStore";

/** Réglages des options générales (override O-21) appliqués aux paramètres d'un document. */
export function applyModelDefaults(settings: Draft<DocumentSettings> | DocumentSettings) {
  const defaults = usePreferencesStore.getState().defaults;
  settings.dbms = defaults.dbms;
  settings.dbmsVersion = resolveVersion(defaults.dbms, defaults.dbmsVersion);
  settings.autoIdMask = defaults.autoIdMask;
  settings.keys = { primary: defaults.primaryKey, foreign: defaults.foreignKey };
}

/** Nouveau modèle vide, avec les réglages des options générales. */
export function newModelDocument(): ModelDocument {
  const doc = emptyDocument();
  applyModelDefaults(doc.settings);
  return doc;
}
