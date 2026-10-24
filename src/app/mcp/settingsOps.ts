import {
  DBMS_LIST,
  type Dbms,
  type DdlOptions,
  type PatternKind,
  parsePattern,
  TYPE_KEYS,
  TYPOLOGIES,
  type TypeKey,
} from "@core/index";
import * as cmd from "../commands";
import type { DocumentHandle } from "../document/handle";
import type { OperationOf } from "./operationTypes";
import { check, current, refuse } from "./opSupport";

/** Opérations de l'IA sur les paramètres du modèle et le SGBD cible (overrides O-47, O-59, O-69). */

/** Valeurs permises de chaque option du script (exhaustif : une option ajoutée doit figurer ici). */
const DDL_VALUES: { [K in keyof DdlOptions]: readonly DdlOptions[K][] } = {
  foreignKeysInAlter: [true, false],
  indexes: [true, false],
  sourceColumnOrder: [true, false],
  constraintNaming: ["none", "prefix", "suffix"],
  unsigned: ["widen", "check"],
  enums: ["check", "type"],
  sets: ["array", "text"],
  collations: ["icu", "deterministic"],
  oracleDates: ["timestamp", "date"],
  emptyStrings: ["check", "none"],
  strictRanges: [true, false],
  spatial: ["postgis", "wkb", "wkt"],
  sqlServerCollation: ["ci_as", "ci_ai", "cs_as"],
  dboSchema: ["public", "dbo"],
};

/** Change de SGBD cible ; le SGBD personnalisé du modèle est gardé (basé sur le nouveau), sauf `keepCustom: false`. */
export function setDbms(doc: DocumentHandle, op: OperationOf<"set_dbms">): string {
  if (!DBMS_LIST.some((d) => d.id === op.dbms)) {
    refuse(`unknown DBMS « ${op.dbms} »`);
  }
  cmd.setTargetDbms(doc, op.dbms as Dbms, op.keepCustom !== false);
  if (op.version) {
    cmd.setDbmsVersion(doc, op.version);
  }
  return `target DBMS set to ${op.dbms}${op.version ? ` ${op.version}` : ""}`;
}

/** Masque validé comme dans les paramètres (variables permises selon le masque, alias de toute langue). */
function pattern(input: string, kind: PatternKind): string {
  const parsed = parsePattern(input, kind);
  if (parsed.ok) {
    return parsed.pattern;
  }
  return refuse(
    "empty" in parsed ? `empty ${kind} pattern` : `unknown variables in ${kind} pattern: ${parsed.unknown.join(", ")}`,
  );
}

function ddlPatch(ddl: Record<string, unknown>): Partial<DdlOptions> {
  for (const [key, value] of Object.entries(ddl)) {
    const allowed = (DDL_VALUES as Record<string, readonly unknown[]>)[key];
    if (!allowed) {
      refuse(`unknown script option « ${key} »`);
    }
    if (!allowed!.includes(value)) {
      refuse(`invalid value for « ${key} » (expected ${allowed!.join(", ")})`);
    }
  }
  return ddl as Partial<DdlOptions>;
}

/** Nommage, masques (identifiant automatique, clés primaires et étrangères), options du script. */
export function setSettings(doc: DocumentHandle, op: OperationOf<"set_settings">): string {
  const typology = op.naming?.typology;
  if (typology !== undefined && !TYPOLOGIES.includes(typology)) {
    refuse(`unknown typology « ${typology} » (expected ${TYPOLOGIES.join(", ")})`);
  }
  const masks = {
    ...(op.autoIdMask === undefined ? {} : { autoIdMask: pattern(op.autoIdMask, "discriminant") }),
    ...(op.primaryKey === undefined ? {} : { primary: pattern(op.primaryKey, "primaryKey") }),
    ...(op.foreignKey === undefined ? {} : { foreign: pattern(op.foreignKey, "foreignKey") }),
  };
  const ddl = op.ddl ? ddlPatch(op.ddl) : {};
  cmd.updateSettings(doc, "history.ai", (s) => {
    Object.assign(s.naming, op.naming ?? {});
    if (masks.autoIdMask) {
      s.autoIdMask = masks.autoIdMask;
    }
    Object.assign(s.keys, {
      ...(masks.primary ? { primary: masks.primary } : {}),
      ...(masks.foreign ? { foreign: masks.foreign } : {}),
    });
    Object.assign(s.ddl, ddl);
  });
  return "model settings updated";
}

/** Personnalise la cible du modèle (O-59), ou renomme le SGBD personnalisé. */
export function customizeDbms(doc: DocumentHandle, op: OperationOf<"customize_dbms">): string {
  if (!current(doc).settings.customDbms) {
    cmd.customizeTarget(doc);
  }
  if (op.name !== undefined) {
    check(cmd.renameCustomDbms(doc, op.name), "custom DBMS");
  }
  return `custom DBMS ${current(doc).settings.customDbms!.name}`;
}

/** Type SQL d'un type conceptuel dans le SGBD personnalisé ; vide : le type de la base revient. */
export function setCustomType(doc: DocumentHandle, op: OperationOf<"set_custom_type">): string {
  if (!current(doc).settings.customDbms) {
    refuse("the target DBMS is not customized (customize_dbms first)");
  }
  if (!TYPE_KEYS.includes(op.type as TypeKey)) {
    refuse(`unknown type « ${op.type} » (expected ${TYPE_KEYS.join(", ")})`);
  }
  check(cmd.setCustomType(doc, op.type as TypeKey, op.sql), `custom type « ${op.type} »`);
  return `custom type ${op.type} set`;
}

export function resetCustomTypes(doc: DocumentHandle): string {
  cmd.resetCustomTypes(doc);
  return "custom types reset";
}

export function removeCustomization(doc: DocumentHandle): string {
  cmd.removeCustomization(doc);
  return "DBMS customization removed";
}
