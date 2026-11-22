import { getCharacter, registerCustomCharacter, unregisterCustomCharacter, type CharacterDef } from './registry';

/** Imported characters live only in this browser (IndexedDB). Project files reference them by id. */
const DB = 'motion-doll-characters';
const STORE = 'files';

interface Row {
  id: string;
  def: CharacterDef;
  blob: Blob;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const r = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(r.result);
    t.onerror = () => reject(t.error);
  });
}

export async function saveCustomCharacter(def: CharacterDef, blob: Blob): Promise<void> {
  await tx('readwrite', (s) => s.put({ id: def.id, def, blob } as Row));
  registerCustomCharacter(def);
}

export async function getCustomBlob(id: string): Promise<Blob | null> {
  const row = await tx<Row | undefined>('readonly', (s) => s.get(id) as IDBRequest<Row | undefined>);
  return row?.blob ?? null;
}

export async function deleteCustomCharacter(id: string): Promise<void> {
  await tx('readwrite', (s) => s.delete(id));
  unregisterCustomCharacter(id);
}

/** Register every stored imported character so projects that use them can resolve their ids. */
export async function loadCustomCharacters(): Promise<void> {
  try {
    const rows = await tx<Row[]>('readonly', (s) => s.getAll() as IDBRequest<Row[]>);
    for (const r of rows) registerCustomCharacter(r.def);
  } catch (e) {
    console.warn('[characters] could not read stored characters', e);
  }
}

/** Message for the user when a project uses imported characters that are not stored in this browser. */
export function missingCharactersNotice(objects: { name: string; character: string }[]): string | null {
  const missing = objects.filter((o) => o.character.startsWith('custom:') && !getCharacter(o.character));
  if (!missing.length) return null;
  return `${missing.map((o) => o.name).join(', ')} use imported character files that are not in this browser. The procedural doll is shown; import the file again and pick it in Inspector > Character.`;
}
