/**
 * Body-size presets and the proportion profile derived from them. Pure data and math (no three imports).
 *
 * The canonical rig (rig.ts) describes the ADULT. A profile holds, per joint, the factors that turn the adult rest
 * offsets into the offsets of a smaller (or finer-tuned) body, so FK, IK, foot pins, pick volumes, GLB/BVH export and
 * the skinned characters all read the same numbers. Pose data stays rotations, so every clip, key and mocap result
 * works on any body unchanged.
 *
 * hipsPos (the hips translation channel) is stored in ADULT rig units. When a pose is evaluated it is multiplied by
 * `profile.hipsScale` (hips height of the body / adult hips height), so a jump or crouch keeps the feet on the floor.
 *
 * Content rule: kecil and pendek are neutral art mannequins built on the neutral (male) mannequin mesh for both
 * genders; gender only nudges the shoulder width. remaja also uses the neutral mesh. Only dewasa uses the female mesh.
 */
import { RIG } from './rig';
import type { BodyPreset, BodySpec, Gender, JointName, SceneObject, Vec3 } from './types';
import { BODY_PRESETS } from './types';

export const BODY_LABEL: Record<BodyPreset, string> = { kecil: 'Bayi / Kecil', pendek: 'Anak', remaja: 'Remaja', dewasa: 'Dewasa' };
/** Short label for the segmented control. */
export const BODY_SHORT: Record<BodyPreset, string> = { kecil: 'Bayi', pendek: 'Anak', remaja: 'Remaja', dewasa: 'Dewasa' };
export const BODY_HINT: Record<BodyPreset, string> = {
  kecil: 'Baby, about 12 months, 0.75 m',
  pendek: 'Child, about 6-7 years, 1.20 m',
  remaja: 'Teenager, about 15 years, 1.62 m',
  dewasa: 'Adult, 1.75 m (F 1.65 m)',
};

export const HEIGHT_SCALE_MIN = 0.9;
export const HEIGHT_SCALE_MAX = 1.1;
export const ADULT_HEIGHT = { m: 1.75, f: 1.65 };
const PRESET_HEIGHT: Record<BodyPreset, { m: number; f: number }> = {
  kecil: { m: 0.75, f: 0.75 },
  pendek: { m: 1.2, f: 1.2 },
  remaja: { m: 1.62, f: 1.58 },
  dewasa: { m: 1.75, f: 1.65 },
};

/** Adult rig dimensions used by the profile maths (meters). */
const A = { ankle: 0.08, legChain: 0.87, torso: 0.6, neck: 0.1, head: 0.22 };
export const ADULT_RIG_HEIGHT = 0.95 + A.torso + A.neck + A.head;

/** Raw proportions of a preset relative to the adult (normalised to the preset height afterwards). */
interface Shape {
  leg: number; foot: number; torso: number; neck: number; head: number; arm: number; shoulder: number; hip: number;
  /** Chubbiness: limbs and torso are thicker than their length alone would give (mesh scale = length ^ (1 - chub)). */
  chub: number;
}
const SHAPE: Record<BodyPreset, Shape> = {
  kecil: { leg: 0.33, foot: 0.55, torso: 0.44, neck: 0.45, head: 0.88, arm: 0.5, shoulder: 0.55, hip: 0.6, chub: 0.15 },
  pendek: { leg: 0.62, foot: 0.75, torso: 0.65, neck: 0.8, head: 0.97, arm: 0.68, shoulder: 0.68, hip: 0.7, chub: 0.05 },
  remaja: { leg: 0.93, foot: 0.93, torso: 0.92, neck: 0.95, head: 1, arm: 0.93, shoulder: 0.9, hip: 0.93, chub: 0 },
  dewasa: { leg: 1, foot: 1, torso: 1, neck: 1, head: 1, arm: 1, shoulder: 1, hip: 1, chub: 0 },
};

export interface BodyProfile {
  preset: BodyPreset;
  heightScale: number;
  gender: Gender;
  /** Nominal standing height in meters (what the UI shows). */
  height: number;
  /** Rig height relative to the adult rig. */
  ratio: number;
  /** Hips height above the floor in the rest pose (meters, rig units). */
  hipsY: number;
  /** hipsPos is multiplied by this (hips height / adult hips height). */
  hipsScale: number;
  /** Ankle joint height above the floor / sole (meters). */
  ankleHeight: number;
  /** Segment factors (1 = adult). */
  f: { leg: number; foot: number; torso: number; neck: number; head: number; arm: number; shoulder: number; hip: number };
  /** Per-axis factor of each joint's rest offset (parent space). */
  axis: Record<JointName, Vec3>;
  /** Rest offset of each joint in parent space (meters). */
  offset: Record<JointName, Vec3>;
  /** Uniform scale of the volume attached to each joint (limb/torso girth follows length, a bit more for chubby bodies). */
  mesh: Record<JointName, number>;
  /** True when this is the unmodified adult (every factor 1). */
  identity: boolean;
}

export const clampHeightScale = (v: number) => Math.min(HEIGHT_SCALE_MAX, Math.max(HEIGHT_SCALE_MIN, v));

function buildProfile(preset: BodyPreset, heightScale: number, gender: Gender): BodyProfile {
  const sh = SHAPE[preset];
  const hs = clampHeightScale(heightScale);
  const heights = PRESET_HEIGHT[preset];
  const ratio = (preset === 'dewasa' ? 1 : preset === 'remaja' ? heights[gender] / ADULT_HEIGHT[gender] : heights.m / ADULT_HEIGHT.m) * hs;
  const height = (preset === 'dewasa' || preset === 'remaja' ? heights[gender] : heights.m) * hs;

  // normalise the shape so the total rig height is exactly ratio * adult height
  const hips0 = A.ankle * sh.foot + A.legChain * sh.leg;
  const raw = hips0 + A.torso * sh.torso + A.neck * sh.neck + A.head * sh.head;
  const fit = (ratio * ADULT_RIG_HEIGHT) / raw;
  // gender: shoulder width only, subtle (kids) or a bit more for teenagers
  const gShoulder = gender === 'f' ? (preset === 'remaja' ? 0.94 : preset === 'dewasa' ? 1 : 0.96) : 1;
  const f = {
    leg: sh.leg * fit, foot: sh.foot * fit, torso: sh.torso * fit, neck: sh.neck * fit, head: sh.head * fit,
    arm: sh.arm * fit, shoulder: sh.shoulder * fit * gShoulder, hip: sh.hip * fit,
  };
  const hipsY = A.ankle * f.foot + A.legChain * f.leg;
  const hipsScale = hipsY / 0.95;
  const chubby = (x: number) => Math.pow(x, 1 - sh.chub);

  const axis = {} as Record<JointName, Vec3>;
  const set = (j: JointName, v: Vec3) => (axis[j] = v);
  set('hips', [1, hipsScale, 1]);
  set('spine', [f.torso, f.torso, f.torso]);
  set('chest', [f.torso, f.torso, f.torso]);
  set('neck', [f.torso, f.torso, f.torso]);
  set('head', [f.neck, f.neck, f.neck]);
  for (const s of ['L', 'R'] as const) {
    set(`${s}_shoulder` as JointName, [f.shoulder, f.torso, 1]);
    set(`${s}_elbow` as JointName, [f.arm, f.arm, f.arm]);
    set(`${s}_wrist` as JointName, [f.arm, f.arm, f.arm]);
    set(`${s}_hip` as JointName, [f.hip, f.leg, 1]);
    set(`${s}_knee` as JointName, [f.leg, f.leg, f.leg]);
    set(`${s}_ankle` as JointName, [f.leg, f.leg, f.leg]);
  }
  const offset = {} as Record<JointName, Vec3>;
  for (const d of RIG) offset[d.name] = [d.offset[0] * axis[d.name][0], d.offset[1] * axis[d.name][1], d.offset[2] * axis[d.name][2]];

  const mesh = {} as Record<JointName, number>;
  mesh.hips = chubby(f.hip);
  mesh.spine = mesh.chest = chubby(f.torso);
  mesh.neck = chubby(f.neck);
  mesh.head = f.head;
  for (const s of ['L', 'R']) {
    mesh[`${s}_shoulder` as JointName] = mesh[`${s}_elbow` as JointName] = mesh[`${s}_wrist` as JointName] = chubby(f.arm);
    mesh[`${s}_hip` as JointName] = mesh[`${s}_knee` as JointName] = chubby(f.leg);
    mesh[`${s}_ankle` as JointName] = chubby(f.foot);
  }
  const identity = Object.values(f).every((v) => Math.abs(v - 1) < 1e-9);
  return { preset, heightScale: hs, gender, height, ratio, hipsY, hipsScale, ankleHeight: A.ankle * f.foot, f, axis, offset, mesh, identity };
}

const cache = new Map<string, BodyProfile>();
export function bodyProfile(preset: BodyPreset = 'dewasa', heightScale = 1, gender: Gender = 'm'): BodyProfile {
  const hs = Math.round(clampHeightScale(heightScale) * 1000) / 1000;
  const key = `${preset}|${hs}|${gender}`;
  let p = cache.get(key);
  if (!p) cache.set(key, (p = buildProfile(preset, hs, gender)));
  return p;
}

/** The unmodified adult profile (the canonical rig). */
export const ADULT: BodyProfile = bodyProfile('dewasa', 1, 'm');

export const isBodyPreset = (v: unknown): v is BodyPreset => typeof v === 'string' && (BODY_PRESETS as readonly string[]).includes(v);

/** Gender of an object: explicit body.gender, else from the character id (...-f / ...-m). */
export function genderOf(o: Pick<SceneObject, 'character' | 'body'>): Gender {
  return o.body?.gender ?? (/-f$/.test(o.character) ? 'f' : 'm');
}

/** Profile of a mannequin (adult when it has no body). */
export function profileOf(o: Pick<SceneObject, 'character' | 'body'>): BodyProfile {
  const b = o.body;
  if (!b) return ADULT;
  return bodyProfile(b.preset, b.heightScale ?? 1, genderOf(o));
}

/** Validate and clean a body spec from outside (command input, loaded project). Returns undefined for "adult, 1". */
export function cleanBody(raw: unknown): BodySpec | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Partial<BodySpec>;
  if (!isBodyPreset(r.preset)) return undefined;
  const out: BodySpec = { preset: r.preset };
  if (typeof r.heightScale === 'number' && isFinite(r.heightScale) && Math.abs(r.heightScale - 1) > 1e-6) out.heightScale = clampHeightScale(r.heightScale);
  if (r.gender === 'm' || r.gender === 'f') out.gender = r.gender;
  return out;
}

/** True for the built-in superhero characters, which only exist as teen/adult bodies. */
export const isSuperhero = (character: string) => character.startsWith('superhero-');
/** True for presets that must not use an adult-shaped mesh. */
export const isChildPreset = (p: BodyPreset) => p === 'kecil' || p === 'pendek';

/**
 * Character to use for a body. Built-in mannequins: dewasa female = mannequin-f, everything else = the neutral
 * mannequin-m mesh. Superheroes keep their kind and only follow the gender. Procedural and imported characters stay.
 */
export function characterForBody(current: string, preset: BodyPreset, gender: Gender): string {
  if (current.startsWith('mannequin-')) return preset === 'dewasa' && gender === 'f' ? 'mannequin-f' : 'mannequin-m';
  if (isSuperhero(current)) return gender === 'f' ? 'superhero-f' : 'superhero-m';
  return current;
}

/** Why a preset cannot be used with a character (or null when it can). */
export function bodyCharacterError(character: string, preset: BodyPreset): string | null {
  if (isSuperhero(character) && isChildPreset(preset)) {
    return `Superhero characters only support the presets remaja and dewasa (got "${preset}"). Use a mannequin or the procedural doll for small bodies.`;
  }
  return null;
}

/** Display height in meters of a body spec for a gender. */
export function bodyHeight(spec: BodySpec | undefined, gender: Gender): number {
  return bodyProfile(spec?.preset ?? 'dewasa', spec?.heightScale ?? 1, spec?.gender ?? gender).height;
}
