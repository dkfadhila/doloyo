import { BufferGeometry, CapsuleGeometry, LatheGeometry, Quaternion, SphereGeometry, SplineCurve, Vector2, Vector3 } from 'three';
import type { JointName, Vec3 } from '../core/types';

/** One visual piece of the procedural art doll, in the local frame of its joint. */
export interface DollPart {
  geo: BufferGeometry;
  pos: Vec3;
  quat?: [number, number, number, number];
  scale?: Vec3;
}

/** Smooth lathe from a coarse (radius, y) profile; the profile is splined so there are no visible kinks. */
function lathe(profile: [number, number][], segments = 28, samples = 28): BufferGeometry {
  const pts = new SplineCurve(profile.map(([r, y]) => new Vector2(r, y))).getPoints(samples).map((p) => new Vector2(Math.max(0, p.x), p.y));
  if (pts[0].y > pts[pts.length - 1].y) pts.reverse(); // ascending y gives outward-facing triangles
  pts[0].x = 0;
  pts[pts.length - 1].x = 0;
  return new LatheGeometry(pts, segments);
}

/** Tapered limb segment hanging down from the joint (0 .. -len), radius r0 at the top and r1 at the bottom. */
function taper(r0: number, r1: number, len: number, bulge = 1.04): BufferGeometry {
  return lathe([
    [0, 0.002],
    [r0 * 0.78, -len * 0.015],
    [r0, -len * 0.1],
    [((r0 + r1) / 2) * bulge, -len * 0.5],
    [r1, -len * 0.92],
    [r1 * 0.72, -len * 0.99],
    [0, -len - 0.002],
  ]);
}

const sphere = (r: number) => new SphereGeometry(r, 20, 14);
const along = (from: Vec3, to: Vec3): [number, number, number, number] => {
  const q = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), new Vector3(...to).sub(new Vector3(...from)).normalize());
  return [q.x, q.y, q.z, q.w];
};

let cache: Record<JointName, DollPart[]> | null = null;

/** Joints that show a visible ball (art-doll joint) at their pivot. */
export const BALL_JOINTS = new Set<JointName>(['neck', 'L_shoulder', 'R_shoulder', 'L_elbow', 'R_elbow', 'L_wrist', 'R_wrist', 'L_hip', 'R_hip', 'L_knee', 'R_knee', 'L_ankle', 'R_ankle']);

function mitten(side: 1 | -1): DollPart[] {
  return [
    // palm + fingers as one rounded paddle
    { geo: lathe([[0, 0.002], [0.026, -0.004], [0.039, -0.03], [0.04, -0.06], [0.03, -0.088], [0.012, -0.102], [0, -0.106]], 20), pos: [0, 0, 0], scale: [1, 1, 0.5] },
    // thumb stub, pointing forward-down on the inner side
    { geo: new CapsuleGeometry(0.0125, 0.035, 4, 10), pos: [-side * 0.03, -0.035, 0.016], quat: along([0, 0, 0], [-side * 0.3, -1, 0.5]) },
  ];
}

function foot(): DollPart[] {
  return [
    // rounded wedge pointing forward, flattened
    { geo: new CapsuleGeometry(0.034, 0.1, 6, 14), pos: [0, -0.045, 0.075], quat: along([0, 0, 0], [0, 0.02, 1]), scale: [1.15, 0.8, 1] },
  ];
}

export function dollParts(): Record<JointName, DollPart[]> {
  if (cache) return cache;
  const limbArm = (s: 1 | -1): Record<string, DollPart[]> => ({
    shoulder: [{ geo: taper(0.048, 0.04, 0.29), pos: [0, 0, 0] }],
    elbow: [{ geo: taper(0.04, 0.031, 0.26), pos: [0, 0, 0] }],
    wrist: mitten(s),
  });
  const limbLeg = (): Record<string, DollPart[]> => ({
    hip: [{ geo: taper(0.068, 0.05, 0.42, 1.06), pos: [0, 0, 0] }],
    knee: [{ geo: taper(0.052, 0.036, 0.4, 1.12), pos: [0, 0, 0] }],
    ankle: foot(),
  });
  const parts = {} as Record<JointName, DollPart[]>;
  parts.hips = [
    { geo: lathe([[0, -0.115], [0.06, -0.11], [0.105, -0.075], [0.122, -0.015], [0.115, 0.05], [0.095, 0.1], [0, 0.108]]), pos: [0, 0, 0], scale: [1.18, 1, 0.82] },
  ];
  parts.spine = [
    { geo: lathe([[0, -0.01], [0.095, 0.0], [0.088, 0.07], [0.078, 0.12], [0.088, 0.19], [0.1, 0.23], [0, 0.235]]), pos: [0, 0, 0], scale: [1.2, 1, 0.82] },
  ];
  parts.chest = [
    { geo: lathe([[0, -0.03], [0.09, -0.02], [0.118, 0.04], [0.135, 0.12], [0.128, 0.2], [0.09, 0.26], [0.045, 0.295], [0, 0.31]]), pos: [0, 0, 0], scale: [1.22, 1, 0.78] },
  ];
  parts.neck = [{ geo: lathe([[0, -0.002], [0.032, 0.002], [0.036, 0.05], [0.031, 0.097], [0, 0.102]]), pos: [0, 0, 0] }];
  parts.head = [
    {
      geo: lathe([[0, -0.012], [0.04, -0.004], [0.072, 0.03], [0.092, 0.09], [0.093, 0.15], [0.072, 0.205], [0.04, 0.232], [0, 0.24]], 32, 36),
      pos: [0, 0, 0.005],
      scale: [1, 1, 1.04],
    },
  ];
  const L = { ...limbArm(1), ...limbLeg() };
  const R = { ...limbArm(-1), ...limbLeg() };
  for (const k of Object.keys(L)) {
    parts[`L_${k}` as JointName] = L[k];
    parts[`R_${k}` as JointName] = R[k];
  }
  cache = parts;
  return parts;
}

const balls: Record<number, BufferGeometry> = {};
export function ballGeometry(r: number): BufferGeometry {
  return (balls[r] ??= sphere(r));
}
