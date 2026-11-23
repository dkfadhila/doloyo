import { normalizeProject } from './core/commands';
import { embedProjectImages, projectImageIds, restoreEmbeddedImages } from './images/store';
import { readLegacyAutosave } from './legacy';
import type { Project } from './core/types';
import { useStore } from './store';

const DB = 'doloyo';
const STORE = 'kv';
const KEY = 'project';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet<T>(key: string): Promise<T | undefined> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE).objectStore(STORE).get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error);
  });
}

async function idbSet(key: string, value: unknown): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function loadAutosave(): Promise<Project | null> {
  try {
    const raw = (await idbGet<unknown>(KEY)) ?? (await readLegacyAutosave());
    return raw ? normalizeProject(raw) : null;
  } catch (e) {
    console.warn('[persist] load failed', e);
    return null;
  }
}

export function startAutosave(delay = 600): void {
  let timer: number | undefined;
  useStore.subscribe((s, prev) => {
    if (s.project === prev.project) return;
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      idbSet(KEY, JSON.parse(JSON.stringify(useStore.getState().project))).catch((e) => console.warn('[persist] save failed', e));
    }, delay);
  });
}

function download(blob: Blob, filename: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export function downloadDataUrl(url: string, filename: string) {
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** Project file. The extension stays .mdoll.json (files saved by older versions keep opening). */
export async function exportProject(p: Project, embedImages = false): Promise<{ embedded: number; skipped: number }> {
  const name = (p.name || 'project').replace(/[^\w\-]+/g, '_');
  let out: Project & { embeddedImages?: Record<string, string> } = p;
  let embedded = 0;
  let skipped = 0;
  if (embedImages && projectImageIds(p).length) {
    const r = await embedProjectImages(p);
    embedded = Object.keys(r.images).length;
    skipped = r.skipped.length;
    if (embedded) out = { ...p, embeddedImages: r.images };
  }
  download(new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' }), `${name}.mdoll.json`);
  return { embedded, skipped };
}

/** Open a project file. Images embedded in it are stored in this browser first (an id that is already stored is kept). */
export async function importProjectFile(file: File): Promise<Project> {
  const raw = JSON.parse(await file.text());
  await restoreEmbeddedImages(raw);
  return normalizeProject(raw);
}
