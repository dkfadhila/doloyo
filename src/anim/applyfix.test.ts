import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { describe, expect, it } from 'vitest';
import { bakeCommand, type BakeSample } from '../core/bake';
import { applyCommand, newProject, type Command } from '../core/commands';
import { emptyPose } from '../core/rig';
import { QUATERNIUS_BONES, QUATERNIUS_CALIBRATION } from '../characters/registry';
import { Retargeter } from '../retarget/skeletal';
import { ClipSampler, DEFAULT_APPLY, sampleClip, type ClipInfo } from './library';
import type { Project } from '../core/types';
import { useStore } from '../store';

const run = (p: Project, c: Command) => applyCommand(p, c).project;
const doll = (p: Project, i = 0) => p.objects.filter((o) => o.kind === 'mannequin')[i];

function twoDolls(): Project {
  let p = newProject();
  while (p.objects.filter((o) => o.kind === 'mannequin').length < 2) p = run(p, { type: 'object_add', kind: 'mannequin' });
  return p;
}

describe('key_add keys the pose that was just applied', () => {
  it('pose_apply then key_add (all) stores the applied pose even when other objects are edited in between', () => {
    let p = twoDolls();
    const a = doll(p).id;
    p = run(p, { type: 'pose_apply', object: a, pose: 'wave_up' });
    p = run(p, { type: 'key_add', object: a, frame: 0, target: 'all' });
    p = run(p, { type: 'pose_apply', object: a, pose: 'stand' });
    p = run(p, { type: 'key_add', object: a, frame: 30, target: 'all' });
    p = run(p, { type: 'playhead_seek', frame: 0 });
    // new pose at the playhead, then edits on ANOTHER object (these used to re-sample every object)
    p = run(p, { type: 'pose_apply', object: a, pose: 'crouch' });
    const applied = JSON.parse(JSON.stringify(doll(p).pose));
    const b = doll(p, 1).id;
    p = run(p, { type: 'pose_apply', object: b, pose: 'stand' });
    p = run(p, { type: 'key_add', object: b, frame: 0, target: 'all' });
    p = run(p, { type: 'key_move', object: b, time: 0, to: 0.5 });
    p = run(p, { type: 'timeline_set', duration: 4 });
    p = run(p, { type: 'track_restore', object: b, channel: 'head', keys: [] });
    expect(doll(p).pose).toEqual(applied);
    p = run(p, { type: 'key_add', object: a, target: 'all' });
    const o = doll(p);
    for (const [j, v] of Object.entries(applied)) expect(o.tracks[j].find((k) => k.t === 0)!.value).toEqual(v);
  });

  it('an agent edit stops playback so the next frame cannot overwrite the pose', () => {
    const st = useStore.getState();
    st.setProject(twoDolls());
    const a = doll(useStore.getState().project).id;
    st.dispatch({ type: 'key_add', object: a, frame: 0, target: 'all' });
    useStore.setState({ playing: true });
    st.dispatch({ type: 'playhead_seek', frame: 0 }, { source: 'agent' });
    expect(useStore.getState().playing).toBe(true); // seeking is not an edit
    st.dispatch({ type: 'pose_apply', object: a, pose: 'wave_up' }, { noAutoKey: true, source: 'agent' });
    expect(useStore.getState().playing).toBe(false);
    st.tick(0.2); // a playback frame after the edit does nothing
    const shown = doll(useStore.getState().project).pose;
    expect(shown.R_shoulder).not.toEqual(emptyPose().R_shoulder);
    st.dispatch({ type: 'key_add', object: a, target: 'all', frame: 0 }, { noAutoKey: true, source: 'agent' });
    expect(doll(useStore.getState().project).tracks.R_shoulder[0].value).toEqual(shown.R_shoulder);
  });
});

const sample = (t: number, x: number): BakeSample => {
  const pose = emptyPose();
  pose.head = [x, 0, 0];
  return { t, pose, hipsPos: [0, 0, 0] };
};
const samples = (from: number, to: number, x: number) => Array.from({ length: to - from + 1 }, (_, i) => sample(from + i, x));

describe('bakeCommand: a later clip supersedes an earlier run', () => {
  it('replaces the overlap and the tail of the earlier run; keeps hand keys and the head of the earlier run', () => {
    let p = twoDolls();
    const id = doll(p).id;
    p = run(p, { type: 'key_add', object: id, time: 20, target: 'head' }); // hand key (no run tag)
    p = run(p, bakeCommand(p, doll(p), samples(0, 10, 10), { run: 'idle' }));
    p = run(p, bakeCommand(p, doll(p), samples(4, 6, 99), { run: 'death' }));
    const keys = doll(p).tracks.head;
    expect(keys.filter((k) => k.run === 'idle').map((k) => k.t)).toEqual([0, 1, 2, 3]);
    expect(keys.filter((k) => k.run === 'death').map((k) => k.t)).toEqual([4, 5, 6]);
    expect(keys.some((k) => k.t === 20 && !k.run)).toBe(true);
    for (let i = 1; i < keys.length; i++) expect(keys[i].t).toBeGreaterThan(keys[i - 1].t);
  });

  it('a non-overlapping later clip leaves the earlier run alone; undo restores everything', () => {
    let p = twoDolls();
    p = run(p, bakeCommand(p, doll(p), samples(0, 3, 1), { run: 'a' }));
    const before = JSON.stringify(doll(p).tracks);
    const r = applyCommand(p, bakeCommand(p, doll(p), samples(10, 12, 2), { run: 'b' }));
    expect(doll(r.project).tracks.head.filter((k) => k.run === 'a').length).toBe(4);
    expect(JSON.stringify(doll(applyCommand(r.project, r.inverse!).project).tracks)).toBe(before);
  });

  it('undo of a superseding clip brings the earlier tail back', () => {
    let p = twoDolls();
    p = run(p, bakeCommand(p, doll(p), samples(0, 10, 1), { run: 'a' }));
    const before = JSON.stringify(doll(p).tracks);
    const r = applyCommand(p, bakeCommand(p, doll(p), samples(4, 6, 2), { run: 'b' }));
    expect(doll(r.project).tracks.head.some((k) => k.t === 9)).toBe(false);
    expect(JSON.stringify(doll(applyCommand(r.project, r.inverse!).project).tracks)).toBe(before);
  });
});

const load = (file: string) => {
  const b = readFileSync(resolve(__dirname, '../../public/assets', file));
  const ab = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
  return new Promise<GLTF>((res, rej) => new GLTFLoader().parse(ab, '', res, rej));
};

describe('sampleClip duration', () => {
  it('trims a looped clip to the requested seconds', async () => {
    const g = await load('anims/ual1.glb');
    const clip = g.animations.find((c) => /Idle_Loop/.test(c.name)) ?? g.animations[0];
    const info: ClipInfo = { id: `ual1/${clip.name}`, file: 'ual1', name: clip.name, duration: clip.duration };
    const s = new ClipSampler(new Retargeter(clone(g.scene), QUATERNIUS_BONES, QUATERNIUS_CALIBRATION), clip);
    const full = sampleClip(s, info, { ...DEFAULT_APPLY, start: 1, fps: 30, loops: 5 });
    expect(full[full.length - 1].t).toBeCloseTo(1 + Math.round(clip.duration * 5 * 30) / 30);
    const cut = sampleClip(s, info, { ...DEFAULT_APPLY, start: 1, fps: 30, loops: 5, duration: 1.5 });
    expect(cut[0].t).toBeCloseTo(1);
    expect(cut[cut.length - 1].t).toBeCloseTo(2.5);
    expect(cut.length).toBe(46);
    const long = sampleClip(s, info, { ...DEFAULT_APPLY, start: 1, fps: 30, loops: 5, duration: 999 });
    expect(long.length).toBe(full.length);
  });
});
