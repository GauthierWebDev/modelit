import { unplugged } from "./unplugged";

/**
 * Port de l'accès aux fichiers (dialogues d'ouverture et d'enregistrement), défini par l'application qui
 * l'utilise ; implémenté par la plateforme (`platform/files.ts` : Tauri, ou repli navigateur) et branché
 * au démarrage (`src/bootstrap.ts`). Les tests branchent un faux.
 */

export interface OpenedFile {
  path: string;
  content: string;
}

/** Filtre des dialogues natifs ; `name` est le libellé traduit (« Modèle », « Script SQL »). */
export interface FileFilter {
  name: string;
  extensions: string[];
}

export interface FileAccess {
  /** Ouvre un modèle ; `null` si l'utilisateur a annulé. */
  openModel: (filterName: string) => Promise<OpenedFile | null>;
  /** Ouvre un fichier texte quelconque (script SQL de la rétroconception). */
  openText: (filter: FileFilter) => Promise<OpenedFile | null>;
  /** Enregistre un modèle ; sans `path`, demande l'emplacement. Chemin utilisé, ou `null` si annulé. */
  saveModel: (
    content: string,
    path: string | null,
    suggestedName: string,
    filterName: string,
  ) => Promise<string | null>;
  /** Enregistre un fichier exporté (image) ; chemin utilisé, ou `null` si annulé. */
  saveExport: (data: Blob, suggestedName: string, filter: FileFilter) => Promise<string | null>;
  /**
   * Lit un modèle désigné par son chemin, sans dialogue (récents, glisser-déposer, ligne de commande, rouvrir :
   * O-65 à O-68) ; `null` s'il n'existe plus. Indisponible si `readsPaths` est faux (navigateur).
   */
  readModel: (path: string) => Promise<OpenedFile | null>;
  /** La plateforme sait-elle lire un chemin (application native) ? */
  readsPaths: boolean;
}

let access: FileAccess = unplugged<FileAccess>("FileAccess");

export function setFileAccess(adapter: FileAccess) {
  access = adapter;
}

export const fileAccess = (): FileAccess => access;
