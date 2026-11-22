import { bakeCommand, thin } from '../core/bake';
import { createObject, uid, type Command } from '../core/commands';
import type { SceneObject } from '../core/types';
import { useStore } from '../store';
import { analyzeVideo, type VideoAnalysis } from './analyze';
import { DEFAULT_CONVERT, trackToSamples, type ConvertOptions } from './convert';

export interface Assignment {
  track: number;
  /** Object id/name, or "new" to create a doll. */
  object: string;
}

export interface ApplyTracksOptions extends Partial<Omit<ConvertOptions, 'fps'>> {
  keyEvery?: number;
  extend?: boolean;
}

export interface ApplyTracksResult {
  assigned: { track: number; object: string; id: string; created: boolean; keysPerChannel: number }[];
  start: number;
  end: number;
  extended: boolean;
}

/** Tracks summary for UI and agents. */
export function summarize(a: VideoAnalysis) {
  return {
    video: { width: a.video.width, height: a.video.height, duration: Math.round(a.video.duration * 100) / 100, fps: a.video.fps, frames: a.video.frames },
    delegate: a.delegate,
    tracks: a.tracks.map((t) => ({
      track: t.id,
      frames: t.frames.size,
      from: Math.round((t.first / a.video.fps) * 100) / 100,
      to: Math.round((t.last / a.video.fps) * 100) / 100,
    })),
  };
}

/** Default assignment: biggest track -> selected/first mannequin, further tracks -> new dolls. */
export function defaultAssignments(a: VideoAnalysis, max = 4): Assignment[] {
  const st = useStore.getState();
  const dolls = st.project.objects.filter((o) => o.kind === 'mannequin');
  const first = dolls.find((o) => o.id === st.selection.object) ?? dolls[0];
  return a.tracks.slice(0, max).map((t, i) => ({ track: t.id, object: i === 0 && first ? first.id : 'new' }));
}

/** Bake the assigned tracks as keys: ONE batch (new dolls + keys + timeline extension), so one undo step. */
export function applyTracks(a: VideoAnalysis, assign: Assignment[], o: ApplyTracksOptions = {}, source: 'ui' | 'agent' = 'ui'): ApplyTracksResult {
  if (!assign.length) throw new Error('Nothing assigned');
  const st = useStore.getState();
  const project = st.project;
  const fps = a.video.fps;
  const conv: ConvertOptions = { ...DEFAULT_CONVERT, ...o, fps, start: o.start ?? project.time };
  const picked = assign.map((s) => {
    const track = a.tracks.find((t) => t.id === s.track);
    if (!track) throw new Error(`Unknown track ${s.track} (tracks: ${a.tracks.map((t) => t.id).join(', ') || 'none'})`);
    return { s, track };
  });
  const used = new Set<string>();
  conv.originFrame = Math.min(...picked.map((p) => p.track.first));

  const commands: Command[] = [];
  const out: ApplyTracksResult['assigned'] = [];
  let end = 0;
  for (const { s, track } of picked) {
    let obj: SceneObject;
    let created = false;
    if (s.object === 'new') {
      const idx = project.objects.length + commands.filter((c) => c.type === 'object_add').length;
      const slot = Math.ceil(idx / 2) * 0.9 * (idx % 2 ? 1 : -1);
      const id = uid();
      const name = `Dancer ${track.id}`;
      obj = createObject('mannequin', name, id, [slot, 0, 0]);
      commands.push({ type: 'object_add', kind: 'mannequin', id, name, position: [slot, 0, 0] });
      created = true;
    } else {
      const f = project.objects.find((x) => x.id === s.object) ?? project.objects.find((x) => x.name === s.object);
      if (!f) throw new Error(`Object not found: ${s.object}`);
      if (f.kind !== 'mannequin') throw new Error(`${f.name} is not a mannequin`);
      obj = f;
    }
    if (used.has(obj.id)) throw new Error(`${obj.name} is assigned to more than one track`);
    used.add(obj.id);
    const samples = trackToSamples(track, a.video, conv);
    if (!samples.length) throw new Error(`Track ${track.id} has no usable frames`);
    const kept = thin(samples, o.keyEvery ?? 1);
    commands.push(bakeCommand(project, obj, kept));
    end = Math.max(end, kept[kept.length - 1].t);
    out.push({ track: track.id, object: obj.name, id: obj.id, created, keysPerChannel: kept.length });
  }
  const extend = o.extend !== false && end > project.duration + 1e-3;
  if (extend) commands.unshift({ type: 'timeline_set', duration: Math.min(3600, Math.ceil(end * 100) / 100) });
  const res = st.dispatch({ type: 'batch', commands }, { noAutoKey: true, source });
  if (!res.ok) throw new Error(res.error ?? 'Could not apply the capture');
  return { assigned: out, start: conv.start, end, extended: extend };
}

/** Headless path used by the agent: bytes -> hidden video -> analysis -> keys. */
export async function runMocapFromBlob(
  blob: Blob,
  p: { maxPeople?: number; fps?: number; assign?: Assignment[] } & ApplyTracksOptions,
  signal?: AbortSignal,
  onProgress?: (d: number, t: number) => void,
) {
  const url = URL.createObjectURL(blob);
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.preload = 'auto';
  video.src = url;
  try {
    const fps = p.fps ?? useStore.getState().project.fps;
    const a = await analyzeVideo(video, { maxPeople: Math.min(4, Math.max(1, p.maxPeople ?? 1)), fps, signal, onProgress: (d, t) => onProgress?.(d, t) });
    if (!a.tracks.length) throw new Error('No person was detected in the video. Use a steady camera with the whole body visible and good lighting.');
    const assign = p.assign?.length ? p.assign : defaultAssignments(a, Math.min(4, Math.max(1, p.maxPeople ?? 1)));
    const applied = applyTracks(a, assign, p, 'agent');
    return { ...summarize(a), applied };
  } finally {
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(url);
  }
}
