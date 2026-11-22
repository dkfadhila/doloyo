/**
 * Direction -> rotation solver for our 17-joint rig. Pure TS (three math only, no DOM).
 * Used by Copy Dance (3D landmarks -> pose) and, with rigFK, by tests and the skeletal retargeter.
 * Coordinates: Y up, +X = character left, +Z = character forward, meters.
 */
import { Euler, Matrix4, Quaternion, Vector3 } from 'three';
import { RIG } from '../core/rig';
import type { JointName, Pose, Vec3 } from '../core/types';

export const D2R = Math.PI / 180;
export const R2D = 180 / Math.PI;

const DOWN = new Vector3(0, -1, 0);
const FWD = new Vector3(0, 0, 1);

export const v3 = (a: Vec3) => new Vector3(a[0], a[1], a[2]);
export const toVec = (v: Vector3): Vec3 => [v.x, v.y, v.z];

export function eulerToQuat(e: Vec3): Quaternion {
  return new Quaternion().setFromEuler(new Euler(e[0] * D2R, e[1] * D2R, e[2] * D2R, 'XYZ'));
}
export function quatToEuler(q: Quaternion): Vec3 {
  const e = new Euler().setFromQuaternion(q, 'XYZ');
  return [e.x * R2D, e.y * R2D, e.z * R2D];
}

/** Shortest rotation taking direction a to direction b (robust for opposite vectors). */
export function arc(a: Vector3, b: Vector3): Quaternion {
  const A = a.clone().normalize();
  const B = b.clone().normalize();
  const d = A.dot(B);
  if (d < -0.999999) {
    const axis = new Vector3(1, 0, 0).cross(A);
    if (axis.lengthSq() < 1e-6) axis.set(0, 0, 1).cross(A);
    return new Quaternion().setFromAxisAngle(axis.normalize(), Math.PI);
  }
  return new Quaternion().setFromUnitVectors(A, B);
}

// ---------------- forward kinematics ----------------

export interface JointFK {
  pos: Vector3;
  quat: Quaternion; // world orientation
}
export type FK = Record<JointName, JointFK>;

/** World transforms of every joint (object space) for a pose + hips offset. */
export function rigFK(pose: Pose, hipsPos: Vec3 = [0, 0, 0]): FK {
  const out = {} as FK;
  for (const d of RIG) {
    const local = eulerToQuat(pose[d.name]);
    const off = v3(d.offset);
    if (d.name === 'hips') off.add(v3(hipsPos));
    if (!d.parent) {
      out[d.name] = { pos: off, quat: local };
    } else {
      const p = out[d.parent];
      out[d.name] = { pos: p.pos.clone().add(off.applyQuaternion(p.quat)), quat: p.quat.clone().multiply(local) };
    }
  }
  return out;
}

// ---------------- body points (solver input) ----------------

/** Landmarks the solver understands, already in our frame. Foot/hand/head points are optional. */
export interface BodyPoints {
  hipL: Vec3; hipR: Vec3;
  shoulderL: Vec3; shoulderR: Vec3;
  elbowL: Vec3; elbowR: Vec3;
  wristL: Vec3; wristR: Vec3;
  kneeL: Vec3; kneeR: Vec3;
  ankleL: Vec3; ankleR: Vec3;
  toeL?: Vec3; toeR?: Vec3;
  heelL?: Vec3; heelR?: Vec3;
  /** Centre of the fingers (e.g. mean of index and pinky knuckles). */
  handL?: Vec3; handR?: Vec3;
  earL?: Vec3; earR?: Vec3; nose?: Vec3;
}

/** Nose sits ~3 cm below and ~10 cm in front of the ear line on a neutral head. */
export const HEAD_PITCH_BIAS = Math.atan2(0.03, 0.1);

const mid = (a: Vec3, b: Vec3) => v3(a).add(v3(b)).multiplyScalar(0.5);

/** Build the solver input from a rig FK (round-trip tests, and a reference for landmark conventions). */
export function bodyPointsFromFK(fk: FK): BodyPoints {
  const p = (j: JointName) => toVec(fk[j].pos);
  const at = (j: JointName, o: Vec3) => toVec(v3(o).applyQuaternion(fk[j].quat).add(fk[j].pos));
  const head = fk.head;
  const earMid = new Vector3(0, 0.1, 0).applyQuaternion(head.quat).add(head.pos);
  const dir = (o: Vec3) => toVec(v3(o).applyQuaternion(head.quat).add(earMid));
  return {
    hipL: p('L_hip'), hipR: p('R_hip'),
    shoulderL: p('L_shoulder'), shoulderR: p('R_shoulder'),
    elbowL: p('L_elbow'), elbowR: p('R_elbow'),
    wristL: p('L_wrist'), wristR: p('R_wrist'),
    kneeL: p('L_knee'), kneeR: p('R_knee'),
    ankleL: p('L_ankle'), ankleR: p('R_ankle'),
    toeL: at('L_ankle', [0, 0, 0.15]), toeR: at('R_ankle', [0, 0, 0.15]),
    heelL: p('L_ankle'), heelR: p('R_ankle'),
    handL: at('L_wrist', [0, -0.09, 0]), handR: at('R_wrist', [0, -0.09, 0]),
    earL: dir([0.08, 0, 0]), earR: dir([-0.08, 0, 0]),
    nose: dir([0, -0.03, 0.1]),
  };
}

// ---------------- solver ----------------

const smooth = (x: number, a: number, b: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Orthonormal frame from an x axis (left) and an up hint. */
function frame(x: Vector3, up: Vector3): Quaternion {
  const X = x.clone().normalize();
  const Y = up.clone().sub(X.clone().multiplyScalar(X.dot(up)));
  if (Y.lengthSq() < 1e-8) Y.set(0, 1, 0);
  Y.normalize();
  const Z = new Vector3().crossVectors(X, Y);
  return new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(X, Y, Z));
}

export interface SolveResult {
  pose: Pose;
  /** Hip centre in the input coordinates (caller decides how to turn it into hipsPos). */
  hipCenter: Vec3;
  /** World orientation of each joint after solving (for debugging / tests). */
  world: Record<JointName, Quaternion>;
}

export interface SolveOptions {
  /** Share of torso twist/bend given to the spine joint (rest to chest). Default 0.5. */
  spineShare?: number;
  /** Share of the head orientation given to the neck. Default 0.4. */
  neckShare?: number;
}

/** Twist about the limb axis chosen so the lower segment bends in the joint's flexion plane (local X). */
function limb(parent: Quaternion, upper: Vector3, lower: Vector3, kind: 'arm' | 'leg'): { rUpper: Quaternion; rLower: Quaternion } {
  const dU = upper.clone().normalize();
  const dL = lower.clone().normalize();
  const swing = arc(DOWN, dU);
  const g = dL.clone().applyQuaternion(swing.clone().invert());
  const n = Math.hypot(g.x, g.z);
  const phi0 = kind === 'arm' ? Math.atan2(g.x, g.z) : Math.atan2(-g.x, -g.z);
  const phi = phi0 * smooth(n, 0.06, 0.3);
  const worldUpper = swing.clone().multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), phi));
  const f = dL.clone().applyQuaternion(worldUpper.clone().invert());
  const rUpper = parent.clone().invert().multiply(worldUpper);
  return { rUpper, rLower: arc(DOWN, f) };
}

export function solvePose(pts: BodyPoints, opt: SolveOptions = {}): SolveResult {
  const spineShare = opt.spineShare ?? 0.5;
  const neckShare = opt.neckShare ?? 0.4;
  const hipC = mid(pts.hipL, pts.hipR);
  const shC = mid(pts.shoulderL, pts.shoulderR);
  const upRef = shC.clone().sub(hipC);

  const wPel = frame(v3(pts.hipL).sub(v3(pts.hipR)), upRef);
  const wTor = frame(v3(pts.shoulderL).sub(v3(pts.shoulderR)), upRef);
  const wSpine = wPel.clone().slerp(wTor, spineShare);

  let wHead = wTor.clone();
  if (pts.earL && pts.earR && pts.nose) {
    const X = v3(pts.earL).sub(v3(pts.earR)).normalize();
    const fwd = v3(pts.nose).sub(mid(pts.earL, pts.earR));
    const Z = fwd.clone().sub(X.clone().multiplyScalar(X.dot(fwd))).normalize(); // forward orthogonal to x
    const Y = new Vector3().crossVectors(Z, X);
    wHead = new Quaternion()
      .setFromRotationMatrix(new Matrix4().makeBasis(X, Y, Z))
      .multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -HEAD_PITCH_BIAS));
  }
  const wNeck = wTor.clone().slerp(wHead, neckShare);

  const world = { hips: wPel, spine: wSpine, chest: wTor, neck: wNeck, head: wHead } as Record<JointName, Quaternion>;
  const pose = {} as Pose;
  const rel = (parent: Quaternion, child: Quaternion) => quatToEuler(parent.clone().invert().multiply(child));
  pose.hips = quatToEuler(wPel);
  pose.spine = rel(wPel, wSpine);
  pose.chest = rel(wSpine, wTor);
  pose.neck = rel(wTor, wNeck);
  pose.head = rel(wNeck, wHead);

  for (const s of ['L', 'R'] as const) {
    const P = (k: string) => (pts as unknown as Record<string, Vec3 | undefined>)[k + s];
    const J = (k: string) => `${s}_${k}` as JointName;
    const sh = v3(P('shoulder')!), el = v3(P('elbow')!), wr = v3(P('wrist')!);
    const arm = limb(wTor, el.clone().sub(sh), wr.clone().sub(el), 'arm');
    pose[J('shoulder')] = quatToEuler(arm.rUpper);
    pose[J('elbow')] = quatToEuler(arm.rLower);
    const wUpper = wTor.clone().multiply(arm.rUpper);
    const wFore = wUpper.clone().multiply(arm.rLower);
    world[J('shoulder')] = wUpper;
    world[J('elbow')] = wFore;
    const hand = P('hand');
    let rWrist = new Quaternion();
    if (hand) rWrist = arc(DOWN, v3(hand).sub(wr).applyQuaternion(wFore.clone().invert()));
    pose[J('wrist')] = quatToEuler(rWrist);
    world[J('wrist')] = wFore.clone().multiply(rWrist);

    const hp = v3(P('hip')!), kn = v3(P('knee')!), an = v3(P('ankle')!);
    const leg = limb(wPel, kn.clone().sub(hp), an.clone().sub(kn), 'leg');
    pose[J('hip')] = quatToEuler(leg.rUpper);
    pose[J('knee')] = quatToEuler(leg.rLower);
    const wThigh = wPel.clone().multiply(leg.rUpper);
    const wShin = wThigh.clone().multiply(leg.rLower);
    world[J('hip')] = wThigh;
    world[J('knee')] = wShin;
    const toe = P('toe');
    let rAnkle = new Quaternion();
    if (toe) {
      const heel = P('heel') ?? P('ankle')!;
      const t = v3(toe).sub(v3(heel)).applyQuaternion(wShin.clone().invert());
      if (t.lengthSq() > 1e-8) rAnkle = arc(FWD, t);
    }
    pose[J('ankle')] = quatToEuler(rAnkle);
    world[J('ankle')] = wShin.clone().multiply(rAnkle);
  }
  return { pose, hipCenter: toVec(hipC), world };
}

/** Direction of each rig segment in world space (for tests and diagnostics). */
export function segmentDirections(fk: FK): Record<string, Vector3> {
  const d: Record<string, Vector3> = {};
  const seg = (name: string, a: JointName, b: JointName) => (d[name] = fk[b].pos.clone().sub(fk[a].pos).normalize());
  for (const s of ['L', 'R']) {
    seg(`${s}_upperArm`, `${s}_shoulder` as JointName, `${s}_elbow` as JointName);
    seg(`${s}_foreArm`, `${s}_elbow` as JointName, `${s}_wrist` as JointName);
    seg(`${s}_thigh`, `${s}_hip` as JointName, `${s}_knee` as JointName);
    seg(`${s}_shin`, `${s}_knee` as JointName, `${s}_ankle` as JointName);
  }
  d.shoulderLine = fk.L_shoulder.pos.clone().sub(fk.R_shoulder.pos).normalize();
  d.hipLine = fk.L_hip.pos.clone().sub(fk.R_hip.pos).normalize();
  return d;
}
