/**
 * Backward compatibility with the product's former name (Motion Doll Studio).
 * The app now stores its data under "doloyo" names; this module copies what older versions saved the first time it runs
 * (the old data is never deleted, so a user can go back) and lets small readers fall back to the old keys.
 */

export const LEGACY_PROJECT_DB = 'motion-doll';
export const LEGACY_CHARACTER_DB = 'motion-doll-characters';
const DONE_KEY = 'doloyo.migrated.v1';

type WebStorage = Pick<Storage, 'getItem' | 'setItem'>;

/** Read a key from a storage; when only the old key exists, copy it to the new key and return it. */
export function getCompat(storage: WebStorage | null, key: string, legacyKey: string): string | null {
  try {
    if (!storage) return null;
    const v = storage.getItem(key);
    if (v !== null) return v;
    const old = storage.getItem(legacyKey);
    if (old !== null) {
      try {
        storage.setItem(key, old);
      } catch {
        /* read-only is fine */
      }
    }
    return old;
  } catch {
    return null;
  }
}

const local = (): Storage | null => {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
};
export const session = (): Storage | null => {
  try {
    return globalThis.sessionStorage ?? null;
  } catch {
    return null;
  }
};
export { local as localStore };

const req = <T,>(r: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });

async function dbExists(name: string): Promise<boolean> {
  const list = (indexedDB as IDBFactory & { databases?: () => Promise<{ name?: string }[]> }).databases;
  if (!list) return true; // cannot tell: open it and look at the stores
  try {
    return (await list.call(indexedDB)).some((d) => d.name === name);
  } catch {
    return true;
  }
}

/** Every record of a store in an existing legacy database; null when the database or the store is not there. */
async function readLegacy(dbName: string, store: string): Promise<{ key: IDBValidKey; value: unknown }[] | null> {
  if (!(await dbExists(dbName))) return null;
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const r = indexedDB.open(dbName);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  try {
    if (!db.objectStoreNames.contains(store)) return null;
    const t = db.transaction(store, 'readonly');
    const os = t.objectStore(store);
    const [keys, values] = await Promise.all([req(os.getAllKeys()), req(os.getAll())]);
    return keys.map((key, i) => ({ key, value: values[i] }));
  } finally {
    db.close();
    // opening a missing database creates an empty one: remove that leftover (a real legacy database has its store)
  }
}

/** The project autosaved by an older version (fallback when the new database has none). */
export async function readLegacyAutosave(): Promise<unknown | undefined> {
  try {
    const rows = await readLegacy(LEGACY_PROJECT_DB, 'kv');
    return rows?.find((r) => r.key === 'project')?.value;
  } catch {
    return undefined;
  }
}

async function copyInto(dbName: string, store: string, keyPath: string | null, rows: { key: IDBValidKey; value: unknown }[]): Promise<number> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const r = indexedDB.open(dbName, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(store, keyPath ? { keyPath } : undefined);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  try {
    let n = 0;
    for (const row of rows) {
      const t = db.transaction(store, 'readwrite');
      const os = t.objectStore(store);
      const key = keyPath ? (row.value as Record<string, IDBValidKey>)[keyPath] : row.key;
      const have = await req(os.getKey(key));
      if (have === undefined) {
        await req(keyPath ? os.put(row.value) : os.put(row.value, row.key));
        n++;
      }
    }
    return n;
  } finally {
    db.close();
  }
}

/** Copy the old project autosave and imported characters into the doloyo databases (once; existing new data wins). */
export async function migrateLegacyData(): Promise<void> {
  const ls = local();
  try {
    if (ls?.getItem(DONE_KEY) === '1') return;
  } catch {
    /* continue */
  }
  try {
    const proj = await readLegacy(LEGACY_PROJECT_DB, 'kv');
    if (proj?.length) await copyInto('doloyo', 'kv', null, proj);
    const chars = await readLegacy(LEGACY_CHARACTER_DB, 'files');
    if (chars?.length) await copyInto('doloyo-characters', 'files', 'id', chars);
    try {
      ls?.setItem(DONE_KEY, '1');
    } catch {
      /* ignore */
    }
  } catch (e) {
    console.warn('[legacy] could not migrate data from the previous version (it is still readable there)', e);
  }
}
