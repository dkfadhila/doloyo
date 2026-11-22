import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Quaternion, Vector3 } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { describe, expect, it } from 'vitest';
import { QUATERNIUS_BONES, QUATERNIUS_CALIBRATION } from '../characters/registry';
import { emptyPose, JOINTS } from '../core/rig';
import type { JointName, Pose, Vec3 } from '../core/types';
import { Retargeter } from './skeletal';
import { bodyPointsFromFK, eulerToQuat, rigFK, segmentDirections, solvePose } from './solver';

/** Small deterministic PRNG so failures are reproducible. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
const between = (r: () => number, a: number, b: number) => a + (b - a) * r();

function randomPose(r: () => number): Pose {
  const p = emptyPose();
  p.hips = [between(r, -10, 10), between(r, -60, 60), between(r, -8, 8)];
  p.spine = [between(r, -10, 25), between(r, -15, 15), between(r, -10, 10)];
  p.chest = [between(r, -8, 15), between(r, -20, 20), between(r, -10, 10)];
  p.neck = [between(r, -10, 15), between(r, -25, 25), 0];
  p.head = [between(r, -15, 15), between(r, -30, 30), between(r, -10, 10)];
  for (const s of ['L', 'R']) {
    const m = s === 'L' ? 1 : -1;
    p[`${s}_shoulder` as JointName] = [between(r, -150, 30), between(r, -40, 40), m * between(r, 0, 120)];
    p[`${s}_elbow` as JointName] = [between(r, -130, -15), 0, 0];
    p[`${s}_wrist` as JointName] = [between(r, -30, 30), 0, between(r, -15, 15)];
    p[`${s}_hip` as JointName] = [between(r, -90, 20), between(r, -25, 25), m * between(r, -5, 25)];
    p[`${s}_knee` as JointName] = [between(r, 15, 120), 0, 0];
    p[`${s}_ankle` as JointName] = [between(r, -25, 25), 0, 0];
  }
  return p;
}

const angle = (a: Vector3, b: Vector3) => (Math.acos(Math.min(1, Math.max(-1, a.dot(b)))) * 180) / Math.PI;

describe('direction solver', () => {
  it('round trip: random poses -> directions -> solve -> same segment directions', () => {
    const r = rng(7);
    for (let i = 0; i < 60; i++) {
      const pose = randomPose(r);
      const hipsPos: Vec3 = [between(r, -0.3, 0.3), between(r, -0.4, 0.1), between(r, -0.3, 0.3)];
      const fk = rigFK(pose, hipsPos);
      const sol = solvePose(bodyPointsFromFK(fk));
      const fk2 = rigFK(sol.pose, [0, 0, 0]);
      const want = segmentDirections(fk);
      const got = segmentDirections(fk2);
      for (const k of Object.keys(want)) {
        expect(angle(want[k], got[k]), `pose ${i} segment ${k}`).toBeLessThan(0.5);
      }
    }
  });

  it('rest pose solves to (nearly) zero rotations', () => {
    const sol = solvePose(bodyPointsFromFK(rigFK(emptyPose())));
    for (const j of JOINTS) for (const v of sol.pose[j]) expect(Math.abs(v), j).toBeLessThan(0.5);
  });

  it('head orientation is recovered from ears and nose', () => {
    const r = rng(11);
    for (let i = 0; i < 20; i++) {
      const pose = emptyPose();
      pose.neck = [between(r, -10, 10), between(r, -30, 30), 0];
      pose.head = [between(r, -20, 20), between(r, -40, 40), between(r, -10, 10)];
      const fk = rigFK(pose);
      const sol = solvePose(bodyPointsFromFK(fk));
      const q = new Quaternion().copy(sol.world.head).angleTo(fk.head.quat);
      expect((q * 180) / Math.PI).toBeLessThan(0.5);
    }
  });
});

function loadGlb(file: string) {
  const b = readFileSync(resolve(__dirname, '../../public/assets', file));
  const ab = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
  return new Promise<import('three/examples/jsm/loaders/GLTFLoader.js').GLTF>((res, rej) => new GLTFLoader().parse(ab, '', res, rej));
}

describe('skeletal retargeter (Quaternius mannequin)', () => {
  it('maps every joint, faces +Z with left at +X and fits our rig height', async () => {
    const g = await loadGlb('characters/mannequin_f.glb');
    const rt = new Retargeter(g.scene, QUATERNIUS_BONES, QUATERNIUS_CALIBRATION);
    expect(rt.info.missing).toEqual([]);
    expect(Math.abs(rt.info.yaw)).toBeLessThan(1e-6);
    expect(rt.info.scale).toBeGreaterThan(0.95);
    expect(rt.info.scale).toBeLessThan(1.15);
  });

  it('forward then inverse returns the same pose; bones point where our segments point', async () => {
    const g = await loadGlb('characters/mannequin_f.glb');
    const rt = new Retargeter(g.scene, QUATERNIUS_BONES, QUATERNIUS_CALIBRATION);
    const r = rng(3);
    const pairs: [JointName, string, string][] = [
      ['L_shoulder', 'upperarm_l', 'lowerarm_l'],
      ['L_elbow', 'lowerarm_l', 'hand_l'],
      ['R_hip', 'thigh_r', 'calf_r'],
      ['R_knee', 'calf_r', 'foot_r'],
    ];
    for (let i = 0; i < 25; i++) {
      const pose = randomPose(r);
      const hipsPos: Vec3 = [between(r, -0.3, 0.3), between(r, -0.4, 0.1), between(r, -0.3, 0.3)];
      rt.apply(pose, hipsPos);
      rt.root.updateMatrixWorld(true);

      // inverse is exact (compare world rotations, Euler triples are not unique)
      const back = rt.read();
      const a = rigFK(pose, hipsPos);
      const b = rigFK(back.pose, back.hipsPos);
      for (const j of JOINTS) {
        expect((new Quaternion().copy(a[j].quat).angleTo(b[j].quat) * 180) / Math.PI, `pose ${i} joint ${j}`).toBeLessThan(0.05);
      }
      for (let k = 0; k < 3; k++) expect(back.hipsPos[k]).toBeCloseTo(hipsPos[k], 3);

      // forward: the skeleton's bone directions equal our rig's segment directions
      for (const [joint, from, to] of pairs) {
        const pf = rt.model.getObjectByName(from)!.getWorldPosition(new Vector3());
        const pt = rt.model.getObjectByName(to)!.getWorldPosition(new Vector3());
        const dir = pt.sub(pf).normalize();
        const child = joint === 'L_shoulder' ? 'L_elbow' : joint === 'L_elbow' ? 'L_wrist' : joint === 'R_hip' ? 'R_knee' : 'R_ankle';
        const want = a[child as JointName].pos.clone().sub(a[joint].pos).normalize();
        expect(angle(dir, want), `pose ${i} ${joint}`).toBeLessThan(0.5);
      }
    }
  });

  it('rest pose stands on the floor with arms down', async () => {
    const g = await loadGlb('characters/mannequin_m.glb');
    const rt = new Retargeter(g.scene, QUATERNIUS_BONES, QUATERNIUS_CALIBRATION);
    rt.apply(emptyPose(), [0, 0, 0]);
    rt.root.updateMatrixWorld(true);
    const p = (n: string) => rt.model.getObjectByName(n)!.getWorldPosition(new Vector3());
    expect(p('pelvis').y).toBeCloseTo(0.95, 2);
    expect(p('hand_l').y).toBeLessThan(p('upperarm_l').y - 0.4); // arm hangs down
    expect(p('hand_l').x).toBeGreaterThan(0); // left is +X
    expect(p('ball_l').z).toBeGreaterThan(p('foot_l').z); // faces +Z
    void eulerToQuat;
  });
});
