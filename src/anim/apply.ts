import { create } from 'zustand';
import { bakeCommand } from '../core/bake';
import type { Command } from '../core/commands';
import type { SceneObject } from '../core/types';
import { useStore } from '../store';
import { preview } from '../three/shared';
import { createSampler, DEFAULT_APPLY, findClip, listClips, mirrorSample, runLength, sampleClip, type ApplyOptions, type ClipInfo, type ClipSampler } from './library';

export interface ApplyRequest {
  clip: string;
  /** Object ids or names. Default: the selected mannequin, else every mannequin. */
  objects?: string[] | 'selected' | 'all';
  /** Seconds. Default: the playhead. */
  start?: number;
  speed?: number;
  loops?: number;
  keyEvery?: number;
  mirror?: boolean;
  inPlace?: boolean;
  /** Grow the timeline if the clip is longer than the project. Default true. */
  extend?: boolean;
}

export interface ApplyResult {
  clip: string;
  objects: { id: string; name: string }[];
  start: number;
  end: number;
  keysPerChannel: number;
  channels: number;
  extended: boolean;
  duration: number;
}

export function resolveTargets(objects: ApplyRequest['objects']): SceneObject[] {
  const s = useStore.getState();
  const dolls = s.project.objects.filter((o) => o.kind === 'mannequin');
  if (objects === 'all') return dolls;
  if (Array.isArray(objects) && objects.length) {
    return objects.map((ref) => {
      const o = s.project.objects.find((x) => x.id === ref) ?? s.project.objects.find((x) => x.name === ref);
      if (!o) throw new Error(`Object not found: ${ref}`);
      if (o.kind !== 'mannequin') throw new Error(`${o.name} is not a mannequin`);
      return o;
    });
  }
  const sel = dolls.find((o) => o.id === s.selection.object);
  return sel ? [sel] : dolls;
}

function options(req: ApplyRequest, fps: number, playhead: number): ApplyOptions {
  const every = req.keyEvery ?? DEFAULT_APPLY.every;
  if (![1, 2, 3, 5].includes(every) && !(Number.isInteger(every) && every >= 1 && every <= 30)) throw new Error('keyEvery must be an integer 1..30 (frames between keys)');
  const speed = req.speed ?? 1;
  if (!(speed >= 0.05 && speed <= 20)) throw new Error('speed must be between 0.05 and 20');
  const loops = req.loops ?? 1;
  if (!Number.isInteger(loops) || loops < 1 || loops > 50) throw new Error('loops must be an integer 1..50');
  const start = req.start ?? playhead;
  if (!(start >= 0)) throw new Error('start must be >= 0');
  return { fps, start, speed, loops, every, mirror: !!req.mirror, inPlace: !!req.inPlace };
}

/** Bake a library clip onto mannequins as keys: ONE batch command, so one undo step. */
export async function applyClip(req: ApplyRequest, source: 'ui' | 'agent' = 'ui'): Promise<ApplyResult> {
  const list = await listClips();
  const info = findClip(list, req.clip);
  const st = useStore.getState();
  const targets = resolveTargets(req.objects);
  if (!targets.length) throw new Error('No mannequin to apply the animation to');
  const o = options(req, st.project.fps, st.project.time);

  const sampler = await createSampler(info);
  let samples;
  try {
    samples = sampleClip(sampler, info, o);
  } finally {
    sampler.dispose();
  }
  stopPreview();
  const project = useStore.getState().project;
  const commands: Command[] = targets.map((t) => {
    const cur = useStore.getState().project.objects.find((x) => x.id === t.id) ?? t;
    return bakeCommand(project, cur, samples);
  });
  const end = samples[samples.length - 1].t;
  const extend = req.extend !== false && end > project.duration + 1e-3;
  if (extend) commands.unshift({ type: 'timeline_set', duration: Math.min(3600, Math.ceil(end * 100) / 100) });
  const res = useStore.getState().dispatch({ type: 'batch', commands }, { noAutoKey: true, source });
  if (!res.ok) throw new Error(res.error ?? 'Could not apply the animation');
  return {
    clip: info.id,
    objects: targets.map((t) => ({ id: t.id, name: t.name })),
    start: samples[0].t,
    end,
    keysPerChannel: samples.length,
    channels: 18,
    extended: extend,
    duration: useStore.getState().project.duration,
  };
}

// ---------------- preview (plays on one object without touching the project) ----------------

interface AnimUi {
  /** Clip currently previewing in the viewport. */
  previewing: string | null;
  loading: string | null;
}
export const useAnim = create<AnimUi>(() => ({ previewing: null, loading: null }));

let session: { raf: number; sampler: ClipSampler; id: string } | null = null;
let token = 0;

export function stopPreview(): void {
  token++;
  if (session) {
    cancelAnimationFrame(session.raf);
    session.sampler.dispose();
    session = null;
  }
  preview.current = null;
  if (useAnim.getState().previewing || useAnim.getState().loading) useAnim.setState({ previewing: null, loading: null });
}

export async function startPreview(info: ClipInfo, objectId: string, opt: Partial<ApplyOptions> = {}): Promise<void> {
  stopPreview();
  const my = token;
  useAnim.setState({ loading: info.id });
  let sampler: ClipSampler;
  try {
    sampler = await createSampler(info);
  } catch (e) {
    if (my === token) useAnim.setState({ loading: null });
    throw e;
  }
  if (my !== token) return sampler.dispose();
  const speed = opt.speed ?? 1;
  const t0 = performance.now();
  const s = { raf: 0, sampler, id: info.id };
  session = s;
  useAnim.setState({ previewing: info.id, loading: null });
  const tick = () => {
    if (session !== s) return;
    const len = Math.max(0.05, info.duration);
    const t = (((performance.now() - t0) / 1000) * speed) % len;
    let p = sampler.sample(t);
    if (opt.mirror) p = mirrorSample(p);
    if (opt.inPlace) p = { pose: p.pose, hipsPos: [0, p.hipsPos[1], 0] };
    preview.current = { object: objectId, pose: p.pose, hipsPos: p.hipsPos };
    s.raf = requestAnimationFrame(tick);
  };
  tick();
}

export { runLength };
