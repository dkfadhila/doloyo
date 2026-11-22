import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { applyCommand, newProject, type Command } from './commands';
import { applyPins, clampJoints, endWorld, fk, jointWorld, LIMB_JOINTS, poleAngleOf, solveLimb, worldToLocal } from './ik';
import { evaluateObject } from './interpolate';
import { clampRotation, emptyPose, RIG_BY_NAME } from './rig';
import type { JointName, Limb, Pose, SceneObject, Vec3 } from './types';
import { LIMBS } from './types';

const mannequin = (): SceneObject => newProject().objects[0];
const v = (a: Vec3) => new Vector3(...a);
const dist = (a: Vec3, b: Vec3) => v(a).distanceTo(v(b));
const lens = (limb: Limb) => {
  const [, j1, j2] = LIMB_JOINTS[limb];
  return [new Vector3(...RIG_BY_NAME[j1].offset).length(), new Vector3(...RIG_BY_NAME[j2].offset).length()];
};

function poseWith(joints: Partial<Record<JointName, Vec3>>): Pose {
  return { ...emptyPose(), ...joints };
}

describe('fk', () => {
  it('rest pose: wrists hang 0.55 m below the shoulders, feet near the floor', () => {
    const o = mannequin();
    const sh = jointWorld(o, 'L_shoulder');
    const wr = jointWorld(o, 'L_wrist');
    expect(sh[1] - wr[1]).toBeCloseTo(0.55, 6);
    expect(jointWorld(o, 'L_ankle')[1]).toBeCloseTo(0.95 - 0.05 - 0.42 - 0.4, 6);
  });
});

describe('solveLimb', () => {
  for (const limb of LIMBS) {
    it(`${limb}: reachable targets land within 1 mm`, () => {
      const o = mannequin();
      const [j0] = LIMB_JOINTS[limb];
      const shoulder = fk(o.pose, o.hipsPos)[j0].p;
      const [l1, l2] = lens(limb);
      let worst = 0;
      let n = 0;
      // grid of directions and distances inside the reachable shell
      for (let az = -170; az <= 170; az += 35) {
        for (let el = -80; el <= 80; el += 40) {
          for (const frac of [0.3, 0.6, 0.95]) {
            const d = (Math.abs(l1 - l2) + 0.02 + frac * (l1 + l2 - Math.abs(l1 - l2) - 0.02)) * 0.999;
            const dir = new Vector3(Math.sin(az * 0.01745) * Math.cos(el * 0.01745), Math.sin(el * 0.01745), Math.cos(az * 0.01745) * Math.cos(el * 0.01745));
            const target = shoulder.clone().add(dir.multiplyScalar(d));
            const r = solveLimb(o.pose, o.hipsPos, limb, target);
            // verify through the rig's own FK, not just the solver's internal estimate
            const pose = { ...o.pose, ...r.joints };
            const end = fk(pose, o.hipsPos)[LIMB_JOINTS[limb][2]].p;
            worst = Math.max(worst, end.distanceTo(target));
            n++;
          }
        }
      }
      expect(n).toBeGreaterThan(50);
      expect(worst).toBeLessThan(1e-3);
    });
  }

  it('unreachable target: fully extended toward the target', () => {
    const o = mannequin();
    const [l1, l2] = lens('L_arm');
    const shoulder = fk(o.pose, o.hipsPos).L_shoulder.p;
    const target = shoulder.clone().add(new Vector3(0.3, 0.4, 0.5).normalize().multiplyScalar(3));
    const r = solveLimb(o.pose, o.hipsPos, 'L_arm', target);
    expect(r.extended).toBe(true);
    expect(r.reached).toBe(false);
    const pose = { ...o.pose, ...r.joints };
    const F = fk(pose, o.hipsPos);
    const reach = F.L_wrist.p.clone().sub(shoulder);
    expect(reach.length()).toBeCloseTo(l1 + l2, 6);
    expect(reach.clone().normalize().distanceTo(target.clone().sub(shoulder).normalize())).toBeLessThan(1e-6);
    expect(r.joints.L_elbow![0]).toBeCloseTo(0, 3);
  });

  it('too-close target folds as far as the bones allow without NaN', () => {
    const o = mannequin();
    const shoulder = fk(o.pose, o.hipsPos).R_shoulder.p;
    const r = solveLimb(o.pose, o.hipsPos, 'R_arm', shoulder.clone().add(new Vector3(0, -0.001, 0.0005)));
    for (const j of Object.values(r.joints)) j!.forEach((n) => expect(Number.isFinite(n)).toBe(true));
  });

  it('pole vector picks the bend side (knee toward the pole point)', () => {
    const o = mannequin();
    const hip = fk(o.pose, o.hipsPos).L_hip.p;
    const target = hip.clone().add(new Vector3(0.05, -0.55, 0.25));
    const front = solveLimb(o.pose, o.hipsPos, 'L_leg', target, { pole: hip.clone().add(new Vector3(0, -0.3, 2)) });
    const side = solveLimb(o.pose, o.hipsPos, 'L_leg', target, { pole: hip.clone().add(new Vector3(2, -0.3, 0)) });
    const kneeOf = (r: ReturnType<typeof solveLimb>) => fk({ ...o.pose, ...r.joints }, o.hipsPos).L_knee.p.clone().sub(hip.clone().lerp(target, 0.5));
    const kf = kneeOf(front);
    const ks = kneeOf(side);
    expect(kf.z).toBeGreaterThan(0.05);
    expect(Math.abs(kf.x)).toBeLessThan(Math.abs(kf.z));
    expect(ks.x).toBeGreaterThan(0.05);
    // both still reach
    expect(front.reached && side.reached).toBe(true);
  });

  it('poleAngle swivels the knee around the axis and poleAngleOf reads it back', () => {
    const o = mannequin();
    const hip = fk(o.pose, o.hipsPos).R_hip.p;
    const target = hip.clone().add(new Vector3(0, -0.6, 0.2));
    for (const ang of [-60, 0, 35, 90]) {
      const r = solveLimb(o.pose, o.hipsPos, 'R_leg', target, { poleAngle: ang });
      expect(r.reached).toBe(true);
      expect(poleAngleOf({ ...o.pose, ...r.joints }, o.hipsPos, 'R_leg')).toBeCloseTo(ang, 3);
    }
  });

  it('keeps the current bend side when no pole is given', () => {
    const o = mannequin();
    const pose = poseWith({ L_hip: [-60, 0, 0], L_knee: [90, 0, 0] });
    const hip = fk(pose, o.hipsPos).L_hip.p;
    const target = hip.clone().add(new Vector3(0, -0.5, 0.35));
    const r = solveLimb(pose, o.hipsPos, 'L_leg', target);
    const knee = fk({ ...pose, ...r.joints }, o.hipsPos).L_knee.p;
    expect(knee.z).toBeGreaterThan(hip.z);
    expect(r.joints.L_knee![0]).toBeGreaterThan(0); // knee flexes the right way
  });

  it('round trip with FK: FK pose -> IK from rest -> same end position and a valid pose', () => {
    const o = mannequin();
    const src = poseWith({ R_shoulder: [-50, 20, -40], R_elbow: [-70, 0, 0], L_hip: [-45, 5, 10], L_knee: [60, 0, 0] });
    for (const limb of ['R_arm', 'L_leg'] as Limb[]) {
      const end = fk(src, o.hipsPos)[LIMB_JOINTS[limb][2]].p;
      const r = solveLimb(o.pose, o.hipsPos, limb, end);
      const back = fk({ ...o.pose, ...r.joints }, o.hipsPos)[LIMB_JOINTS[limb][2]].p;
      expect(back.distanceTo(end)).toBeLessThan(1e-3);
      const c = clampJoints(r.joints);
      expect(c.clamped).toBe(false);
    }
  });

  it('hinge joints only bend one way', () => {
    const o = mannequin();
    const hip = fk(o.pose, o.hipsPos).L_hip.p;
    for (const dz of [-0.3, 0, 0.3]) {
      const r = solveLimb(o.pose, o.hipsPos, 'L_leg', hip.clone().add(new Vector3(0.02, -0.6, dz)));
      const [x, y, z] = r.joints.L_knee!;
      expect(x).toBeGreaterThanOrEqual(-1e-9);
      expect(y).toBe(0);
      expect(z).toBe(0);
    }
    const sh = fk(o.pose, o.hipsPos).L_shoulder.p;
    const e = solveLimb(o.pose, o.hipsPos, 'L_arm', sh.clone().add(new Vector3(0.1, -0.2, 0.3)));
    expect(e.joints.L_elbow![0]).toBeLessThanOrEqual(1e-9);
  });
});

describe('commands: ik_reach / ik_pin / ik_bake', () => {
  const id = (p: ReturnType<typeof newProject>) => p.objects[0].id;
  const rest = () => {
    const p = newProject();
    return { p, o: p.objects[0] };
  };

  it('ik_reach puts the wrist on a world target (object transform included) and undoes in one step', () => {
    let { p } = rest();
    p = applyCommand(p, { type: 'object_transform', object: id(p), position: [1, 0, -2], rotation: [0, 40, 0] }).project;
    const before = p.objects[0];
    const target: Vec3 = (() => {
      const w = endWorld(before, 'L_arm');
      return [w[0] + 0.05, w[1] + 0.35, w[2] + 0.2];
    })();
    const r = applyCommand(p, { type: 'ik_reach', object: id(p), limb: 'L_arm', target });
    expect(dist(endWorld(r.project.objects[0], 'L_arm'), target)).toBeLessThan(1e-3);
    expect(applyCommand(r.project, r.inverse as Command).project).toEqual(p);
    expect(applyCommand(p, r.applied).project).toEqual(r.project);
  });

  it('ik_reach unreachable: arm fully extended toward the target', () => {
    const { p } = rest();
    const target: Vec3 = [0, 3, 3];
    const r = applyCommand(p, { type: 'ik_reach', object: id(p), limb: 'R_arm', target }).project.objects[0];
    const sh = jointWorld(r, 'R_shoulder');
    const wr = endWorld(r, 'R_arm');
    expect(dist(sh, wr)).toBeCloseTo(0.55, 3);
    const dir = v(wr).sub(v(sh)).normalize();
    expect(dir.distanceTo(v(target).sub(v(sh)).normalize())).toBeLessThan(0.01);
  });

  it('ik_reach pole / poleAngle and validation', () => {
    const { p } = rest();
    const w = endWorld(p.objects[0], 'L_leg');
    const target: Vec3 = [w[0], w[1] + 0.2, w[2] + 0.25];
    const a = applyCommand(p, { type: 'ik_reach', object: id(p), limb: 'L_leg', target, poleAngle: 0 }).project.objects[0];
    const b = applyCommand(p, { type: 'ik_reach', object: id(p), limb: 'L_leg', target, poleAngle: 25 }).project.objects[0];
    expect(dist(endWorld(a, 'L_leg'), target)).toBeLessThan(1e-3);
    expect(dist(endWorld(b, 'L_leg'), target)).toBeLessThan(2e-3);
    expect(poleAngleOf(b.pose, b.hipsPos, 'L_leg')).toBeCloseTo(25, 0);
    expect(() => applyCommand(p, { type: 'ik_reach', object: id(p), limb: 'L_wing' as never, target })).toThrow(/limb/);
    expect(() => applyCommand(p, { type: 'ik_reach', object: id(p), limb: 'L_arm', target: [0, 'x', 0] as never })).toThrow(/target/);
    const cube = applyCommand(p, { type: 'object_add', kind: 'cube' }).project;
    expect(() => applyCommand(cube, { type: 'ik_reach', object: cube.objects[1].id, limb: 'L_arm', target })).toThrow(/not a mannequin/);
  });

  it('accepts L_foot / R_foot as limb names', () => {
    const { p } = rest();
    const w = endWorld(p.objects[0], 'R_leg');
    const r = applyCommand(p, { type: 'ik_reach', object: id(p), limb: 'R_foot', target: [w[0], w[1] + 0.3, w[2]] });
    expect(r.applied).toMatchObject({ limb: 'R_leg' });
  });

  it('pinned foot stays put when the hips move or the object is translated; undo restores', () => {
    let { p } = rest();
    const pinRes = applyCommand(p, { type: 'ik_pin', object: id(p), limb: 'L_foot', pinned: true });
    p = pinRes.project;
    const pinned = p.objects[0].pins.L_foot!;
    expect(pinned).toBeTruthy();
    // lower the hips by 12 cm and shift them sideways: the foot must not move
    const moved = applyCommand(p, { type: 'joint_set', object: id(p), joint: 'hips', position: [0.04, -0.12, 0.03] });
    expect(dist(endWorld(moved.project.objects[0], 'L_leg'), pinned)).toBeLessThan(1e-3);
    expect(moved.project.objects[0].pose.L_knee[0]).toBeGreaterThan(10); // knee bent to compensate
    // the other (unpinned) foot moves with the body
    expect(dist(endWorld(moved.project.objects[0], 'R_leg'), endWorld(p.objects[0], 'R_leg'))).toBeGreaterThan(0.05);
    // undo of the hips edit puts the legs back
    const back = applyCommand(moved.project, moved.inverse as Command).project.objects[0];
    expect(dist(endWorld(back, 'L_leg'), pinned)).toBeLessThan(1e-3);
    expect(back.hipsPos).toEqual([0, 0, 0]);
    back.pose.L_knee.forEach((n, i) => expect(n).toBeCloseTo(p.objects[0].pose.L_knee[i], 2));
    // moving the whole object keeps the world pin
    const shifted = applyCommand(moved.project, { type: 'object_transform', object: id(p), position: [0.05, 0, 0.05] }).project.objects[0];
    expect(dist(endWorld(shifted, 'L_leg'), pinned)).toBeLessThan(1e-3);
  });

  it('ik_pin undo/redo and unpin', () => {
    const { p } = rest();
    const a = applyCommand(p, { type: 'ik_pin', object: id(p), limb: 'R_leg', pinned: true, position: [-0.1, 0.1, 0.1] });
    expect(a.project.objects[0].pins.R_foot).toEqual([-0.1, 0.1, 0.1]);
    expect(dist(endWorld(a.project.objects[0], 'R_leg'), [-0.1, 0.1, 0.1])).toBeLessThan(1e-3);
    const undone = applyCommand(a.project, a.inverse as Command).project;
    expect(undone.objects[0].pins).toEqual({});
    expect(undone.objects[0].pose.R_knee).toEqual(p.objects[0].pose.R_knee);
    const un = applyCommand(a.project, { type: 'ik_pin', object: id(p), limb: 'R_foot', pinned: false });
    expect(un.project.objects[0].pins).toEqual({});
    expect(() => applyCommand(p, { type: 'ik_pin', object: id(p), limb: 'L_arm', pinned: true })).toThrow(/feet/);
  });

  it('playback of hips keys keeps pinned feet planted (evaluateObject)', () => {
    let { p } = rest();
    const o = id(p);
    p = applyCommand(p, { type: 'ik_pin', object: o, limb: 'L_foot', pinned: true }).project;
    p = applyCommand(p, { type: 'ik_pin', object: o, limb: 'R_foot', pinned: true }).project;
    p = applyCommand(p, { type: 'key_add', object: o, target: 'hipsPos', time: 0 }).project;
    p = applyCommand(p, { type: 'joint_set', object: o, joint: 'hips', position: [0, -0.15, 0.1] }).project;
    p = applyCommand(p, { type: 'key_add', object: o, target: 'hipsPos', time: 1 }).project;
    const pins = p.objects[0].pins;
    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      const ev = evaluateObject(p.objects[0], t);
      expect(dist(endWorld(ev, 'L_leg'), pins.L_foot!)).toBeLessThan(1.5e-3);
      expect(dist(endWorld(ev, 'R_leg'), pins.R_foot!)).toBeLessThan(1.5e-3);
    }
    expect(evaluateObject(p.objects[0], 0.5).hipsPos[1]).toBeCloseTo(-0.075, 6);
  });

  it('ik_bake keys the legs every frame and unpins; result stays without the pins', () => {
    let { p } = rest();
    const o = id(p);
    p = applyCommand(p, { type: 'timeline_set', fps: 10, duration: 1 }).project;
    p = applyCommand(p, { type: 'ik_pin', object: o, limb: 'L_foot', pinned: true }).project;
    p = applyCommand(p, { type: 'key_add', object: o, target: 'hipsPos', time: 0 }).project;
    p = applyCommand(p, { type: 'joint_set', object: o, joint: 'hips', position: [0, -0.1, 0] }).project;
    p = applyCommand(p, { type: 'key_add', object: o, target: 'hipsPos', time: 1 }).project;
    const pinned = p.objects[0].pins.L_foot!;
    const r = applyCommand(p, { type: 'ik_bake', object: o });
    const baked = r.project.objects[0];
    expect(baked.pins).toEqual({});
    expect(baked.tracks.L_knee).toHaveLength(11);
    expect(baked.tracks.R_knee).toBeUndefined();
    for (const t of [0, 0.3, 0.7, 1]) {
      const ev = evaluateObject(baked, t);
      expect(dist(endWorld(ev, 'L_leg'), pinned)).toBeLessThan(0.01); // linear interpolation between per-frame keys
    }
    const undone = applyCommand(r.project, r.inverse as Command).project.objects[0];
    expect(undone.pins.L_foot).toEqual(pinned);
    expect(undone.tracks.L_knee).toBeUndefined();
    expect(() => applyCommand(r.project, { type: 'ik_bake', object: o })).toThrow(/no pinned/);
  });

  it('key_add with bakePins keys the pinned legs and drops the pins', () => {
    let { p } = rest();
    const o = id(p);
    p = applyCommand(p, { type: 'ik_pin', object: o, limb: 'L_foot', pinned: true }).project;
    p = applyCommand(p, { type: 'joint_set', object: o, joint: 'hips', position: [0, -0.1, 0] }).project;
    const r = applyCommand(p, { type: 'key_add', object: o, target: 'hipsPos', time: 0, bakePins: true });
    const n = r.project.objects[0];
    expect(n.pins).toEqual({});
    expect(Object.keys(n.tracks).sort()).toEqual(['L_ankle', 'L_hip', 'L_knee', 'hipsPos']);
    const back = applyCommand(r.project, r.inverse as Command).project.objects[0];
    expect(back.pins.L_foot).toBeTruthy();
    expect(back.tracks).toEqual({});
  });

  it('applyPins is a no-op without pins and idempotent with them', () => {
    const o = mannequin();
    expect(applyPins(o)).toBe(o);
    const pinned: SceneObject = { ...o, pins: { L_foot: [0.1, 0.12, 0.05] } };
    const once = applyPins(pinned);
    const twice = applyPins(once);
    for (const j of LIMB_JOINTS.L_leg) once.pose[j].forEach((n, i) => expect(n).toBeCloseTo(twice.pose[j][i], 3));
  });

  it('clampJoints respects the rig limits loosely (reports clamping)', () => {
    const c = clampJoints({ L_knee: [-30, 0, 0], L_elbow: [-200, 0, 0] });
    expect(c.clamped).toBe(true);
    expect(c.joints.L_knee).toEqual(clampRotation('L_knee', [-30, 0, 0]));
    expect(worldToLocal(mannequin(), [0, 0.95, 0]).length()).toBeCloseTo(0.95, 6);
  });
});
