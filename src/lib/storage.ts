/**
 * Optional on-device persistence. Nothing is written unless the user turns on
 * "Keep on this device"; turning it off or removing the photo deletes it.
 */
import type { LookSettings } from "./look";

export interface SavedSession {
  photo: Blob;
  width: number;
  height: number;
  mask: Uint8Array;
  autoMask: Uint8Array | null;
  look: LookSettings;
  savedAt: number;
}

const DB_NAME = "drape-studio";
const STORE = "session";
const KEY = "current";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB unavailable"));
      return;
    }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB error"));
  });
}

async function run<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = () => reject(tx.error ?? new Error("IndexedDB error"));
      tx.onabort = () => reject(tx.error ?? new Error("IndexedDB aborted"));
    });
  } finally {
    db.close();
  }
}

export async function saveSession(session: SavedSession): Promise<void> {
  await run("readwrite", (s) => s.put(session, KEY));
}

export async function loadSession(): Promise<SavedSession | null> {
  try {
    const v = await run<SavedSession | undefined>("readonly", (s) => s.get(KEY) as IDBRequest<SavedSession | undefined>);
    if (!v || !(v.photo instanceof Blob) || !(v.mask instanceof Uint8Array)) return null;
    if (v.mask.length !== v.width * v.height) return null;
    return v;
  } catch {
    return null;
  }
}

export async function clearSession(): Promise<void> {
  try {
    await run("readwrite", (s) => s.delete(KEY));
  } catch {
    // Nothing stored or storage unavailable: nothing to remove.
  }
}
