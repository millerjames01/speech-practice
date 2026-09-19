/**
 * Shared IndexedDB handle. Two stores: cached TTS audio, and the per-word
 * calibration history the brief asks us to keep across sessions.
 *
 * API keys are never written here.
 */

const DB_NAME = 'conversation-trainer';
const DB_VERSION = 1;

export const AUDIO_STORE = 'audio';
export const CALIBRATION_STORE = 'calibration';

let dbPromise: Promise<IDBDatabase> | null = null;

export function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(AUDIO_STORE)) {
        db.createObjectStore(AUDIO_STORE);
      }
      if (!db.objectStoreNames.contains(CALIBRATION_STORE)) {
        const store = db.createObjectStore(CALIBRATION_STORE, {
          keyPath: 'id',
          autoIncrement: true,
        });
        store.createIndex('word', 'word', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('IndexedDB open failed'));
  });
  return dbPromise;
}

export async function withStore<T>(
  store: string,
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const req = run(tx.objectStore(store));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error(`IndexedDB ${store} failed`));
  });
}
