/**
 * Character registry. Pure data (no three imports) so core code, tests and the MCP guide can use it.
 * A character is a *view* of the canonical 17-joint pose: procedural geometry, a skinned GLB, or a VRM.
 */
import { BUILTIN_CHARACTER_IDS, CUSTOM_PREFIX, type JointName, type MaterialMode, type Vec3 } from '../core/types';

export type CharacterKind = 'procedural' | 'glb' | 'vrm';

/** Our joint -> bone (node) name in the character file. */
export type BoneMap = Partial<Record<JointName, string>>;

/** A bone driven by a blend of two of our joints (e.g. spine_02 = halfway between spine and chest). */
export interface BlendBone {
  bone: string;
  from: JointName;
  to: JointName;
  t: number;
}
/** A bone that follows the chest and takes a small share of the shoulder swing (clavicle). */
export interface ShareBone {
  bone: string;
  joint: JointName;
  share: number;
}

/** Tweakable per-character calibration. Everything here is optional and safe to leave empty. */
export interface Calibration {
  /** Extra rotation (Euler XYZ degrees) per OUR joint, applied in that joint's own frame after the automatic alignment. */
  jointOffsets?: Partial<Record<JointName, Vec3>>;
  /** Distance child hints: bone whose position defines the bone direction for wrist/ankle/head style leaf joints. */
  childHints?: Partial<Record<JointName, string>>;
  /** Extra uniform scale on top of the automatic height fit. */
  scaleMul?: number;
  /** Move the whole character vertically (meters, in our rig units). */
  yOffset?: number;
  /** Extra yaw (degrees) on top of the automatic facing detection. */
  yaw?: number;
  /** Secondary bones driven by blends. */
  blends?: BlendBone[];
  /** Clavicle-like bones. */
  shares?: ShareBone[];
}

export interface CharacterDef {
  id: string;
  label: string;
  kind: CharacterKind;
  /** URL relative to the site base (built-ins) or empty for imported characters (stored in IndexedDB). */
  url: string;
  bones: BoneMap;
  defaultMaterial: MaterialMode;
  calibration: Calibration;
  /** Imported characters only. */
  custom?: boolean;
}

/** Unreal-style skeleton shared by every Quaternius asset (mannequins, superheroes, animation libraries). */
export const QUATERNIUS_BONES: BoneMap = {
  hips: 'pelvis',
  spine: 'spine_01',
  chest: 'spine_03',
  neck: 'neck_01',
  head: 'Head',
  L_shoulder: 'upperarm_l', L_elbow: 'lowerarm_l', L_wrist: 'hand_l',
  R_shoulder: 'upperarm_r', R_elbow: 'lowerarm_r', R_wrist: 'hand_r',
  L_hip: 'thigh_l', L_knee: 'calf_l', L_ankle: 'foot_l',
  R_hip: 'thigh_r', R_knee: 'calf_r', R_ankle: 'foot_r',
};

export const QUATERNIUS_CALIBRATION: Calibration = {
  childHints: { L_wrist: 'middle_01_l', R_wrist: 'middle_01_r', L_ankle: 'ball_l', R_ankle: 'ball_r' },
  blends: [{ bone: 'spine_02', from: 'spine', to: 'chest', t: 0.5 }],
  shares: [
    { bone: 'clavicle_l', joint: 'L_shoulder', share: 0.12 },
    { bone: 'clavicle_r', joint: 'R_shoulder', share: 0.12 },
  ],
  jointOffsets: {},
};

const base = (import.meta as unknown as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/';
export const assetUrl = (p: string) => base.replace(/\/$/, '') + '/assets/' + p;

const quat = (id: string, label: string, file: string, defaultMaterial: MaterialMode): CharacterDef => ({
  id,
  label,
  kind: 'glb',
  url: assetUrl(`characters/${file}`),
  bones: QUATERNIUS_BONES,
  defaultMaterial,
  calibration: QUATERNIUS_CALIBRATION,
});

export const BUILTIN_CHARACTERS: CharacterDef[] = [
  { id: 'doll-procedural', label: 'Art doll (procedural)', kind: 'procedural', url: '', bones: {}, defaultMaterial: 'doll', calibration: {} },
  quat('mannequin-f', 'Mannequin F', 'mannequin_f.glb', 'doll'),
  quat('mannequin-m', 'Mannequin M', 'mannequin_m.glb', 'doll'),
  quat('superhero-m', 'Superhero M', 'superhero_m.glb', 'original'),
  quat('superhero-f', 'Superhero F', 'superhero_f.glb', 'original'),
];

if (BUILTIN_CHARACTERS.some((c, i) => c.id !== BUILTIN_CHARACTER_IDS[i])) throw new Error('registry and BUILTIN_CHARACTER_IDS out of sync');

/** Imported characters, filled from IndexedDB at startup and by the import dialog. */
const custom = new Map<string, CharacterDef>();
const listeners = new Set<() => void>();

export function registerCustomCharacter(def: CharacterDef): void {
  custom.set(def.id, def);
  listeners.forEach((f) => f());
}
export function unregisterCustomCharacter(id: string): void {
  custom.delete(id);
  listeners.forEach((f) => f());
}
export function onRegistryChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
let version = 0;
onRegistryChange(() => version++);
export const registryVersion = () => version;

export function listCharacters(): CharacterDef[] {
  return [...BUILTIN_CHARACTERS, ...custom.values()];
}

export function getCharacter(id: string): CharacterDef | undefined {
  return BUILTIN_CHARACTERS.find((c) => c.id === id) ?? custom.get(id);
}

export const isCustomId = (id: string) => id.startsWith(CUSTOM_PREFIX);
