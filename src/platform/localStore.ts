import type { LocalStore } from "@/app/localStore";

/**
 * Stockage local de la sauvegarde automatique (override O-22) : IndexedDB, la base de données du
 * navigateur (et de la webview Tauri), sans la limite de quelques Mo du localStorage.
 */

const DB_NAME = "modelit";
const STORE = "autosave";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

let db: Promise<IDBDatabase> | null = null;

function run<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  db ??= openDb();
  return db.then(
    (database) =>
      new Promise<T>((resolve, reject) => {
        const request = action(database.transaction(STORE, mode).objectStore(STORE));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      }),
  );
}

export const indexedDbStore: LocalStore = {
  get: async (key) => ((await run("readonly", (s) => s.get(key))) as string | undefined) ?? null,
  set: async (key, value) => void (await run("readwrite", (s) => s.put(value, key))),
  remove: async (key) => void (await run("readwrite", (s) => s.delete(key))),
};

/** Copie laissée dans le localStorage par une version précédente : à supprimer. */
export function removeLegacyLocalStorageCopy(key: string) {
  try {
    globalThis.localStorage.removeItem(key);
  } catch {
    // localStorage indisponible : rien à nettoyer.
  }
}
