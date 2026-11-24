import { applyPins, hasPins } from './ik';
import { isJoint, JOINTS } from './rig';
import type { BezierEasing, Easing, Keyframe, NamedEasing, Project, SceneObject, Vec3 } from './types';

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

export type Quat = [number, number, number, number];

/** Euler XYZ (degrees) -> quaternion [x,y,z,w] (three.js XYZ convention). */
export function eulerToQuat(e: Vec3): Quat {
  const [x, y, z] = [e[0] * D2R, e[1] * D2R, e[2] * D2R];
  const c1 = Math.cos(x / 2), c2 = Math.cos(y / 2), c3 = Math.cos(z / 2);
  const s1 = Math.sin(x / 2), s2 = Math.sin(y / 2), s3 = Math.sin(z / 2);
  return [
    s1 * c2 * c3 + c1 * s2 * s3,
    c1 * s2 * c3 - s1 * c2 * s3,
    c1 * c2 * s3 + s1 * s2 * c3,
    c1 * c2 * c3 - s1 * s2 * s3,
  ];
}

/** Quaternion -> Euler XYZ (degrees). */
export function quatToEuler(q: Quat): Vec3 {
  const [x, y, z, w] = q;
  const m11 = 1 - 2 * (y * y + z * z);
  const m12 = 2 * (x * y - z * w);
  const m13 = 2 * (x * z + y * w);
  const m22 = 1 - 2 * (x * x + z * z);
  const m23 = 2 * (y * z - x * w);
  const m32 = 2 * (y * z + x * w);
  const m33 = 1 - 2 * (x * x + y * y);
  const ey = Math.asin(Math.max(-1, Math.min(1, m13)));
  let ex: number, ez: number;
  if (Math.abs(m13) < 0.9999999) {
    ex = Math.atan2(-m23, m33);
    ez = Math.atan2(-m12, m11);
  } else {
    ex = Math.atan2(m32, m22);
    ez = 0;
  }
  return [ex * R2D, ey * R2D, ez * R2D];
}

export function slerp(a: Quat, b: Quat, t: number): Quat {
  let [bx, by, bz, bw] = b;
  let dot = a[0] * bx + a[1] * by + a[2] * bz + a[3] * bw;
  if (dot < 0) {
    dot = -dot;
    bx = -bx; by = -by; bz = -bz; bw = -bw;
  }
  let s0: number, s1: number;
  if (dot > 0.9995) {
    s0 = 1 - t;
    s1 = t;
  } else {
    const th = Math.acos(dot);
    const sin = Math.sin(th);
    s0 = Math.sin((1 - t) * th) / sin;
    s1 = Math.sin(t * th) / sin;
  }
  const r: Quat = [s0 * a[0] + s1 * bx, s0 * a[1] + s1 * by, s0 * a[2] + s1 * bz, s0 * a[3] + s1 * bw];
  const n = Math.hypot(...r) || 1;
  return [r[0] / n, r[1] / n, r[2] / n, r[3] / n];
}

/** The named easings expressed as CSS-style cubic beziers (starting point when a curve is edited with handles). */
export const EASING_BEZIER: Record<Exclude<NamedEasing, 'step'>, [number, number, number, number]> = {
  linear: [0, 0, 1, 1],
  easeIn: [0.42, 0, 1, 1],
  easeOut: [0, 0, 0.58, 1],
  easeInOut: [0.42, 0, 0.58, 1],
};

/** Bezier control values of an easing (null for step). */
export function easingToBezier(e: Easing): [number, number, number, number] | null {
  if (typeof e === 'object') return e.c;
  return e === 'step' ? null : EASING_BEZIER[e];
}

export const isBezier = (e: Easing): e is BezierEasing => typeof e === 'object' && e !== null && e.type === 'bezier';

/** Validate/normalize an easing coming from outside (command, file). Throws a message string via the callback on error. */
export function parseEasing(v: unknown): Easing | null {
  if (typeof v === 'string') return (['linear', 'easeIn', 'easeOut', 'easeInOut', 'step'] as string[]).includes(v) ? (v as NamedEasing) : null;
  if (v && typeof v === 'object' && (v as BezierEasing).type === 'bezier') {
    const c = (v as BezierEasing).c;
    if (!Array.isArray(c) || c.length !== 4 || c.some((n) => typeof n !== 'number' || !isFinite(n))) return null;
    if (c[0] < 0 || c[0] > 1 || c[2] < 0 || c[2] > 1) return null;
    return { type: 'bezier', c: [c[0], c[1], c[2], c[3]] };
  }
  return null;
}

/** Evaluate a CSS cubic-bezier time curve at normalized time u (x -> y). */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number, u: number): number {
  if (u <= 0) return 0;
  if (u >= 1) return 1;
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx;
  const cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const X = (s: number) => ((ax * s + bx) * s + cx) * s;
  const dX = (s: number) => (3 * ax * s + 2 * bx) * s + cx;
  // Newton from s = u, then bisection fallback
  let s = u;
  for (let i = 0; i < 8; i++) {
    const err = X(s) - u;
    if (Math.abs(err) < 1e-7) return ((ay * s + by) * s + cy) * s;
    const d = dX(s);
    if (Math.abs(d) < 1e-6) break;
    s -= err / d;
  }
  let lo = 0, hi = 1;
  s = u;
  for (let i = 0; i < 40; i++) {
    const x = X(s);
    if (Math.abs(x - u) < 1e-7) break;
    if (x < u) lo = s;
    else hi = s;
    s = (lo + hi) / 2;
  }
  return ((ay * s + by) * s + cy) * s;
}

/** Easing of the normalized segment parameter u in [0,1]. */
export function ease(e: Easing, u: number): number {
  if (typeof e === 'object') return cubicBezier(e.c[0], e.c[1], e.c[2], e.c[3], u);
  switch (e) {
    case 'step': return u >= 1 ? 1 : 0;
    case 'easeIn': return u * u;
    case 'easeOut': return 1 - (1 - u) * (1 - u);
    case 'easeInOut': return u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2;
    default: return u;
  }
}

export function isRotationChannel(ch: string): boolean {
  return ch === 'rotation' || isJoint(ch);
}

/** Sample one track at time t. Returns null for an empty track. Keys must be sorted by t. */
export function sampleTrack(keys: Keyframe[], t: number, rotation: boolean): Vec3 | null {
  const n = keys.length;
  if (n === 0) return null;
  if (t <= keys[0].t) return [...keys[0].value] as Vec3;
  if (t >= keys[n - 1].t) return [...keys[n - 1].value] as Vec3;
  let i = 0;
  while (i < n - 2 && keys[i + 1].t <= t) i++;
  const a = keys[i], b = keys[i + 1];
  const u = (t - a.t) / (b.t - a.t);
  const e = ease(a.easing, u);
  if (e === 0) return [...a.value] as Vec3;
  if (e === 1) return [...b.value] as Vec3;
  if (rotation) return quatToEuler(slerp(eulerToQuat(a.value), eulerToQuat(b.value), e));
  return [
    a.value[0] + (b.value[0] - a.value[0]) * e,
    a.value[1] + (b.value[1] - a.value[1]) * e,
    a.value[2] + (b.value[2] - a.value[2]) * e,
  ];
}

/** All animatable channels of an object. */
export function channelsFor(obj: SceneObject): string[] {
  if (obj.kind === 'camera') return ['position', 'target', 'fov'];
  const base = ['position', 'rotation', 'scale'];
  return obj.kind === 'mannequin' ? [...base, 'hipsPos', ...JOINTS] : base;
}

export function isChannel(obj: SceneObject, ch: string): boolean {
  return channelsFor(obj).includes(ch);
}

export function getChannel(obj: SceneObject, ch: string): Vec3 {
  if (ch === 'fov') return [obj.fov, 0, 0];
  if (ch === 'position' || ch === 'rotation' || ch === 'scale' || ch === 'hipsPos' || ch === 'target') return [...obj[ch]] as Vec3;
  return [...obj.pose[ch as keyof SceneObject['pose']]] as Vec3;
}

export function setChannel(obj: SceneObject, ch: string, v: Vec3): SceneObject {
  if (ch === 'fov') return { ...obj, fov: v[0] };
  if (ch === 'position' || ch === 'rotation' || ch === 'scale' || ch === 'hipsPos' || ch === 'target') return { ...obj, [ch]: v };
  return { ...obj, pose: { ...obj.pose, [ch]: v } };
}

/** Return the object with every keyed channel overwritten by its sampled value at t (pinned feet are then re-solved). */
export function evaluateObject(obj: SceneObject, t: number): SceneObject {
  let out = obj;
  for (const ch of Object.keys(obj.tracks)) {
    const v = sampleTrack(obj.tracks[ch], t, isRotationChannel(ch));
    if (v) out = setChannel(out, ch, v);
  }
  return hasPins(out) ? applyPins(out) : out;
}

/** Evaluate every object at t, or only the ones in `only` (ids or names) and leave the rest as they are. */
export function evaluateProject(p: Project, t: number = p.time, only?: ReadonlySet<string>): Project {
  let changed = false;
  const objects = p.objects.map((o) => {
    if (only && !only.has(o.id) && !only.has(o.name)) return o;
    if (Object.keys(o.tracks).length === 0 && !hasPins(o)) return o;
    changed = true;
    return evaluateObject(o, t);
  });
  return changed ? { ...p, objects } : p;
}
