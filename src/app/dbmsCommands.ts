import {
  type Check,
  DBMS_LIST,
  type Dbms,
  type DocumentSettings,
  GENERIC_VERSION,
  invalidTemplateVariable,
  MSG,
  resolveVersion,
  type TypeKey,
  versionOptions,
} from "@core/index";
import type { Draft } from "immer";
import { type MessageKey, t } from "@/i18n";
import { change, current } from "./commandSupport";
import type { DocumentHandle } from "./document/handle";
import { applyModelDefaults } from "./modelDefaults";
import type { LibraryDbms } from "./preferencesStore";

/**
 * Change de SGBD cible ; la version passe à la plus récente de ce SGBD (override O-04). Choisir un
 * SGBD standard retire la personnalisation (O-59) ; `keepCustom` : changement de la base d'un SGBD
 * personnalisé.
 */
export function setTargetDbms(doc: DocumentHandle, dbms: Dbms, keepCustom = false) {
  updateSettings(doc, "history.changeDbms", (s) => {
    s.dbms = dbms;
    s.dbmsVersion = resolveVersion(dbms, undefined);
    if (!keepCustom) {
      delete s.customDbms;
    }
  });
}

/** Libellé d'un SGBD et de sa version (« PostgreSQL 18 »), version générique omise. */
export function dbmsLabel(dbms: Dbms, version: string): string {
  const name = DBMS_LIST.find((d) => d.id === dbms)?.label ?? dbms;
  const v = version === GENERIC_VERSION ? null : versionOptions(dbms).find((o) => o.id === version)?.label;
  return v ? `${name} ${v}` : name;
}

/** Personnalise la cible du modèle (O-59) : SGBD personnalisé basé sur la cible actuelle. */
export function customizeTarget(doc: DocumentHandle) {
  const { dbms, dbmsVersion } = current(doc).settings;
  const name = t("customDbms.defaultName", { dbms: dbmsLabel(dbms, dbmsVersion) });
  updateSettings(doc, "history.customizeDbms", (s) => {
    s.customDbms = { id: crypto.randomUUID(), name, types: {} };
  });
}

/** Retire la personnalisation : la cible redevient le SGBD de base, tel quel. */
export function removeCustomization(doc: DocumentHandle) {
  updateSettings(doc, "history.uncustomizeDbms", (s) => void delete s.customDbms);
}

/** Choisit un SGBD personnalisé de la bibliothèque : sa définition est copiée dans le modèle. */
export function applyCustomDbms(doc: DocumentHandle, dbms: LibraryDbms) {
  updateSettings(doc, "history.changeDbms", (s) => {
    s.dbms = dbms.base;
    s.dbmsVersion = resolveVersion(dbms.base, dbms.version);
    s.customDbms = { id: dbms.id, name: dbms.name, types: { ...dbms.types } };
  });
}

export function renameCustomDbms(doc: DocumentHandle, name: string): Check {
  if (!name.trim()) {
    return MSG.emptyName;
  }
  updateSettings(doc, "history.customizeDbms", (s) => {
    if (s.customDbms) {
      s.customDbms.name = name.trim();
    }
  });
  return null;
}

/** Redéfinit le type SQL d'un type conceptuel ; vide, le type de la base revient. */
export function setCustomType(doc: DocumentHandle, key: TypeKey, template: string): Check {
  const custom = current(doc).settings.customDbms;
  if (!custom) {
    return null;
  }
  const value = template.trim();
  if ((custom.types[key] ?? "") === value) {
    return null;
  }
  const invalid = value ? invalidTemplateVariable(key, value) : null;
  if (invalid) {
    return MSG.invalidTemplateVariable(invalid);
  }
  updateSettings(doc, "history.customType", (s) => {
    if (!s.customDbms) {
      return;
    }
    if (value) {
      s.customDbms.types[key] = value;
    } else {
      delete s.customDbms.types[key];
    }
  });
  return null;
}

export function resetCustomTypes(doc: DocumentHandle) {
  updateSettings(doc, "history.customType", (s) => {
    if (s.customDbms) {
      s.customDbms.types = {};
    }
  });
}

export function setDbmsVersion(doc: DocumentHandle, version: string) {
  updateSettings(doc, "history.changeVersion", (s) => {
    s.dbmsVersion = resolveVersion(s.dbms, version);
  });
}

export function updateSettings(doc: DocumentHandle, label: MessageKey, recipe: (s: Draft<DocumentSettings>) => void) {
  change(doc, label, (d) => recipe(d.settings));
}

/** « Appliquer au modèle ouvert » (options générales). */
export function applyDefaultsToCurrent(doc: DocumentHandle) {
  updateSettings(doc, "history.applyDefaults", (s) => applyModelDefaults(s));
}
