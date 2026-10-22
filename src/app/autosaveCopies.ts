import type { LocalStore } from "./localStore";

/**
 * Copies de la sauvegarde automatique dans le stockage local (overrides O-22, O-44) : clés, format, lecture
 * des copies laissées par une session interrompue. Le suivi des onglets est dans `autosave.ts`.
 */

/** Ordre des onglets qui ont une copie : identifiants de session des documents. */
export const INDEX_KEY = "modelit/autosave/documents";
export const entryKey = (id: string) => `modelit/autosave/document/${id}`;
/** Copie unique des versions 0.1.x (un seul document). */
const LEGACY_KEY = "modelit/autosave";

export interface AutosaveEntry {
  savedAt: string;
  filePath: string | null;
  /** Nom affiché (« Sans titre 2 »…) ; absent des copies des versions 0.1.x. */
  name?: string;
  content: string;
}

/** Copies laissées par une session interrompue, dans l'ordre de ses onglets. */
export async function readCopies(from: LocalStore): Promise<{ keys: string[]; copies: AutosaveEntry[] }> {
  const keys: string[] = [];
  const copies: AutosaveEntry[] = [];
  const index = await from.get(INDEX_KEY);
  if (index) {
    keys.push(INDEX_KEY);
    for (const id of JSON.parse(index) as string[]) {
      // biome-ignore lint/performance/noAwaitInLoops: lecture séquentielle de l'index, dans l'ordre des onglets
      const raw = await from.get(entryKey(id));
      keys.push(entryKey(id));
      if (raw) {
        copies.push(JSON.parse(raw) as AutosaveEntry);
      }
    }
  }
  const legacy = await from.get(LEGACY_KEY);
  if (legacy) {
    keys.push(LEGACY_KEY);
    copies.push(JSON.parse(legacy) as AutosaveEntry);
  }
  return { keys, copies };
}

/** Copie laissée dans le localStorage par les versions 0.1.x : à supprimer. */
export function removeLegacyLocalStorageCopy() {
  try {
    globalThis.localStorage.removeItem(LEGACY_KEY);
  } catch {
    // localStorage indisponible : rien à nettoyer.
  }
}
