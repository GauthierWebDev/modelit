import type { Attribute } from "../model/document";
import type { KeyPattern } from "../model/settings";
import { applyPattern, usesVariable } from "./patterns";
import { logicalName, type NamingOptions } from "./typology";

/** Nommage des clés (overrides O-13, O-26). */

/**
 * Nom logique d'une rubrique dans sa table. Le discriminant automatique suit le schéma
 * de clé primaire (ex. `id_<table>`), sauf nom logique saisi.
 */
export function attributeLogicalName(
  attribute: Attribute,
  tableName: string,
  naming: NamingOptions,
  primaryPattern: KeyPattern,
  entityName = "",
): string {
  if (attribute.logicalName?.trim()) {
    return attribute.logicalName.trim();
  }
  const derived = logicalName(attribute, naming);
  if (!attribute.autoKey) {
    return derived;
  }
  return applyPattern(primaryPattern, { table: tableName, name: derived, entity: entityName }) || derived;
}

/**
 * Nom par défaut d'une colonne de clé étrangère.
 * `single` : la clé référencée n'a qu'une colonne. Un schéma sans `<column>` (ex. `<table>_id`)
 * n'a de sens que dans ce cas ; sinon la colonne référencée garde son nom.
 */
export function foreignKeyDefaultName(
  pattern: KeyPattern,
  referencedTable: string,
  referencedColumn: string,
  single: boolean,
): string {
  if (!single && !usesVariable(pattern, "column")) {
    return referencedColumn;
  }
  return applyPattern(pattern, { table: referencedTable, column: referencedColumn }) || referencedColumn;
}

/** `base` s'il est libre, sinon `base_2`, `base_3`… (override O-13). */
export function uniqueName(base: string, used: ReadonlySet<string>): string {
  if (!used.has(base)) {
    return base;
  }
  for (let i = 2; ; i++) {
    if (!used.has(`${base}_${i}`)) {
      return `${base}_${i}`;
    }
  }
}
