/**
 * Port du stockage local clé → texte de la sauvegarde automatique (override O-22), défini par
 * `autosave.ts` qui l'utilise ; implémenté par la plateforme (`platform/localStore.ts` : IndexedDB).
 */
export interface LocalStore {
  get: (key: string) => Promise<string | null>;
  set: (key: string, value: string) => Promise<void>;
  remove: (key: string) => Promise<void>;
}
