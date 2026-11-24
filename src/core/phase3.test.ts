import { describe, expect, it } from 'vitest';
import { applyCommand, copyKeys, formation, newProject, normalizeProject, SCENE_PRESETS, type Command } from './commands';
import { cubicBezier, ease, easingToBezier, evaluateObject, evaluateProject, parseEasing, sampleTrack } from './interpolate';
import type { Keyframe, Project, SceneObject, Vec3 } from './types';

const key = (t: number, v: Vec3, easing: Keyframe['easing'] = 'linear'): Keyframe => ({ t, value: v, easing });
const run = (p: Project, c: Command) => applyCommand(p, c).project;
const near = (a: number[], b: number[], eps = 1e-6) => a.forEach((x, i) => expect(Math.abs(x - b[i])).toBeLessThan(eps));

function roundTrip(p: Project, c: Command): Project {
  const r = applyCommand(p, c);
  expect(applyCommand(r.project, r.inverse as Command).project).toEqual(p);
  expect(applyCommand(p, r.applied).project).toEqual(r.project);
  return r.project;
}

describe('bezier easing', () => {
  it('matches CSS cubic-bezier reference values', () => {
    expect(cubicBezier(0, 0, 1, 1, 0.37)).toBeCloseTo(0.37, 5); // linear
    expect(cubicBezier(0.42, 0, 0.58, 1, 0.5)).toBeCloseTo(0.5, 5);
    expect(cubicBezier(0.25, 0.1, 0.25, 1, 0.5)).toBeCloseTo(0.8024, 3); // CSS "ease"
    expect(cubicBezier(0.42, 0, 1, 1, 0.5)).toBeCloseTo(0.3153, 3); // CSS "ease-in"
    expect(cubicBezier(0.1, 0.9, 0.2, 1, 0)).toBe(0);
    expect(cubicBezier(0.1, 0.9, 0.2, 1, 1)).toBe(1);
  });

  it('is monotonic in time for valid x handles and can overshoot with y > 1', () => {
    let prev = -1;
    for (let u = 0; u <= 1; u += 0.05) {
      const y = cubicBezier(0.3, 0, 0.7, 1, u);
      expect(y).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = y;
    }
    expect(cubicBezier(0.3, 0, 0.7, 1.6, 0.8)).toBeGreaterThan(1);
  });

  it('ease() accepts bezier objects; named easings have bezier presets', () => {
    expect(ease({ type: 'bezier', c: [0, 0, 1, 1] }, 0.3)).toBeCloseTo(0.3, 5);
    expect(easingToBezier('easeInOut')).toEqual([0.42, 0, 0.58, 1]);
    expect(easingToBezier('step')).toBeNull();
    expect(easingToBezier({ type: 'bezier', c: [0.1, 0.2, 0.3, 0.4] })).toEqual([0.1, 0.2, 0.3, 0.4]);
    // the preset curves resemble the named easings
    for (const u of [0.25, 0.5, 0.75]) {
      expect(Math.abs(ease({ type: 'bezier', c: easingToBezier('easeInOut')! }, u) - ease('easeInOut', u))).toBeLessThan(0.08);
    }
  });

  it('shapes a segment: sampleTrack uses the easing of the segment leaving a key; overshoot passes through', () => {
    const keys = [key(0, [0, 0, 0], { type: 'bezier', c: [0.2, 0, 0.2, 1.8] }), key(1, [10, 0, 0])];
    const mid = sampleTrack(keys, 0.7, false)![0];
    expect(mid).toBeGreaterThan(10); // overshoot beyond the end key
    near(sampleTrack(keys, 1, false)!, [10, 0, 0]);
    near(sampleTrack(keys, 0, false)!, [0, 0, 0]);
    const slow = [key(0, [0, 0, 0], { type: 'bezier', c: [0.9, 0, 1, 0.3] }), key(1, [10, 0, 0])];
    expect(sampleTrack(slow, 0.5, false)![0]).toBeLessThan(2);
    // rotation channels slerp with the eased parameter
    const rot = [key(0, [0, 0, 0], { type: 'bezier', c: [0.9, 0, 1, 0.3] }), key(1, [0, 0, 90])];
    expect(sampleTrack(rot, 0.5, true)![2]).toBeLessThan(20);
  });

  it('parseEasing validates', () => {
    expect(parseEasing('easeIn')).toBe('easeIn');
    expect(parseEasing({ type: 'bezier', c: [0.1, 0, 0.9, 1] })).toEqual({ type: 'bezier', c: [0.1, 0, 0.9, 1] });
    expect(parseEasing({ type: 'bezier', c: [1.5, 0, 0.9, 1] })).toBeNull();
    expect(parseEasing({ type: 'bezier', c: [0.1, 0, 0.9] })).toBeNull();
    expect(parseEasing('wobble')).toBeNull();
    expect(parseEasing(null)).toBeNull();
  });

  it('key_set_easing / key_add accept bezier and undo; bad curves throw', () => {
    let p = newProject();
    const id = p.objects[0].id;
    p = run(p, { type: 'key_add', object: id, target: 'head', time: 0 });
    p = run(p, { type: 'joint_set', object: id, joint: 'head', rotation: [0, 40, 0] });
    p = run(p, { type: 'key_add', object: id, target: 'head', time: 1, easing: { type: 'bezier', c: [0.1, 0.2, 0.3, 0.4] } });
    p = run(p, { type: 'playhead_seek', time: 0 });
    expect(p.objects[0].tracks.head[1].easing).toEqual({ type: 'bezier', c: [0.1, 0.2, 0.3, 0.4] });
    p = roundTrip(p, { type: 'key_set_easing', object: id, target: 'head', time: 0, easing: { type: 'bezier', c: [0.5, 0, 0.5, 1.2] } });
    expect(p.objects[0].tracks.head[0].easing).toEqual({ type: 'bezier', c: [0.5, 0, 0.5, 1.2] });
    expect(() => run(p, { type: 'key_set_easing', object: id, target: 'head', time: 0, easing: { type: 'bezier', c: [2, 0, 0.5, 1] } })).toThrow(/easing/);
    expect(() => run(p, { type: 'key_set_easing', object: id, target: 'head', time: 0, easing: 'bounce' as never })).toThrow(/easing/);
  });

  it('project files keep bezier easing and sanitize junk', () => {
    const p0 = newProject();
    const id = p0.objects[0].id;
    let p = run(p0, { type: 'key_add', object: id, target: 'head', time: 0, easing: { type: 'bezier', c: [0.1, 0, 0.9, 1] } });
    const back = normalizeProject(JSON.parse(JSON.stringify(p)));
    expect(back.objects[0].tracks.head[0].easing).toEqual({ type: 'bezier', c: [0.1, 0, 0.9, 1] });
    const junk = JSON.parse(JSON.stringify(p));
    junk.objects[0].tracks.head[0].easing = { type: 'bezier', c: ['x'] };
    expect(normalizeProject(junk).objects[0].tracks.head[0].easing).toBe('linear');
    p = back;
    expect(p.objects[0].pins).toEqual({});
  });
});

describe('multi-key editing', () => {
  const setup = () => {
    let p = newProject();
    const id = p.objects[0].id;
    p = run(p, { type: 'timeline_set', fps: 10, duration: 5 });
    p = run(p, { type: 'joint_set', object: id, joint: 'head', rotation: [0, 10, 0] });
    p = run(p, { type: 'key_add', object: id, target: ['head', 'position'], time: 0 });
    p = run(p, { type: 'joint_set', object: id, joint: 'head', rotation: [0, 20, 0] });
    p = run(p, { type: 'object_transform', object: id, position: [1, 0, 0] });
    p = run(p, { type: 'key_add', object: id, target: ['head', 'position'], time: 1 });
    p = run(p, { type: 'joint_set', object: id, joint: 'head', rotation: [0, 30, 0] });
    p = run(p, { type: 'object_transform', object: id, position: [2, 0, 0] });
    p = run(p, { type: 'key_add', object: id, target: ['head', 'position'], time: 2 });
    p = run(p, { type: 'playhead_seek', time: 0 });
    return { p, id };
  };

  it('keys_edit moves several keys at once (later ones first), single undo', () => {
    const { p, id } = setup();
    const moved = roundTrip(p, {
      type: 'keys_edit',
      edits: [
        { object: id, target: 'head', time: 1, to: 1.5 },
        { object: id, target: 'head', time: 2, to: 2.5 },
        { object: id, target: 'position', time: 1, to: 1.5 },
      ],
    });
    expect(moved.objects[0].tracks.head.map((k) => k.t)).toEqual([0, 1.5, 2.5]);
    expect(moved.objects[0].tracks.position.map((k) => k.t)).toEqual([0, 1.5, 2]);
  });

  it('keys_edit shifting a selection over a neighbour replaces the neighbour only if it is not selected', () => {
    const { p, id } = setup();
    // move keys at 1 and 2 left by 1: key at 1 lands on 0 (replaces the unselected key at 0), key at 2 lands on 1
    const r = run(p, { type: 'keys_edit', edits: [{ object: id, target: 'head', time: 1, to: 0 }, { object: id, target: 'head', time: 2, to: 1 }] });
    const head = r.objects[0].tracks.head;
    expect(head.map((k) => k.t)).toEqual([0, 1]);
    expect(head[0].value[1]).toBe(20);
    expect(head[1].value[1]).toBe(30);
  });

  it('keys_edit sets values and the "all" target covers every channel at that time', () => {
    const { p, id } = setup();
    const v = run(p, { type: 'keys_edit', edits: [{ object: id, target: 'head', time: 1, value: [5, 6, 7] }] });
    expect(v.objects[0].tracks.head[1].value).toEqual([5, 6, 7]);
    const all = run(p, { type: 'keys_edit', edits: [{ object: id, target: 'all', time: 2, toFrame: 40 }] });
    expect(all.objects[0].tracks.head[2].t).toBe(4);
    expect(all.objects[0].tracks.position[2].t).toBe(4);
    expect(() => run(p, { type: 'keys_edit', edits: [{ object: id, target: 'head', time: 3.3, to: 1 }] })).toThrow(/No key/);
    expect(() => run(p, { type: 'keys_edit', edits: [] })).toThrow();
  });

  it('keys_remove removes many keys in one step', () => {
    const { p, id } = setup();
    const r = roundTrip(p, { type: 'keys_remove', keys: [{ object: id, target: 'head', time: 0 }, { object: id, target: 'all', time: 2 }] });
    expect(r.objects[0].tracks.head.map((k) => k.t)).toEqual([1]);
    expect(r.objects[0].tracks.position.map((k) => k.t)).toEqual([0, 1]);
  });

  it('copy / paste keys at the playhead, relative timing and easing preserved, single undo', () => {
    const { p, id } = setup();
    const withEase = run(p, { type: 'key_set_easing', object: id, target: 'head', time: 1, easing: 'easeIn' });
    const { kind, clip } = copyKeys(withEase, [{ object: id, target: 'head', time: 1 }, { object: id, target: 'head', time: 2 }]);
    expect(kind).toBe('mannequin');
    expect(clip.map((c) => [c.channel, c.dt])).toEqual([['head', 0], ['head', 1]]);
    const at = run(withEase, { type: 'playhead_seek', time: 3 });
    const pasted = roundTrip(at, { type: 'keys_paste', object: id, kind, clip });
    const head = pasted.objects[0].tracks.head;
    expect(head.map((k) => k.t)).toEqual([0, 1, 2, 3, 4]);
    expect(head[3].easing).toBe('easeIn');
    expect(head[3].value).toEqual([0, 20, 0]);
    expect(head[4].value).toEqual([0, 30, 0]);
  });

  it('paste across objects of the same kind; other kinds are rejected; unknown channels are skipped', () => {
    const { p, id } = setup();
    let q = run(p, { type: 'object_add', kind: 'mannequin' });
    const other = q.objects[1].id;
    const { kind, clip } = copyKeys(q, [{ object: id, target: 'all', time: 1 }]);
    q = run(q, { type: 'playhead_seek', time: 2 });
    const pasted = run(q, { type: 'keys_paste', object: other, kind, clip });
    expect(pasted.objects[1].tracks.head[0].t).toBe(2);
    expect(pasted.objects[1].tracks.position[0].value).toEqual([1, 0, 0]);
    q = run(q, { type: 'object_add', kind: 'cube' });
    const cube = q.objects[2].id;
    expect(() => run(q, { type: 'keys_paste', object: cube, kind, clip })).toThrow(/Cannot paste/);
    // a cube clip onto a sphere only has position/rotation/scale: fine; joint channels on a shape without kind: skipped
    const shapeOnly = run(q, { type: 'keys_paste', object: cube, clip: [{ channel: 'head', dt: 0, value: [0, 0, 0], easing: 'linear' }, { channel: 'position', dt: 0, value: [1, 1, 1], easing: 'linear' }] });
    expect(Object.keys(shapeOnly.objects[2].tracks)).toEqual(['position']);
    expect(() => run(q, { type: 'keys_paste', object: cube, clip: [{ channel: 'head', dt: 0, value: [0, 0, 0], easing: 'linear' }] })).toThrow(/None of/);
    expect(() => copyKeys(p, [])).toThrow();
  });
});

describe('render camera', () => {
  const addCam = (p: Project) => run(p, { type: 'object_add', kind: 'camera' });

  it('object_add camera: default look-at, one camera only, inverts', () => {
    const p = roundTrip(newProject(), { type: 'object_add', kind: 'camera' });
    const cam = p.objects.find((o) => o.kind === 'camera') as SceneObject;
    expect(cam.name).toBe('Render Camera');
    expect(cam.fov).toBe(40);
    expect(cam.target).toEqual([0, 0.9, 0]);
    expect(() => addCam(p)).toThrow(/already/);
  });

  it('camera_set creates the camera when missing, then edits it; both undo', () => {
    const p0 = newProject();
    const created = roundTrip(p0, { type: 'camera_set', position: [3, 2, 5], target: [0, 1, 0], fov: 30 });
    const cam = created.objects.find((o) => o.kind === 'camera') as SceneObject;
    expect(cam.position).toEqual([3, 2, 5]);
    expect(cam.target).toEqual([0, 1, 0]);
    expect(cam.fov).toBe(30);
    const edited = roundTrip(created, { type: 'camera_set', fov: 55 });
    expect(edited.objects.find((o) => o.kind === 'camera')!.fov).toBe(55);
    expect(() => run(created, { type: 'camera_set', fov: 0 })).toThrow(/fov/);
    expect(() => run(created, { type: 'camera_set', position: [0, 0] as never })).toThrow(/position/);
    expect(() => run(created, { type: 'camera_set', object: created.objects[0].id, fov: 40 })).toThrow(/not a camera/);
  });

  it('camera keys (position, target, fov) are sampled over time', () => {
    let p = run(newProject(), { type: 'camera_set', position: [0, 1, 5], target: [0, 1, 0], fov: 30 });
    p = run(p, { type: 'timeline_set', fps: 10, duration: 2 });
    const id = p.objects.find((o) => o.kind === 'camera')!.id;
    p = run(p, { type: 'key_add', object: id, time: 0 });
    p = run(p, { type: 'camera_set', position: [4, 1, 5], target: [1, 1, 0], fov: 60 });
    p = run(p, { type: 'key_add', object: id, time: 2 });
    expect(Object.keys(p.objects.find((o) => o.id === id)!.tracks).sort()).toEqual(['fov', 'position', 'target']);
    const mid = evaluateObject(p.objects.find((o) => o.id === id)!, 1);
    near(mid.position, [2, 1, 5]);
    near(mid.target, [0.5, 1, 0]);
    expect(mid.fov).toBeCloseTo(45, 6);
    const ev = evaluateProject({ ...p, time: 0.5 }, 0.5).objects.find((o) => o.id === id)!;
    expect(ev.fov).toBeCloseTo(37.5, 6);
    // easing shapes camera moves too
    const eased = run(p, { type: 'key_set_easing', object: id, target: 'fov', time: 0, easing: 'step' });
    expect(evaluateObject(eased.objects.find((o) => o.id === id)!, 1).fov).toBe(30);
    // playhead_seek evaluates the camera
    expect(run(p, { type: 'playhead_seek', time: 2 }).objects.find((o) => o.id === id)!.fov).toBe(60);
  });

  it('a camera only has position/target/fov channels', () => {
    const p = run(newProject(), { type: 'camera_set', fov: 50 });
    const id = p.objects.find((o) => o.kind === 'camera')!.id;
    expect(() => run(p, { type: 'key_add', object: id, target: 'rotation' })).toThrow(/Unknown channel/);
    expect(() => run(p, { type: 'joint_set', object: id, joint: 'head', rotation: [0, 0, 0] })).toThrow(/not a mannequin/);
  });
});

describe('scene_preset', () => {
  it('adds the formation as ONE undo step and inverts exactly', () => {
    for (const preset of ['duo', 'trio', 'group5'] as const) {
      const p0 = newProject();
      const r = applyCommand(p0, { type: 'scene_preset', preset });
      expect(r.project.objects).toHaveLength(1 + SCENE_PRESETS[preset].count);
      expect(applyCommand(r.project, r.inverse as Command).project).toEqual(p0);
      expect(applyCommand(p0, r.applied).project).toEqual(r.project); // replay is deterministic (ids fixed)
    }
  });

  it('arranges an arc: centered, symmetric, ends toward the audience and turned inward; uses the chosen character', () => {
    const p = run(newProject(), { type: 'scene_preset', preset: 'group5', character: 'doll-procedural', clear: true });
    expect(p.objects).toHaveLength(5);
    expect(p.objects.every((o) => o.character === 'doll-procedural' && o.kind === 'mannequin')).toBe(true);
    const xs = p.objects.map((o) => o.position[0]);
    expect(xs.reduce((a, b) => a + b, 0)).toBeCloseTo(0, 3);
    expect(xs).toEqual([...xs].sort((a, b) => a - b));
    const [first, , mid, , last] = p.objects;
    expect(mid.position[0]).toBeCloseTo(0, 6);
    expect(mid.rotation[1]).toBeCloseTo(0, 6);
    expect(first.position[2]).toBeGreaterThan(mid.position[2]);
    expect(first.position[2]).toBeCloseTo(last.position[2], 3);
    expect(first.rotation[1]).toBeGreaterThan(0); // left doll turns toward the center (+X)
    expect(last.rotation[1]).toBeLessThan(0);
    expect(new Set(p.objects.map((o) => o.name)).size).toBe(5);
    const f = formation('duo');
    expect(f[0].position[0]).toBeCloseTo(-f[1].position[0], 6);
  });

  it('clear removes the existing mannequins (undo restores them) and keeps other objects', () => {
    let p = run(newProject(), { type: 'object_add', kind: 'cube' });
    const r = applyCommand(p, { type: 'scene_preset', preset: 'duo', clear: true });
    expect(r.project.objects.filter((o) => o.kind === 'mannequin')).toHaveLength(2);
    expect(r.project.objects.filter((o) => o.kind === 'cube')).toHaveLength(1);
    expect(applyCommand(r.project, r.inverse as Command).project).toEqual(p);
    p = r.project;
  });

  it('rejects unknown presets and characters', () => {
    expect(() => run(newProject(), { type: 'scene_preset', preset: 'army' as never })).toThrow(/preset/);
    expect(() => run(newProject(), { type: 'scene_preset', preset: 'duo', character: 'nobody' })).toThrow(/character/i);
  });
});
