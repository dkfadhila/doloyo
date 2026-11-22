// Generates public/examples/*.mdoll.json from the core command API and the animation library, so the examples are
// valid by construction. Run: npm run examples   (vite-node, no build step needed). Output is deterministic.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { ClipSampler, DEFAULT_APPLY, sampleClip, type ClipInfo } from '../src/anim/library';
import { bakeCommand } from '../src/core/bake';
import { applyCommand, newProject, type Command } from '../src/core/commands';
import type { Project, Vec3 } from '../src/core/types';
import { QUATERNIUS_BONES, QUATERNIUS_CALIBRATION } from '../src/characters/registry';
import { Retargeter } from '../src/retarget/skeletal';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = resolve(root, 'public', 'examples');
const FPS = 30;

const index = (JSON.parse(readFileSync(resolve(root, 'public/assets/anims/index.json'), 'utf8')) as { clips: ClipInfo[] }).clips;
const glbs = new Map<string, Promise<GLTF>>();
function loadGlb(file: string): Promise<GLTF> {
  if (!glbs.has(file)) {
    const b = readFileSync(resolve(root, 'public/assets/anims', file + '.glb'));
    const ab = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
    glbs.set(file, new Promise((res, rej) => new GLTFLoader().parse(ab, '', res, rej)));
  }
  return glbs.get(file)!;
}

/** Bake a library clip onto an object as ONE command (same path as the app's Apply button). */
async function bake(p: Project, objectId: string, clipId: string, o: { start: number; loops?: number; every?: number; mirror?: boolean; inPlace?: boolean }): Promise<Project> {
  const info = index.find((c) => c.id === clipId);
  if (!info) throw new Error('Unknown clip ' + clipId);
  const g = await loadGlb(info.file);
  const clip = g.animations.find((c) => c.name === info.name)!;
  const s = new ClipSampler(new Retargeter(clone(g.scene), QUATERNIUS_BONES, QUATERNIUS_CALIBRATION), clip);
  const samples = sampleClip(s, info, { ...DEFAULT_APPLY, fps: FPS, start: o.start, loops: o.loops ?? 1, every: o.every ?? 1, mirror: !!o.mirror, inPlace: !!o.inPlace });
  s.dispose();
  const obj = p.objects.find((x) => x.id === objectId)!;
  return applyCommand(p, bakeCommand(p, obj, samples)).project;
}

const run = (p: Project, c: Command) => applyCommand(p, c).project;

/** Fixed ids so regenerating gives identical files (scene_preset assigns random ids). */
function stableIds(p: Project, prefix: string): Project {
  let json = JSON.stringify(p);
  let n = 0;
  for (const o of p.objects) json = json.split(`"${o.id}"`).join(`"${o.kind === 'camera' ? 'camera' : `${prefix}${++n}`}"`);
  return JSON.parse(json) as Project;
}

function base(name: string, duration: number): Project {
  let p = newProject();
  p = { ...p, name, objects: [] };
  p = run(p, { type: 'timeline_set', fps: FPS, duration });
  return p;
}

async function waveHello(): Promise<Project> {
  let p = base('Wave hello', 4);
  p = run(p, { type: 'object_add', kind: 'mannequin', id: 'doll1', name: 'Doll', position: [0, 0, 0] });
  const key = (time: number, easing: 'easeInOut' | 'linear' = 'easeInOut') => (p = run(p, { type: 'key_add', object: 'doll1', time, easing }));
  p = run(p, { type: 'pose_apply', object: 'doll1', pose: 'stand' });
  key(0);
  // raise the right arm
  p = run(p, { type: 'pose_apply', object: 'doll1', pose: 'wave_up' });
  p = run(p, { type: 'joint_set', object: 'doll1', joint: 'head', rotation: [0, -12, 4] });
  key(0.7);
  // wave: the forearm swings side to side
  const swing: [number, number][] = [[1.0, -55], [1.3, 5], [1.6, -55], [1.9, 5], [2.2, -55], [2.5, 5]];
  for (const [t, ang] of swing) {
    p = run(p, { type: 'joint_set', object: 'doll1', joint: 'R_elbow', rotation: [ang, 0, 0] });
    p = run(p, { type: 'joint_set', object: 'doll1', joint: 'R_wrist', rotation: [0, 0, ang > 0 ? 18 : -22] });
    key(t);
  }
  // lower the arm and relax
  p = run(p, { type: 'pose_apply', object: 'doll1', pose: 'stand' });
  key(3.4);
  p = run(p, { type: 'playhead_seek', time: 0 });
  return stableIds(p, 'doll');
}

async function danceCrew(): Promise<Project> {
  const DURATION = 6;
  let p = base('Dance crew', DURATION);
  p = run(p, { type: 'scene_preset', preset: 'group5', character: 'mannequin-f' });
  const dolls = p.objects.filter((o) => o.kind === 'mannequin');
  p = run(p, { type: 'object_set_character', object: dolls[1].id, character: 'mannequin-m' });
  p = run(p, { type: 'object_set_character', object: dolls[3].id, character: 'mannequin-m' });
  for (const [i, d] of dolls.entries()) p = await bake(p, d.id, 'ual1/Dance_Loop', { start: 0, loops: DURATION, every: 3, inPlace: true, mirror: i % 2 === 1 });
  // render camera: slow dolly in with a slight arc, keyed at both ends
  p = run(p, { type: 'camera_set', position: [-1.2, 1.5, 7.2], target: [0, 0.95, 0.3], fov: 38 });
  const cam = p.objects.find((o) => o.kind === 'camera')!.id;
  p = run(p, { type: 'key_add', object: cam, time: 0, easing: 'easeInOut' });
  p = run(p, { type: 'camera_set', position: [1.6, 1.25, 5.0], target: [0, 1.0, 0.3], fov: 34 });
  p = run(p, { type: 'key_add', object: cam, time: DURATION, easing: 'easeInOut' });
  p = run(p, { type: 'playhead_seek', time: 0 });
  return stableIds(p, 'dancer');
}

async function swordDuel(): Promise<Project> {
  const DURATION = 4;
  let p = base('Sword duel', DURATION);
  const A: Vec3 = [-0.9, 0, 0];
  const B: Vec3 = [0.9, 0, 0];
  p = run(p, { type: 'object_add', kind: 'mannequin', id: 'duelist1', name: 'Attacker', position: A, character: 'mannequin-m' });
  p = run(p, { type: 'object_add', kind: 'mannequin', id: 'duelist2', name: 'Defender', position: B, character: 'mannequin-f' });
  // dolls face +Z at yaw 0: +90 turns toward +X, -90 toward -X, so they face each other
  p = run(p, { type: 'object_transform', object: 'duelist1', rotation: [0, 90, 0] });
  p = run(p, { type: 'object_transform', object: 'duelist2', rotation: [0, -90, 0] });
  p = await bake(p, 'duelist1', 'ual2/Sword_Regular_Combo', { start: 0.2, every: 2, inPlace: true });
  p = await bake(p, 'duelist2', 'ual2/Sword_Block', { start: 0.5, every: 2, inPlace: true });
  p = run(p, { type: 'camera_set', position: [0.4, 1.45, 4.6], target: [0, 1.0, 0], fov: 36 });
  const cam = p.objects.find((o) => o.kind === 'camera')!.id;
  p = run(p, { type: 'key_add', object: cam, time: 0, easing: 'easeInOut' });
  p = run(p, { type: 'camera_set', position: [-0.5, 1.3, 3.6], target: [0, 1.05, 0], fov: 32 });
  p = run(p, { type: 'key_add', object: cam, time: DURATION, easing: 'easeInOut' });
  p = run(p, { type: 'playhead_seek', time: 0 });
  return stableIds(p, 'duelist');
}

mkdirSync(outDir, { recursive: true });
const jobs: [string, () => Promise<Project>][] = [
  ['wave-hello', waveHello],
  ['dance-crew', danceCrew],
  ['sword-duel', swordDuel],
];
for (const [file, make] of jobs) {
  const p = await make();
  const text = JSON.stringify(p) + '\n';
  writeFileSync(resolve(outDir, file + '.mdoll.json'), text);
  const keys = p.objects.reduce((n, o) => n + Object.values(o.tracks).reduce((m, t) => m + t.length, 0), 0);
  console.log(`${file}.mdoll.json  ${(text.length / 1024).toFixed(0)} KB  objects=${p.objects.length}  keys=${keys}  duration=${p.duration}s`);
}
