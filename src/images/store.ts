import type { Project } from '../core/types';

/**
 * Reference images live only in this browser (IndexedDB), like imported characters. A project references them by id.
 * Decoded pictures are cached (HTMLImageElement) so the viewport, snapshots and exports can draw them synchronously.
 */
const DB = 'doloyo-images';
const STORE = 'images';

export const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
/** Images up to this size can be embedded as a data URL in the saved project file. */
export const EMBED_MAX_BYTES = 2 * 1024 * 1024;
export const IMAGE_ACCEPT = 'image/png,image/jpeg,image/webp,image/gif,image/svg+xml,.png,.jpg,.jpeg,.webp,.gif,.svg';
const MIME_OK = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml'];
const EXT_MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', svg: 'image/svg+xml' };

export interface ImageMeta {
  id: string;
  name: string;
  mime: string;
  width: number;
  height: number;
  bytes: number;
}
interface Row extends ImageMeta {
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
  try {
    return await new Promise<T>((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const r = fn(t.objectStore(STORE));
      t.oncomplete = () => resolve(r.result);
      t.onerror = () => reject(t.error);
    });
  } finally {
    db.close();
  }
}

// ---- change notification + caches ----

let version = 0;
const listeners = new Set<() => void>();
export const onImagesChange = (fn: () => void) => {
  listeners.add(fn);
  return () => void listeners.delete(fn);
};
export const imagesVersion = () => version;
const bump = () => {
  version++;
  listeners.forEach((f) => f());
};

interface Loaded {
  img: HTMLImageElement;
  url: string;
  meta: ImageMeta;
}
const loaded = new Map<string, Loaded>();
const pending = new Map<string, Promise<Loaded | null>>();
const missing = new Set<string>();

/** Synchronous access for drawing; null while not loaded (or missing). */
export const getCachedImage = (id: string): HTMLImageElement | null => loaded.get(id)?.img ?? null;
export const getCachedImageUrl = (id: string): string | null => loaded.get(id)?.url ?? null;
export const getCachedMeta = (id: string): ImageMeta | null => loaded.get(id)?.meta ?? null;
export const isImageMissing = (id: string): boolean => missing.has(id);

function decode(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('The file could not be decoded as an image'));
    img.src = url;
  });
}

/** Load a stored image into the cache. Resolves null when the id is not stored in this browser. */
export function ensureImage(id: string): Promise<Loaded | null> {
  const have = loaded.get(id);
  if (have) return Promise.resolve(have);
  let p = pending.get(id);
  if (!p) {
    p = (async () => {
      try {
        const row = await tx<Row | undefined>('readonly', (s) => s.get(id) as IDBRequest<Row | undefined>);
        if (!row) {
          missing.add(id);
          return null;
        }
        const url = URL.createObjectURL(row.blob);
        const img = await decode(url);
        const l: Loaded = { img, url, meta: { id: row.id, name: row.name, mime: row.mime, width: row.width, height: row.height, bytes: row.bytes } };
        loaded.set(id, l);
        missing.delete(id);
        return l;
      } catch (e) {
        console.warn('[images] could not load', id, e);
        missing.add(id);
        return null;
      } finally {
        pending.delete(id);
        bump();
      }
    })();
    pending.set(id, p);
  }
  return p;
}

/** Ids of every image a project uses. */
export function projectImageIds(p: Pick<Project, 'objects' | 'background' | 'cameraBackground'>): string[] {
  const ids = new Set<string>();
  if (p.background) ids.add(p.background.imageId);
  if (p.cameraBackground) ids.add(p.cameraBackground.imageId);
  for (const o of p.objects) if (o.kind === 'image' && o.image) ids.add(o.image.imageId);
  return [...ids];
}

/** Load every image of a project; returns the ids that are not stored in this browser. */
export async function loadProjectImages(p: Pick<Project, 'objects' | 'background' | 'cameraBackground'>): Promise<string[]> {
  const ids = projectImageIds(p);
  const res = await Promise.all(ids.map((id) => ensureImage(id)));
  return ids.filter((_, i) => !res[i]);
}

/** Warning for the user when a project uses images that are not stored in this browser. */
export function missingImagesNotice(p: Pick<Project, 'objects' | 'background' | 'cameraBackground'>, missingIds: string[]): string | null {
  if (!missingIds.length) return null;
  const set = new Set(missingIds);
  const names: string[] = [];
  if (p.background && set.has(p.background.imageId)) names.push(`viewport background "${p.background.name}"`);
  if (p.cameraBackground && set.has(p.cameraBackground.imageId)) names.push(`camera background "${p.cameraBackground.name}"`);
  for (const o of p.objects) if (o.kind === 'image' && o.image && set.has(o.image.imageId)) names.push(`image plane "${o.name}"`);
  return `${names.join(', ')} use reference images that are not stored in this browser, so they are not shown. Add the picture again (File > Add reference image) or open a project file saved with "Embed images".`;
}

// ---- adding ----

export class ImageError extends Error {}

function sniffMime(blob: Blob, name?: string): string {
  if (MIME_OK.includes(blob.type)) return blob.type;
  const ext = (name ?? '').split('.').pop()?.toLowerCase() ?? '';
  return EXT_MIME[ext] ?? '';
}

function newId(): string {
  return 'img' + Date.now().toString(36).slice(-4) + Math.random().toString(36).slice(2, 8);
}

/** Animated GIFs become a PNG of the first frame (so every consumer, including the GPU texture, sees the same picture). */
async function firstFramePng(blob: Blob): Promise<Blob> {
  const bmp = await createImageBitmap(blob);
  const c = document.createElement('canvas');
  c.width = bmp.width;
  c.height = bmp.height;
  c.getContext('2d')!.drawImage(bmp, 0, 0);
  bmp.close();
  return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new ImageError('Could not convert the GIF'))), 'image/png'));
}

/** Store an image file in this browser. Returns its metadata (id, size, aspect source). `forceId` keeps ids of embedded images stable. */
export async function addImageBlob(blob: Blob, name = 'image', forceId?: string): Promise<ImageMeta> {
  let mime = sniffMime(blob, name);
  if (!mime) throw new ImageError('Unsupported image type. Use PNG, JPG, WebP, GIF or SVG.');
  if (blob.size === 0 || blob.size > MAX_IMAGE_BYTES) throw new ImageError(`The image must be between 1 byte and ${MAX_IMAGE_BYTES / 1048576} MB`);
  let data: Blob = blob.type === mime ? blob : new Blob([blob], { type: mime });
  if (mime === 'image/gif') {
    data = await firstFramePng(data);
    mime = 'image/png';
  }
  const url = URL.createObjectURL(data);
  let img: HTMLImageElement;
  try {
    img = await decode(url);
  } catch (e) {
    URL.revokeObjectURL(url);
    throw new ImageError(e instanceof Error ? e.message : String(e));
  }
  const width = img.naturalWidth || 1024;
  const height = img.naturalHeight || 1024;
  const id = forceId ?? newId();
  const meta: ImageMeta = { id, name: name.replace(/\.[a-z0-9]+$/i, '').slice(0, 60) || 'image', mime, width, height, bytes: data.size };
  await tx('readwrite', (s) => s.put({ ...meta, blob: data } as Row));
  const old = loaded.get(id);
  if (old) URL.revokeObjectURL(old.url);
  loaded.set(id, { img, url, meta });
  missing.delete(id);
  bump();
  return meta;
}

export async function addImageFile(file: File): Promise<ImageMeta> {
  return addImageBlob(file, file.name);
}

export function dataUrlToBlob(dataUrl: string): Blob {
  const m = /^data:([^;,]*)(;base64)?,(.*)$/s.exec(dataUrl);
  if (!m) throw new ImageError('dataUrl must be a data: URL (data:image/png;base64,...)');
  const bin = m[2] ? atob(m[3]) : decodeURIComponent(m[3]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: m[1] });
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

export async function getImageBlob(id: string): Promise<Blob | null> {
  const row = await tx<Row | undefined>('readonly', (s) => s.get(id) as IDBRequest<Row | undefined>);
  return row?.blob ?? null;
}

// ---- project file embedding ----

export interface EmbedResult {
  images: Record<string, string>;
  skipped: string[];
}

/** Data URLs for the images a project uses (only those up to 2 MB; the others are listed in `skipped`). */
export async function embedProjectImages(p: Pick<Project, 'objects' | 'background' | 'cameraBackground'>): Promise<EmbedResult> {
  const images: Record<string, string> = {};
  const skipped: string[] = [];
  for (const id of projectImageIds(p)) {
    const blob = await getImageBlob(id);
    if (!blob) skipped.push(id);
    else if (blob.size > EMBED_MAX_BYTES) skipped.push(id);
    else images[id] = await blobToDataUrl(blob);
  }
  return { images, skipped };
}

/** Put the images embedded in a project file into this browser (an id that is already stored is kept). */
export async function restoreEmbeddedImages(raw: unknown): Promise<number> {
  const emb = (raw as { embeddedImages?: unknown } | null)?.embeddedImages;
  if (!emb || typeof emb !== 'object') return 0;
  let n = 0;
  for (const [id, url] of Object.entries(emb as Record<string, unknown>)) {
    if (typeof url !== 'string' || !/^[\w-]{1,64}$/.test(id)) continue;
    try {
      const have = await tx<Row | undefined>('readonly', (s) => s.get(id) as IDBRequest<Row | undefined>);
      if (have) continue;
      await addImageBlob(dataUrlToBlob(url), 'embedded', id);
      n++;
    } catch (e) {
      console.warn('[images] embedded image skipped', id, e);
    }
  }
  return n;
}
