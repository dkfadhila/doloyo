import { describe, expect, it } from 'vitest';
import { applyCommand, newProject, normalizeProject, type Command } from './commands';
import { ease, eulerToQuat, quatToEuler, sampleTrack } from './interpolate';
import type { Keyframe, Project } from './types';

const key = (t: number, v: [number, number, number], easing: Keyframe['easing'] = 'linear'): Keyframe => ({ t, value: v, easing });
const near = (a: number[], b: number[], eps = 1e-6) => a.forEach((x, i) => expect(Math.abs(x - b[i])).toBeLessThan(eps));

describe('interpolate', () => {
  it('easing endpoints and midpoints', () => {
    for (const e of ['linear', 'easeIn', 'easeOut', 'easeInOut'] as const) {
      expect(ease(e, 0)).toBe(0);
      expect(ease(e, 1)).toBeCloseTo(1);
    }
    expect(ease('easeIn', 0.5)).toBeLessThan(0.5);
    expect(ease('easeOut', 0.5)).toBeGreaterThan(0.5);
    expect(ease('easeInOut', 0.5)).toBeCloseTo(0.5);
    expect(ease('step', 0.99)).toBe(0);
  });

  it('lerps non-rotation channels and holds outside the range', () => {
    const keys = [key(0, [0, 0, 0]), key(2, [4, 8, 0])];
    near(sampleTrack(keys, 1, false)!, [2, 4, 0]);
    near(sampleTrack(keys, -1, false)!, [0, 0, 0]);
    near(sampleTrack(keys, 5, false)!, [4, 8, 0]);
    expect(sampleTrack([], 1, false)).toBeNull();
  });

  it('step holds the start value until the next key', () => {
    const keys = [key(0, [0, 0, 0], 'step'), key(1, [10, 0, 0])];
    near(sampleTrack(keys, 0.99, false)!, [0, 0, 0]);
    near(sampleTrack(keys, 1, false)!, [10, 0, 0]);
  });

  it('slerps rotations through the shortest path', () => {
    const keys = [key(0, [0, 0, 0]), key(1, [0, 0, 90])];
    near(sampleTrack(keys, 0.5, true)!, [0, 0, 45], 1e-4);
  });

  it('euler/quat round trip', () => {
    const e: [number, number, number] = [30, -40, 55];
    near(quatToEuler(eulerToQuat(e)), e, 1e-6);
  });

  it('easing applies to the segment starting at the key', () => {
    const keys = [key(0, [0, 0, 0], 'easeIn'), key(1, [10, 0, 0], 'linear'), key(2, [20, 0, 0])];
    expect(sampleTrack(keys, 0.5, false)![0]).toBeCloseTo(2.5);
    expect(sampleTrack(keys, 1.5, false)![0]).toBeCloseTo(15);
  });
});

describe('commands', () => {
  const id = (p: Project) => p.objects[0].id;
  const roundTrip = (p: Project, c: Command) => {
    const r = applyCommand(p, c);
    const back = applyCommand(r.project, r.inverse as Command);
    expect(back.project).toEqual(p);
    const redo = applyCommand(back.project, r.applied);
    expect(redo.project).toEqual(r.project);
    return r.project;
  };

  it('joint_set clamps to limits and inverts', () => {
    const p = newProject();
    const next = roundTrip(p, { type: 'joint_set', object: id(p), joint: 'L_knee', rotation: [200, 50, 50] });
    expect(next.objects[0].pose.L_knee).toEqual([150, 0, 0]);
  });

  it('object add/remove invert', () => {
    const p = newProject();
    const added = roundTrip(p, { type: 'object_add', kind: 'cube' });
    expect(added.objects).toHaveLength(2);
    roundTrip(added, { type: 'object_remove', object: added.objects[1].id });
  });

  it('pose_apply, mirror and reset invert', () => {
    const p = newProject();
    const posed = roundTrip(p, { type: 'pose_apply', object: id(p), pose: 'wave_up' });
    expect(posed.objects[0].pose.R_shoulder[2]).toBe(-150);
    const mirrored = roundTrip(posed, { type: 'pose_mirror', object: id(p), from: 'R' });
    expect(mirrored.objects[0].pose.L_shoulder[2]).toBe(150);
    roundTrip(mirrored, { type: 'joint_reset', object: id(p) });
    roundTrip(mirrored, { type: 'joint_reset', object: id(p), joint: 'L_shoulder' });
  });

  it('key_add / key_move / key_set_easing / key_remove invert', () => {
    let p = newProject();
    p = applyCommand(p, { type: 'joint_set', object: id(p), joint: 'head', rotation: [0, 30, 0] }).project;
    p = roundTrip(p, { type: 'key_add', object: id(p), target: 'head', time: 0 });
    p = applyCommand(p, { type: 'joint_set', object: id(p), joint: 'head', rotation: [0, 60, 0] }).project;
    p = applyCommand(p, { type: 'key_add', object: id(p), target: 'head', frame: 30 }).project;
    p = applyCommand(p, { type: 'playhead_seek', time: 1 }).project;
    expect(p.objects[0].tracks.head).toHaveLength(2);
    p = roundTrip(p, { type: 'key_set_easing', object: id(p), target: 'head', time: 0, easing: 'easeIn' });
    expect(p.objects[0].tracks.head[0].easing).toBe('easeIn');
    p = roundTrip(p, { type: 'key_move', object: id(p), target: 'head', time: 1, toFrame: 60 });
    expect(p.objects[0].tracks.head[1].t).toBe(2);
    roundTrip(p, { type: 'key_remove', object: id(p), target: 'head', time: 2 });
  });

  it('playhead_seek evaluates keyed channels', () => {
    let p = newProject();
    const o = id(p);
    p = applyCommand(p, { type: 'joint_set', object: o, joint: 'head', rotation: [0, 0, 0] }).project;
    p = applyCommand(p, { type: 'key_add', object: o, target: 'head', time: 0 }).project;
    p = applyCommand(p, { type: 'joint_set', object: o, joint: 'head', rotation: [0, 60, 0] }).project;
    p = applyCommand(p, { type: 'key_add', object: o, target: 'head', time: 1 }).project;
    const r = applyCommand(p, { type: 'playhead_seek', time: 0.5 });
    expect(r.inverse).toBeNull();
    near(r.project.objects[0].pose.head, [0, 30, 0], 1e-4);
  });

  it('batch inverse restores everything; invalid commands throw', () => {
    const p = newProject();
    const o = id(p);
    roundTrip(p, {
      type: 'batch',
      commands: [
        { type: 'joint_set', object: o, joint: 'head', rotation: [10, 0, 0] },
        { type: 'key_add', object: o, target: 'head', time: 0 },
        { type: 'timeline_set', fps: 24, duration: 5, loop: true },
      ],
    });
    expect(() => applyCommand(p, { type: 'joint_set', object: 'nope', joint: 'head', rotation: [0, 0, 0] })).toThrow();
    expect(() => applyCommand(p, { type: 'joint_set', object: o, joint: 'head', position: [0, 0, 0] })).toThrow();
  });
});

describe('pose library', () => {
  const setup = () => {
    let p = newProject();
    const o = p.objects[0].id;
    p = applyCommand(p, { type: 'pose_apply', object: o, pose: 'wave_up' }).project;
    return { p, o };
  };

  it('pose_save stores the current pose and inverts', () => {
    const { p, o } = setup();
    const r = applyCommand(p, { type: 'pose_save', object: o, name: ' Hello ' });
    expect(Object.keys(r.project.customPoses)).toEqual(['Hello']);
    expect(r.project.customPoses.Hello.joints.R_shoulder).toEqual([-10, 0, -150]);
    expect(applyCommand(r.project, r.inverse as Command).project).toEqual(p);
    expect(applyCommand(applyCommand(r.project, r.inverse as Command).project, r.applied).project).toEqual(r.project);
  });

  it('pose_save over an existing name restores the old data on undo', () => {
    const { p, o } = setup();
    const a = applyCommand(p, { type: 'pose_save', object: o, name: 'x' }).project;
    const b = applyCommand(a, { type: 'pose_apply', object: o, pose: 't_pose' }).project;
    const r = applyCommand(b, { type: 'pose_save', object: o, name: 'x' });
    expect(r.project.customPoses.x.joints.L_shoulder).toEqual([0, 0, 90]);
    expect(applyCommand(r.project, r.inverse as Command).project).toEqual(b);
  });

  it('pose_apply accepts custom pose names; pose_delete inverts', () => {
    const { p, o } = setup();
    let s = applyCommand(p, { type: 'pose_save', object: o, name: 'wave2' }).project;
    s = applyCommand(s, { type: 'joint_reset', object: o }).project;
    expect(s.objects[0].pose.R_shoulder).toEqual([0, 0, 0]);
    s = applyCommand(s, { type: 'pose_apply', object: o, pose: 'wave2' }).project;
    expect(s.objects[0].pose.R_shoulder).toEqual([-10, 0, -150]);
    const d = applyCommand(s, { type: 'pose_delete', name: 'wave2' });
    expect(d.project.customPoses).toEqual({});
    expect(applyCommand(d.project, d.inverse as Command).project).toEqual(s);
    expect(() => applyCommand(d.project, { type: 'pose_apply', object: o, pose: 'wave2' })).toThrow(/Unknown pose/);
  });

  it('rejects bad names and non-mannequins', () => {
    const { p, o } = setup();
    expect(() => applyCommand(p, { type: 'pose_save', object: o, name: '  ' })).toThrow();
    expect(() => applyCommand(p, { type: 'pose_save', object: o, name: 'stand' })).toThrow(/built-in/);
    expect(() => applyCommand(p, { type: 'pose_delete', name: 'nope' })).toThrow();
    const c = applyCommand(p, { type: 'object_add', kind: 'cube' }).project;
    expect(() => applyCommand(c, { type: 'pose_save', object: c.objects[1].id, name: 'q' })).toThrow(/not a mannequin/);
  });

  it('normalizeProject fills customPoses for old files', () => {
    const old = JSON.parse(JSON.stringify(newProject()));
    delete old.customPoses;
    expect(normalizeProject(old).customPoses).toEqual({});
  });
});
