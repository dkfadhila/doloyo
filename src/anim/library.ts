import { AnimationMixer, type AnimationAction, type AnimationClip, type Object3D } from 'three';
import { loadAnimFile, cloneSkinned } from '../characters/loader';
import { assetUrl, QUATERNIUS_BONES, QUATERNIUS_CALIBRATION } from '../characters/registry';
import { emptyPose, mirrorJointName, mirrorRotation, JOINTS } from '../core/rig';
import type { BakeSample } from '../core/bake';
import type { Pose, Vec3 } from '../core/types';
import { Retargeter } from '../retarget/skeletal';

export interface ClipInfo {
  id: string; // "ual1/Dance_Loop"
  file: 'ual1' | 'ual2';
  name: string;
  duration: number;
}
export const isLoop = (c: ClipInfo) => /loop|idle/i.test(c.name);

let index: Promise<ClipInfo[]> | null = null;
/** Clip list from the static index (no GLB download). */
export function listClips(): Promise<ClipInfo[]> {
  if (!index) {
    index = fetch(assetUrl('anims/index.json'))
      .then(async (r) => {
        if (!r.ok) throw new Error(`Animation index not found (HTTP ${r.status}). Run scripts/prepare-assets.sh.`);
        return ((await r.json()) as { clips: ClipInfo[] }).clips;
      })
      .catch((e) => {
        index = null;
        throw e;
      });
  }
  return index;
}

export function searchClips(list: ClipInfo[], query?: string): ClipInfo[] {
  const q = (query ?? '').trim().toLowerCase().replace(/[\s_-]+/g, '');
  if (!q) return list;
  return list.filter((c) => c.name.toLowerCase().replace(/[\s_-]+/g, '').includes(q) || c.id.toLowerCase().includes(q));
}

export function findClip(list: ClipInfo[], ref: string): ClipInfo {
  const r = ref.trim().toLowerCase();
  const hit = list.find((c) => c.id.toLowerCase() === r) ?? list.find((c) => c.name.toLowerCase() === r);
  if (hit) return hit;
  const near = searchClips(list, ref).slice(0, 8).map((c) => c.name);
  throw new Error(`Unknown clip "${ref}"${near.length ? ` (similar: ${near.join(', ')})` : ''}. Use anim_list to see the clips.`);
}

/** Plays one clip on a hidden reference skeleton and reads our pose back from it (exact inverse retarget). */
export class ClipSampler {
  private mixer: AnimationMixer;
  private action: AnimationAction;
  constructor(private rt: Retargeter, readonly clip: AnimationClip) {
    this.mixer = new AnimationMixer(rt.model);
    this.action = this.mixer.clipAction(clip);
    this.action.play();
  }
  /** Pose at clip time t (seconds, not wrapped). */
  sample(t: number): { pose: Pose; hipsPos: Vec3 } {
    this.mixer.setTime(Math.max(0, t));
    this.rt.model.updateMatrixWorld(true);
    return this.rt.read();
  }
  dispose() {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.rt.model);
  }
}

/** Load the library file lazily and return a sampler for the clip. Each call builds its own skeleton so samplers can run in parallel. */
export async function createSampler(info: ClipInfo): Promise<ClipSampler> {
  const g = await loadAnimFile(assetUrl(`anims/${info.file}.glb`));
  const clip = g.animations.find((c) => c.name === info.name);
  if (!clip) throw new Error(`Clip "${info.name}" not found in ${info.file}.glb`);
  const rt = new Retargeter(cloneSkinned(g.scene), QUATERNIUS_BONES, QUATERNIUS_CALIBRATION);
  return new ClipSampler(rt, clip);
}

export function mirrorSample(s: { pose: Pose; hipsPos: Vec3 }): { pose: Pose; hipsPos: Vec3 } {
  const pose = emptyPose();
  for (const j of JOINTS) pose[mirrorJointName(j)] = mirrorRotation(s.pose[j]);
  return { pose, hipsPos: [-s.hipsPos[0] || 0, s.hipsPos[1], s.hipsPos[2]] };
}

export interface ApplyOptions {
  /** Project time of the first key (seconds). */
  start: number;
  speed: number;
  loops: number;
  /** Sample every N frames (1, 2, 3, 5). */
  every: number;
  mirror: boolean;
  /** Drop horizontal hips travel (keep height). */
  inPlace: boolean;
  fps: number;
}

export const DEFAULT_APPLY: Omit<ApplyOptions, 'start' | 'fps'> = { speed: 1, loops: 1, every: 1, mirror: false, inPlace: false };

/** Project-time length of a clip run with these options. */
export function runLength(info: ClipInfo, o: Pick<ApplyOptions, 'speed' | 'loops'>): number {
  return (info.duration * Math.max(1, o.loops)) / Math.max(0.05, o.speed);
}

/** Sample a clip into bake samples on the project frame grid. */
export function sampleClip(sampler: ClipSampler, info: ClipInfo, o: ApplyOptions): BakeSample[] {
  const speed = Math.max(0.05, o.speed);
  const loops = Math.max(1, Math.round(o.loops));
  const total = info.duration * loops; // clip seconds
  const stepFrames = Math.max(1, Math.round(o.every));
  const frames = Math.max(1, Math.round((total / speed) * o.fps));
  const startFrame = Math.round(o.start * o.fps);
  const out: BakeSample[] = [];
  const loop = isLoop(info) || loops > 1;
  for (let f = 0; f <= frames; f += stepFrames) {
    const last = f + stepFrames > frames;
    const fr = last ? frames : f;
    const clipT = Math.min(total, (fr / o.fps) * speed);
    const local = loop && clipT < total ? clipT % info.duration : Math.min(clipT, info.duration);
    let s = sampler.sample(clipT >= total ? info.duration : local);
    if (o.mirror) s = mirrorSample(s);
    const hips: Vec3 = o.inPlace ? [0, s.hipsPos[1], 0] : s.hipsPos;
    out.push({ t: (startFrame + fr) / o.fps, pose: s.pose, hipsPos: hips });
    if (last) break;
  }
  return out;
}
