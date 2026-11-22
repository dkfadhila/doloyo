import type { VRM } from '@pixiv/three-vrm';
import type { Object3D } from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { getCharacter, type CharacterDef } from './registry';
import { getCustomBlob } from './store';

export interface Loaded {
  /** Scene graph for ONE object (cloned for glb, the VRM scene itself for vrm). */
  scene: Object3D;
  vrm?: VRM;
  animations: GLTF['animations'];
}

const parsed = new Map<string, Promise<GLTF>>();
const buffers = new Map<string, Promise<ArrayBuffer>>();
const pending = new Set<Promise<unknown>>();

function track<T>(p: Promise<T>): Promise<T> {
  pending.add(p);
  const done = () => pending.delete(p);
  p.then(done, done);
  return p;
}

/** Resolves when every character currently loading has finished (used before snapshots and exports). */
export async function charactersReady(): Promise<void> {
  while (pending.size) await Promise.allSettled([...pending]);
}

async function fetchBuffer(def: CharacterDef): Promise<ArrayBuffer> {
  if (def.custom) {
    const blob = await getCustomBlob(def.id);
    if (!blob) throw new Error(`Imported character "${def.label}" is not stored in this browser anymore`);
    return blob.arrayBuffer();
  }
  const res = await fetch(def.url);
  if (!res.ok) throw new Error(`Could not load ${def.url} (HTTP ${res.status})`);
  return res.arrayBuffer();
}

async function parseGltf(buf: ArrayBuffer, vrm: boolean): Promise<GLTF> {
  const loader = new GLTFLoader();
  if (vrm) {
    const { VRMLoaderPlugin } = await import('@pixiv/three-vrm'); // only loaded when a VRM is actually opened
    loader.register((p) => new VRMLoaderPlugin(p));
  }
  return new Promise((resolve, reject) => loader.parse(buf.slice(0), '', resolve, reject));
}

/** Load a character for one scene object. GLB parsing is cached and the scene is cloned per object. */
export function loadCharacter(id: string): Promise<Loaded> {
  const def = getCharacter(id);
  if (!def || def.kind === 'procedural') return Promise.reject(new Error(`No file for character "${id}"`));
  const run = async (): Promise<Loaded> => {
    if (def.kind === 'vrm') {
      let b = buffers.get(id);
      if (!b) buffers.set(id, (b = fetchBuffer(def)));
      const gltf = await parseGltf(await b, true);
      const vrm = gltf.userData.vrm as VRM | undefined;
      if (!vrm) throw new Error('This file is not a valid VRM');
      (await import('@pixiv/three-vrm')).VRMUtils.removeUnnecessaryJoints(vrm.scene);
      return { scene: vrm.scene, vrm, animations: [] };
    }
    let g = parsed.get(id);
    if (!g) parsed.set(id, (g = fetchBuffer(def).then((b) => parseGltf(b, false))));
    const gltf = await g;
    return { scene: cloneSkinned(gltf.scene), animations: gltf.animations };
  };
  return track(run());
}

/** Forget cached data of an imported character (after delete or re-import). */
export function forgetCharacter(id: string): void {
  parsed.delete(id);
  buffers.delete(id);
}

/** Parse an arbitrary file for the import dialog. */
export async function parseFile(file: File): Promise<{ gltf: GLTF; vrm?: VRM; kind: 'glb' | 'vrm' }> {
  const buf = await file.arrayBuffer();
  const isVrm = /\.vrm$/i.test(file.name);
  const gltf = await parseGltf(buf, isVrm);
  const vrm = (gltf.userData.vrm as VRM | undefined) ?? undefined;
  return { gltf, vrm, kind: vrm ? 'vrm' : 'glb' };
}

const animCache = new Map<string, Promise<GLTF>>();
/** Animation library files (skeleton + clips). Cached; callers clone the scene. */
export function loadAnimFile(url: string): Promise<GLTF> {
  let p = animCache.get(url);
  if (!p) {
    p = fetch(url).then(async (r) => {
      if (!r.ok) throw new Error(`Could not load ${url} (HTTP ${r.status})`);
      return parseGltf(await r.arrayBuffer(), false);
    });
    animCache.set(url, p);
    p.catch(() => animCache.delete(url));
  }
  return p;
}
export { cloneSkinned };
