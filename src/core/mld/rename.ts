import { MSG } from "../validation/messages";
import type { LogicalModel } from "./logical";

/**
 * Nom saisi pour une table (`column` absent) ou une colonne depuis le MLD / MPD (override O-56) :
 * refusé s'il est déjà porté par une autre table, ou par une autre colonne de la même table.
 * Comparaison sans tenir compte de la casse, comme la plupart des SGBD. Un nom vide (retour au nom
 * par défaut) n'est pas contrôlé ici.
 */
export function checkLogicalRename(model: LogicalModel, table: string, column: string | null, name: string): string | null {
  const next = name.trim().toLowerCase();
  if (!next) return null;
  if (column === null) {
    const taken = model.tables.some((t) => t.name !== table && t.name.toLowerCase() === next);
    return taken ? MSG.tableNameTaken(name.trim()) : null;
  }
  const owner = model.tables.find((t) => t.name === table);
  const taken = owner?.columns.some((c) => c.name !== column && c.name.toLowerCase() === next);
  return taken ? MSG.columnNameTaken(table, name.trim()) : null;
}
