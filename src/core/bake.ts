import type { Command } from './commands';
import { JOINTS, RIG_BY_NAME } from './rig';
import type { JointName, Keyframe, Pose, Project, SceneObject, Vec3 } from './types';

/** One baked sample: pose at an absolute project time (seconds). */
export interface BakeSample {
  t: number;
  pose: Pose;
  hipsPos: Vec3;
}

export interface BakeOptions {
  /** Grow project duration when the last sample is past it. */
  extend?: boolean;
  /** Keep only every Nth sample (the first and last are always kept). */
  every?: number;
  /**
   * Id of this bake run. The keys are tagged with it, and any EARLIER tagged run that overlaps the written range loses
   * its keys after the range too (a later clip supersedes the rest of an earlier one on these channels; otherwise a looped
   * idle keeps running behind a Death clip and the character stands back up). Untagged (hand-made) keys are never touched.
   */
  run?: string;
}

const EPS = 1e-3;

/**
 * Baked data may exceed human limits slightly (stylised dance, mocap noise). Clamp loosely so wild values cannot
 * wreck the rig but real motion is not flattened: limits widened by 25% of their span plus 12 degrees.
 */
export function clampLoose(joint: JointName, r: Vec3): Vec3 {
  const d = RIG_BY_NAME[joint];
  if (joint === 'hips') return r;
  return [0, 1, 2].map((i) => {
    const span = d.max[i] - d.min[i];
    const pad = span === 0 ? 8 : span * 0.25 + 12;
    return Math.min(d.max[i] + pad, Math.max(d.min[i] - pad, r[i]));
  }) as Vec3;
}

export function thin<T>(samples: T[], every: number): T[] {
  const n = Math.max(1, Math.floor(every));
  if (n === 1 || samples.length <= 2) return samples;
  return samples.filter((_, i) => i % n === 0 || i === samples.length - 1);
}

const round = (n: number) => Math.round(n * 1e4) / 1e4;
const r3 = (v: Vec3): Vec3 => [round(v[0]), round(v[1]), round(v[2])];

/**
 * Build ONE undoable command (a batch of track_restore + optional timeline_set) that writes the samples as keys.
 * Existing keys of the written channels inside the sampled time range are replaced; keys outside are kept.
 */
export function bakeCommand(project: Project, obj: SceneObject, samplesIn: BakeSample[], o: BakeOptions = {}): Command {
  const samples = thin(samplesIn, o.every ?? 1);
  if (!samples.length) throw new Error('Nothing to bake');
  const t0 = samples[0].t;
  const t1 = samples[samples.length - 1].t;
  const channels: string[] = [...JOINTS, 'hipsPos'];
  const commands: Command[] = channels.map((ch) => {
    const existing = obj.tracks[ch] ?? [];
    let superseded: Set<string> | null = null;
    if (o.run) {
      // earlier runs whose key range overlaps [t0, t1]
      const ranges = new Map<string, [number, number]>();
      for (const k of existing) {
        if (!k.run || k.run === o.run) continue;
        const r = ranges.get(k.run);
        if (r) {
          r[0] = Math.min(r[0], k.t);
          r[1] = Math.max(r[1], k.t);
        } else ranges.set(k.run, [k.t, k.t]);
      }
      for (const [id, [a, b]] of ranges) if (a <= t1 + EPS && b >= t0 - EPS) (superseded ??= new Set()).add(id);
    }
    const old = existing.filter((k) => {
      if (k.t >= t0 - EPS && k.t <= t1 + EPS) return false;
      return !(superseded && k.run && superseded.has(k.run) && k.t > t1);
    });
    const mine: Keyframe[] = samples.map((s) => ({
      t: s.t,
      value: ch === 'hipsPos' ? r3(s.hipsPos) : r3(clampLoose(ch as JointName, s.pose[ch as JointName])),
      easing: 'linear',
      ...(o.run ? { run: o.run } : {}),
    }));
    return { type: 'track_restore', object: obj.id, channel: ch, keys: [...old, ...mine].sort((a, b) => a.t - b.t) } as Command;
  });
  if (o.extend && t1 > project.duration + EPS) commands.unshift({ type: 'timeline_set', duration: Math.min(3600, Math.ceil(t1 * 100) / 100) });
  return { type: 'batch', commands };
}
