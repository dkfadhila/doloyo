/**
 * Analytic two-bone IK on the 17-joint rig (arms: shoulder-elbow-wrist, legs: hip-knee-ankle).
 * Pure math on the rig's own FK; the result is a set of joint Euler updates (degrees, XYZ) in the same format as
 * `joint_set`, so commands, keys and every character view keep working.
 *
 * Space: "local" is the object's rig space (before the object transform); world targets go through `worldToLocal`.
 */
import { Euler, Matrix4, Quaternion, Vector3 } from 'three';
import { ADULT, profileOf, type BodyProfile } from './body';
import { clampRotation, RIG, RIG_BY_NAME } from './rig';
import type { FootName, GroundContact, JointName, Limb, Pins, Pose, SceneObject, Vec3 } from './types';

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

export const LIMB_JOINTS: Record<Limb, [JointName, JointName, JointName]> = {
  L_arm: ['L_shoulder', 'L_elbow', 'L_wrist'],
  R_arm: ['R_shoulder', 'R_elbow', 'R_wrist'],
  L_leg: ['L_hip', 'L_knee', 'L_ankle'],
  R_leg: ['R_hip', 'R_knee', 'R_ankle'],
};
export const isLeg = (l: Limb) => l.endsWith('leg');
export const FOOT_LIMB: Record<FootName, Limb> = { L_foot: 'L_leg', R_foot: 'R_leg' };
export const LEG_FOOT: Record<'L_leg' | 'R_leg', FootName> = { L_leg: 'L_foot', R_leg: 'R_foot' };

/** Accepts "L_arm", "R_leg", "L_foot", "R_foot". */
export function parseLimb(v: unknown): Limb | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if ((['L_arm', 'R_arm', 'L_leg', 'R_leg'] as string[]).includes(s)) return s as Limb;
  if (s === 'L_foot') return 'L_leg';
  if (s === 'R_foot') return 'R_leg';
  return null;
}

export interface JointFrame {
  p: Vector3;
  q: Quaternion;
}

const eulerQ = (e: Vec3) => new Quaternion().setFromEuler(new Euler(e[0] * D2R, e[1] * D2R, e[2] * D2R, 'XYZ'));

/**
 * Forward kinematics of the whole rig in object-local space. `profile` = the body proportions (default adult);
 * hipsPos is in adult rig units and is multiplied by profile.hipsScale.
 */
export function fk(pose: Pose, hipsPos: Vec3, profile: BodyProfile = ADULT): Record<JointName, JointFrame> {
  const out = {} as Record<JointName, JointFrame>;
  for (const d of RIG) {
    const lq = eulerQ(pose[d.name]);
    const off = new Vector3(...profile.offset[d.name]);
    if (!d.parent) {
      off.add(new Vector3(...hipsPos).multiplyScalar(profile.hipsScale));
      out[d.name] = { p: off, q: lq };
    } else {
      const par = out[d.parent];
      out[d.name] = { p: off.applyQuaternion(par.q).add(par.p), q: par.q.clone().multiply(lq) };
    }
  }
  return out;
}

type Xform = Pick<SceneObject, 'position' | 'rotation' | 'scale'>;

/** Object transform (position, Euler XYZ degrees, scale) as a matrix. */
export function objectMatrix(o: Xform): Matrix4 {
  return new Matrix4().compose(new Vector3(...o.position), eulerQ(o.rotation), new Vector3(...o.scale));
}
export const worldToLocal = (o: Xform, w: Vec3): Vector3 => new Vector3(...w).applyMatrix4(objectMatrix(o).invert());
export const localToWorld = (o: Xform, l: Vector3): Vec3 => {
  const v = l.clone().applyMatrix4(objectMatrix(o));
  return [v.x, v.y, v.z];
};

/** World position of a joint of a mannequin. */
export function jointWorld(o: SceneObject, j: JointName): Vec3 {
  return localToWorld(o, fk(o.pose, o.hipsPos, profileOf(o))[j].p);
}
/** World position of the end effector (wrist or ankle joint) of a limb. */
export function endWorld(o: SceneObject, limb: Limb): Vec3 {
  return jointWorld(o, LIMB_JOINTS[limb][2]);
}

const defaultPole = (limb: Limb) => new Vector3(0, 0, isLeg(limb) ? 1 : -1);
const perp = (v: Vector3, a: Vector3) => v.clone().sub(a.clone().multiplyScalar(v.dot(a)));

/** Reference pole direction perpendicular to the axis a (knees point forward, elbows backward). */
function refPole(limb: Limb, a: Vector3): Vector3 {
  let p = perp(defaultPole(limb), a);
  if (p.length() < 1e-3) p = perp(new Vector3(1, 0, 0), a);
  return p.normalize();
}

/** Current swivel (pole angle, degrees) of a limb: angle of the elbow/knee direction around the root-to-end axis from the reference pole. */
export function poleAngleOf(pose: Pose, hipsPos: Vec3, limb: Limb, profile: BodyProfile = ADULT): number {
  const [j0, j1, j2] = LIMB_JOINTS[limb];
  const F = fk(pose, hipsPos, profile);
  const a = F[j2].p.clone().sub(F[j0].p);
  if (a.length() < 1e-6) return 0;
  a.normalize();
  const cur = perp(F[j1].p.clone().sub(F[j0].p), a);
  if (cur.length() < 1e-4) return 0;
  cur.normalize();
  const ref = refPole(limb, a);
  return Math.atan2(a.dot(ref.clone().cross(cur)), ref.dot(cur)) * R2D;
}

export interface SolveOptions {
  /** A point (object-local) the elbow/knee should point toward. */
  pole?: Vector3;
  /** Pole as a swivel angle in degrees around the root-to-target axis (0 = knee forward / elbow backward). */
  poleAngle?: number;
  /** Keep the end joint's orientation in space (default: legs yes, arms no). */
  keepEnd?: boolean;
  /** Body proportions (default adult). */
  profile?: BodyProfile;
}

export interface SolveResult {
  /** New local rotations (degrees) of the limb joints; the end joint is only included when its orientation is kept. */
  joints: Partial<Record<JointName, Vec3>>;
  /** The end effector ends within 1 mm of the target. */
  reached: boolean;
  /** The target is farther than the limb is long: the limb is fully extended toward it. */
  extended: boolean;
  /** Where the end effector ended up (object-local). */
  end: Vector3;
}

const toEuler = (q: Quaternion): Vec3 => {
  const e = new Euler().setFromQuaternion(q, 'XYZ');
  return [e.x * R2D, e.y * R2D, e.z * R2D];
};

/**
 * Solve one limb so its end joint reaches `target` (object-local). Unreachable targets give a fully extended limb
 * pointing at the target; too-close targets fold as far as the bone lengths allow. Without an explicit pole the
 * current elbow/knee side is kept (stable while dragging). Joint limits are NOT applied here (see clampJoints).
 */
export function solveLimb(pose: Pose, hipsPos: Vec3, limb: Limb, target: Vector3, opts: SolveOptions = {}): SolveResult {
  const [j0, j1, j2] = LIMB_JOINTS[limb];
  const prof = opts.profile ?? ADULT;
  const F = fk(pose, hipsPos, prof);
  const parent = RIG_BY_NAME[j0].parent as JointName;
  const P0 = F[j0].p;
  const l1 = new Vector3(...prof.offset[j1]).length();
  const l2 = new Vector3(...prof.offset[j2]).length();
  const s = isLeg(limb) ? 1 : -1;

  const toT = target.clone().sub(P0);
  const dist = toT.length();
  const a = dist > 1e-9 ? toT.clone().divideScalar(dist) : new Vector3(0, -1, 0);
  const dc = Math.min(l1 + l2, Math.max(Math.abs(l1 - l2) + 1e-4, dist));
  const x = (l1 * l1 + dc * dc - l2 * l2) / (2 * dc);
  const h = Math.sqrt(Math.max(0, l1 * l1 - x * x));

  // pole direction (unit, perpendicular to the axis)
  let pa: Vector3;
  if (opts.pole) pa = perp(opts.pole.clone().sub(P0), a);
  else if (opts.poleAngle !== undefined) pa = refPole(limb, a).applyAxisAngle(a, opts.poleAngle * D2R);
  else {
    // keep the current bend side, unless the limb is (nearly) straight and the side is meaningless
    const upper = F[j1].p.clone().sub(P0);
    const lower = F[j2].p.clone().sub(F[j1].p);
    const bendNow = upper.angleTo(lower);
    pa = bendNow > 6 * D2R ? perp(upper, a) : new Vector3();
  }
  if (pa.length() < 1e-4) pa = refPole(limb, a);
  pa.normalize();

  const E = P0.clone().add(a.clone().multiplyScalar(x)).add(pa.clone().multiplyScalar(h));
  const Tc = P0.clone().add(a.clone().multiplyScalar(dc));
  const u = E.clone().sub(P0).divideScalar(l1);
  const f = Tc.clone().sub(E).divideScalar(l2);

  // upper bone frame: local -Y along the bone, local Z toward the knee (legs) or away from the elbow (arms)
  const Y = u.clone().negate();
  let Z = perp(pa, u);
  if (Z.length() < 1e-6) Z = perp(new Vector3(1, 0, 0), u);
  Z.normalize().multiplyScalar(s);
  const X = new Vector3().crossVectors(Y, Z);
  let upperWorld = new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(X, Y, Z));
  if (h < 1e-6 && opts.pole === undefined && opts.poleAngle === undefined) {
    // fully extended: the bend plane is undefined, so keep the current twist (smallest rotation) instead of a pole-derived one
    const cur = F[j0].q;
    const curDir = new Vector3(0, -1, 0).applyQuaternion(cur);
    upperWorld = new Quaternion().setFromUnitVectors(curDir, u).multiply(cur);
  }
  const upperLocal = F[parent].q.clone().invert().multiply(upperWorld);

  const bend = Math.acos(Math.max(-1, Math.min(1, u.dot(f))));
  const midEuler: Vec3 = [s * bend * R2D, 0, 0];

  const joints: Partial<Record<JointName, Vec3>> = { [j0]: toEuler(upperLocal), [j1]: midEuler };
  if (opts.keepEnd ?? isLeg(limb)) {
    const midWorld = upperWorld.clone().multiply(eulerQ(midEuler));
    joints[j2] = toEuler(midWorld.invert().multiply(F[j2].q));
  }
  const end = E.clone().add(f.clone().multiplyScalar(l2));
  return { joints, reached: end.distanceTo(target) < 1e-3, extended: dist > l1 + l2 - 1e-9, end };
}

const wrap = (a: number, lo: number, hi: number): number => {
  for (const k of [0, -360, 360]) if (a + k >= lo - 1e-9 && a + k <= hi + 1e-9) return a + k;
  return a;
};
/** Euler XYZ has two equivalent representations of the same rotation; pick the one that violates the joint limits least. */
export function fitEuler(joint: JointName, e: Vec3): Vec3 {
  const d = RIG_BY_NAME[joint];
  const cost = (v: Vec3) => v.reduce((acc, n, i) => acc + Math.max(0, d.min[i] - n, n - d.max[i]), 0);
  const w = (v: Vec3): Vec3 => [wrap(v[0], d.min[0], d.max[0]), wrap(v[1], d.min[1], d.max[1]), wrap(v[2], d.min[2], d.max[2])];
  const a = w(e);
  const b = w([e[0] + 180, 180 - e[1], e[2] + 180]);
  return cost(b) < cost(a) - 1e-9 ? b : a;
}

/** Clamp solver output to the rig's joint limits. Returns the clamped joints and whether anything was clamped. */
export function clampJoints(joints: Partial<Record<JointName, Vec3>>): { joints: Partial<Record<JointName, Vec3>>; clamped: boolean } {
  const out: Partial<Record<JointName, Vec3>> = {};
  let clamped = false;
  for (const [j, v] of Object.entries(joints) as [JointName, Vec3][]) {
    const c = clampRotation(j, fitEuler(j, v));
    if (c.some((n, i) => Math.abs(n - fitEuler(j, v)[i]) > 1e-6)) clamped = true;
    out[j] = c;
  }
  return { joints: out, clamped };
}

const round = (n: number) => Math.round(n * 1e4) / 1e4;

/** Solve a limb toward a WORLD target and return clamped, rounded joint rotations. */
export function reachWorld(o: SceneObject, limb: Limb, worldTarget: Vec3, opts: { pole?: Vec3; poleAngle?: number; keepEnd?: boolean } = {}) {
  const local = worldToLocal(o, worldTarget);
  const pole = opts.pole ? worldToLocal(o, opts.pole) : undefined;
  const r = solveLimb(o.pose, o.hipsPos, limb, local, { pole, poleAngle: opts.poleAngle, keepEnd: opts.keepEnd, profile: profileOf(o) });
  const c = clampJoints(r.joints);
  const joints: Partial<Record<JointName, Vec3>> = {};
  for (const [j, v] of Object.entries(c.joints) as [JointName, Vec3][]) joints[j] = [round(v[0]), round(v[1]), round(v[2])];
  return { joints, reached: r.reached && !c.clamped, extended: r.extended, clamped: c.clamped };
}

export const hasPins = (o: Pick<SceneObject, 'pins'>) => !!o.pins && (o.pins.L_foot !== undefined || o.pins.R_foot !== undefined);

/** Re-solve every pinned leg so the ankle stays at its pinned world position. Returns the same object when nothing is pinned. */
export function applyPins(o: SceneObject): SceneObject {
  if (o.kind !== 'mannequin' || !hasPins(o)) return o;
  const pins: Pins = o.pins;
  let pose = o.pose;
  for (const foot of ['L_foot', 'R_foot'] as FootName[]) {
    const w = pins[foot];
    if (!w) continue;
    const r = reachWorld({ ...o, pose }, FOOT_LIMB[foot], w);
    pose = { ...pose, ...r.joints };
  }
  return { ...o, pose };
}

/** Height of a contact joint's center above the floor surface it rests on (meters, rig units of the body). */
export function contactClearance(c: GroundContact, profile: BodyProfile): number {
  if (c.kind === 'sole') return profile.ankleHeight;
  if (c.kind === 'hand') return 0.03 * profile.mesh[c.joint];
  return RIG_BY_NAME[c.joint].ball * profile.mesh[c.joint];
}

/** Heights above the floor of the contact points of a pose (hips translation included). */
export function contactHeights(pose: Pose, hipsPos: Vec3, profile: BodyProfile, contacts: GroundContact[]): number[] {
  const F = fk(pose, hipsPos, profile);
  return contacts.map((c) => F[c.joint].p.y - contactClearance(c, profile));
}

/** hipsPos (adult units) that puts the lowest contact exactly on the floor; x and z are kept. */
export function groundHipsPos(pose: Pose, hipsPos: Vec3, profile: BodyProfile, contacts: GroundContact[]): Vec3 {
  const low = Math.min(...contactHeights(pose, [hipsPos[0], 0, hipsPos[2]], profile, contacts));
  return [hipsPos[0], Math.round((-low / profile.hipsScale) * 1e4) / 1e4, hipsPos[2]];
}
