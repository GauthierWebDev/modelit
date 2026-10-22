import { unplugged } from "./unplugged";

/**
 * Port du stockage local clé → texte de la sauvegarde automatique (override O-22), défini par
 * `autosave.ts` qui l'utilise ; implémenté par la plateforme (`platform/localStore.ts` : IndexedDB) et
 * branché au démarrage (`src/bootstrap.ts`). Les tests branchent un stockage en mémoire.
 */
export interface LocalStore {
  get: (key: string) => Promise<string | null>;
  set: (key: string, value: string) => Promise<void>;
  remove: (key: string) => Promise<void>;
}

let current: LocalStore = unplugged<LocalStore>("LocalStore");

export function setLocalStore(adapter: LocalStore) {
  current = adapter;
}

export const localStore = (): LocalStore => current;
