import { frEditor } from "./fr/editor";
import { frFiles } from "./fr/files";
import { frMenus } from "./fr/menus";
import { frSession } from "./fr/session";

/**
 * Catalogue de référence (français), réuni depuis les parties de `fr/` (une par domaine). Toute clé
 * ajoutée à une partie doit l'être dans la partie de même nom de `en/` (vérifié par le typage).
 * Paramètres : `{nom}`.
 */
export const fr = { ...frSession, ...frMenus, ...frEditor, ...frFiles } as const;

export type MessageKey = keyof typeof fr;
