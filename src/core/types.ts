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
export type ObjectKind = 'mannequin' | 'cube' | 'sphere' | 'cylinder' | 'camera' | 'image';
export const OBJECT_KINDS: ObjectKind[] = ['mannequin', 'cube', 'sphere', 'cylinder', 'camera', 'image'];

/** How a background image fills its frame: fit = whole image visible, fill = covers the frame, center = original pixel size. */
export type ImageFit = 'fit' | 'fill' | 'center';
export const IMAGE_FITS: ImageFit[] = ['fit', 'fill', 'center'];
export type ImageMode = 'background' | 'plane' | 'camera';
export const IMAGE_MODES: ImageMode[] = ['background', 'plane', 'camera'];
export type BackdropSlot = 'viewport' | 'camera';
/** Data of an image plane object (kind "image"). The plane is `aspect` m wide and 1 m high before the object scale. */
export interface ImagePlane {
  imageId: string;
  /** width / height of the picture. */
  aspect: number;
  opacity: number;
  doubleSided: boolean;
  /** Not selectable in the viewport (still listed in the outliner). */
  locked: boolean;
  /** Drawn in snapshots, exports and GLB. */
  inRender: boolean;
  /** Always turns to face the camera (rotation is ignored). */
  billboard: boolean;
}
/** Image behind the scene: slot "viewport" = screen space, "camera" = locked to the render camera frame. */
export interface ImageBackdrop {
  imageId: string;
  name: string;
  aspect: number;
  opacity: number;
  visible: boolean;
  inRender: boolean;
  fit: ImageFit;
}

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

/** Body-size presets: kecil = baby/toddler, pendek = child (~6-7 years), remaja = teenager, dewasa = adult (default look). */
export const BODY_PRESETS = ['kecil', 'pendek', 'remaja', 'dewasa'] as const;
export type BodyPreset = (typeof BODY_PRESETS)[number];
export type Gender = 'm' | 'f';
export interface BodySpec {
  preset: BodyPreset;
  /** Fine-tune of the preset height, 0.9 .. 1.1 (default 1). */
  heightScale?: number;
  /** Subtle proportion difference only (never chest/hip shape). Default: derived from the character id. */
  gender?: Gender;
}

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
  /** Body size (mannequin only). Missing = dewasa, heightScale 1 (the original proportions). */
  body?: BodySpec;
  /** Render camera only: look-at point (meters) and vertical field of view (degrees). `position` is the eye. */
  target: Vec3;
  fov: number;
  /** Image planes only (kind "image"). */
  image?: ImagePlane;
}

/** A joint that must touch the floor in a grounded pose: ball = the joint ball radius, sole = foot height, hand = palm thickness. */
export interface GroundContact {
  joint: JointName;
  kind: 'ball' | 'sole' | 'hand';
}

/** Pose preset data: joint rotations (degrees) plus optional hips offset. */
export interface PoseData {
  joints: Partial<Record<JointName, Vec3>>;
  hipsPos?: Vec3;
  /**
   * Built-in grounded poses (sitting, crawling): when applied, the hips height is solved from the object's body so the
   * listed joints rest on the floor (the lowest one exactly). The result is plain pose data again (hipsPos).
   */
  ground?: GroundContact[];
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
  /** Reference image behind the viewport (screen space). The picture itself lives in this browser (IndexedDB), by id. */
  background?: ImageBackdrop;
  /** Reference image locked to the render camera frame. */
  cameraBackground?: ImageBackdrop;
}
