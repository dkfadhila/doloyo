export type Vec3 = [number, number, number];
export type NamedEasing = 'linear' | 'easeIn' | 'easeOut' | 'easeInOut' | 'step';
/** Cubic bezier time curve like CSS cubic-bezier(x1, y1, x2, y2); x1 and x2 are in [0, 1]. */
export interface BezierEasing {
  type: 'bezier';
  c: [number, number, number, number];
}
export type Easing = NamedEasing | BezierEasing;
/** Named easings (what the UI dropdown offers; a bezier is "custom"). */
export const EASINGS: NamedEasing[] = ['linear', 'easeIn', 'easeOut', 'easeInOut', 'step'];
export type ObjectKind = 'mannequin' | 'cube' | 'sphere' | 'cylinder' | 'camera';
export const OBJECT_KINDS: ObjectKind[] = ['mannequin', 'cube', 'sphere', 'cylinder', 'camera'];

export type Limb = 'L_arm' | 'R_arm' | 'L_leg' | 'R_leg';
export const LIMBS: Limb[] = ['L_arm', 'R_arm', 'L_leg', 'R_leg'];
export type FootName = 'L_foot' | 'R_foot';
/** World-space position (ankle joint) a foot is pinned to. */
export type Pins = Partial<Record<FootName, Vec3>>;

export type MaterialMode = 'doll' | 'original';
export const MATERIAL_MODES: MaterialMode[] = ['doll', 'original'];
/** Id of the built-in procedural doll (legacy look). */
export const PROCEDURAL_CHARACTER = 'doll-procedural';
/** Character given to NEW mannequins. */
export const DEFAULT_CHARACTER = 'mannequin-f';

export const BUILTIN_CHARACTER_IDS = ['doll-procedural', 'mannequin-f', 'mannequin-m', 'superhero-m', 'superhero-f'];
export const CUSTOM_PREFIX = 'custom:';
export const isCharacterId = (id: unknown): id is string => typeof id === 'string' && (BUILTIN_CHARACTER_IDS.includes(id) || (id.startsWith(CUSTOM_PREFIX) && id.length > CUSTOM_PREFIX.length));

export type JointName =
  | 'hips' | 'spine' | 'chest' | 'neck' | 'head'
  | 'L_shoulder' | 'L_elbow' | 'L_wrist'
  | 'R_shoulder' | 'R_elbow' | 'R_wrist'
  | 'L_hip' | 'L_knee' | 'L_ankle'
  | 'R_hip' | 'R_knee' | 'R_ankle';

export type Joint = JointName;
export type Pose = Record<JointName, Vec3>;

/** Keyframe. `t` is in seconds. `easing` shapes the segment that STARTS at this key. */
export interface Keyframe {
  t: number;
  value: Vec3;
  easing: Easing;
}

/**
 * Channels: 'position' | 'rotation' | 'scale' | 'hipsPos' | <JointName>.
 * Rotation values are Euler XYZ degrees (interpolated through quaternion slerp).
 */
export type Tracks = Record<string, Keyframe[]>;

export interface SceneObject {
  id: string;
  kind: ObjectKind;
  name: string;
  position: Vec3;
  rotation: Vec3; // degrees
  scale: Vec3;
  pose: Pose; // mannequin only (zeros for shapes)
  hipsPos: Vec3; // extra translation of the hips joint (mannequin)
  tracks: Tracks;
  /** Character view driven by the pose (registry id, or 'custom:<id>' for imported files). Mannequin only. */
  character: string;
  /** doll = matte grey art-doll material, original = the character file's own textures. */
  material: MaterialMode;
  /** Pinned feet (world position of the ankle joint). Mannequin only; the legs are solved with IK to keep them there. */
  pins: Pins;
  /** Render camera only: look-at point (meters) and vertical field of view (degrees). `position` is the eye. */
  target: Vec3;
  fov: number;
}

/** Pose preset data: joint rotations (degrees) plus optional hips offset. */
export interface PoseData {
  joints: Partial<Record<JointName, Vec3>>;
  hipsPos?: Vec3;
}

export interface Project {
  version: 1;
  name: string;
  fps: number;
  duration: number; // seconds
  loop: boolean;
  time: number; // playhead, seconds
  objects: SceneObject[];
  /** User-saved poses (name -> pose). Saved with the project. */
  customPoses: Record<string, PoseData>;
}
