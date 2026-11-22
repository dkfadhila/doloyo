import type { JointName, Pose, Vec3 } from './types';

export interface Seg {
  from?: Vec3;
  to: Vec3;
  radius: number;
  sx?: number;
  sz?: number;
}
export interface JointDef {
  name: JointName;
  parent: JointName | null;
  offset: Vec3; // rest offset in parent space (meters)
  min: Vec3; // degrees
  max: Vec3;
  ball: number; // joint sphere radius
  segs: Seg[];
  ovoid?: { center: Vec3; radii: Vec3 }; // head
}

type Side = { min: Vec3; max: Vec3 };
const mirrorLimits = (l: Side): Side => ({
  min: [l.min[0], -l.max[1] || 0, -l.max[2] || 0],
  max: [l.max[0], -l.min[1] || 0, -l.min[2] || 0],
});

const shoulder: Side = { min: [-180, -90, -30], max: [60, 90, 180] };
const elbow: Side = { min: [-150, -90, -5], max: [0, 90, 5] };
const wrist: Side = { min: [-70, -45, -30], max: [70, 45, 30] };
const hip: Side = { min: [-120, -45, -20], max: [30, 45, 45] };
const knee: Side = { min: [0, 0, 0], max: [150, 0, 0] };
const ankle: Side = { min: [-45, -30, -25], max: [45, 30, 25] };

function limb(side: 'L' | 'R', s: number): JointDef[] {
  const m = (l: Side) => (side === 'L' ? l : mirrorLimits(l));
  const n = (j: string) => `${side}_${j}` as JointName;
  return [
    { name: n('shoulder'), parent: 'chest', offset: [0.19 * s, 0.2, 0], ...m(shoulder), ball: 0.058, segs: [{ to: [0, -0.29, 0], radius: 0.047 }] },
    { name: n('elbow'), parent: n('shoulder'), offset: [0, -0.29, 0], ...m(elbow), ball: 0.045, segs: [{ to: [0, -0.26, 0], radius: 0.04 }] },
    { name: n('wrist'), parent: n('elbow'), offset: [0, -0.26, 0], ...m(wrist), ball: 0.033, segs: [{ to: [0, -0.09, 0], radius: 0.034, sx: 1.2, sz: 0.6 }] },
    { name: n('hip'), parent: 'hips', offset: [0.09 * s, -0.05, 0], ...m(hip), ball: 0.07, segs: [{ to: [0, -0.42, 0], radius: 0.065 }] },
    { name: n('knee'), parent: n('hip'), offset: [0, -0.42, 0], ...m(knee), ball: 0.052, segs: [{ to: [0, -0.4, 0], radius: 0.05 }] },
    { name: n('ankle'), parent: n('knee'), offset: [0, -0.4, 0], ...m(ankle), ball: 0.04, segs: [{ to: [0, -0.04, 0.15], radius: 0.036, sx: 1.2 }] },
  ];
}

/** Parents always precede children. */
export const RIG: JointDef[] = [
  { name: 'hips', parent: null, offset: [0, 0.95, 0], min: [-180, -180, -180], max: [180, 180, 180], ball: 0.09, segs: [{ from: [-0.09, -0.05, 0], to: [0.09, -0.05, 0], radius: 0.075 }, { to: [0, 0.1, 0], radius: 0.11, sx: 1.2, sz: 0.85 }] },
  { name: 'spine', parent: 'hips', offset: [0, 0.1, 0], min: [-30, -30, -25], max: [45, 30, 25], ball: 0.08, segs: [{ to: [0, 0.22, 0], radius: 0.105, sx: 1.2, sz: 0.85 }] },
  { name: 'chest', parent: 'spine', offset: [0, 0.22, 0], min: [-20, -35, -20], max: [35, 35, 20], ball: 0.09, segs: [{ to: [0, 0.2, 0], radius: 0.12, sx: 1.25, sz: 0.85 }, { from: [-0.19, 0.2, 0], to: [0.19, 0.2, 0], radius: 0.045 }] },
  { name: 'neck', parent: 'chest', offset: [0, 0.28, 0], min: [-30, -60, -30], max: [40, 60, 30], ball: 0.04, segs: [{ to: [0, 0.08, 0], radius: 0.038 }] },
  { name: 'head', parent: 'neck', offset: [0, 0.1, 0], min: [-40, -70, -35], max: [40, 70, 35], ball: 0.03, segs: [], ovoid: { center: [0, 0.11, 0.005], radii: [0.085, 0.11, 0.095] } },
  ...limb('L', 1),
  ...limb('R', -1),
];

export const JOINTS: JointName[] = RIG.map((j) => j.name);
export const RIG_BY_NAME = Object.fromEntries(RIG.map((j) => [j.name, j])) as Record<JointName, JointDef>;
export const CHILDREN: Record<string, JointName[]> = {};
for (const j of RIG) if (j.parent) (CHILDREN[j.parent] ||= []).push(j.name);

export function isJoint(n: string): n is JointName {
  return n in RIG_BY_NAME;
}

export function emptyPose(): Pose {
  return Object.fromEntries(JOINTS.map((j) => [j, [0, 0, 0] as Vec3])) as Pose;
}

export function clampRotation(joint: JointName, r: Vec3): Vec3 {
  const d = RIG_BY_NAME[joint];
  return [0, 1, 2].map((i) => Math.min(d.max[i], Math.max(d.min[i], r[i]))) as Vec3;
}

export function mirrorJointName(j: JointName): JointName {
  if (j.startsWith('L_')) return ('R_' + j.slice(2)) as JointName;
  if (j.startsWith('R_')) return ('L_' + j.slice(2)) as JointName;
  return j;
}

/** Mirror across the YZ plane: rx stays, ry and rz flip. */
export function mirrorRotation(r: Vec3): Vec3 {
  return [r[0], -r[1] || 0, -r[2] || 0];
}
