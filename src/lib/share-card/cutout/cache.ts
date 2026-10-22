import type { Cutout } from "./engine";

/**
 * Cutouts, kept in this browser (IndexedDB) so a photo is cut out once and
 * every card after that is instant. A convenience only: every read and write
 * fails soft (a private window, cleared site data), and a miss just means the
 * engine runs again.
 */

const DB_NAME = "share-card-cutouts";
const STORE = "cutouts";
const DB_VERSION = 1;

/** What is stored: the PNG itself, and what was learned from it. */
type Stored = Omit<Cutout, "src"> & { png: Blob };

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function run<T>(mode: IDBTransactionMode, act: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const request = act(db.transaction(STORE, mode).objectStore(STORE));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      }),
  );
}

export async function readCutout(key: string): Promise<Cutout | null> {
  try {
    const stored = await run<Stored | undefined>("readonly", (store) => store.get(key));
    if (!stored) return null;
    const { png, ...meta } = stored;
    return { ...meta, src: URL.createObjectURL(png) };
  } catch {
    return null;
  }
}

export async function writeCutout(key: string, cutout: Cutout, png: Blob): Promise<void> {
  try {
    const { src: _src, ...meta } = cutout;
    void _src;
    await run("readwrite", (store) => store.put({ ...meta, png } satisfies Stored, key));
  } catch {
    // A cache that cannot be written is a slower next visit, nothing more.
  }
}
