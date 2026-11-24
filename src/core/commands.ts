import { bodyCharacterError, characterForBody, cleanBody, clampHeightScale, genderOf, HEIGHT_SCALE_MAX, HEIGHT_SCALE_MIN, isBodyPreset, profileOf } from './body';
import { applyPins, endWorld, FOOT_LIMB, groundHipsPos, hasPins, LEG_FOOT, LIMB_JOINTS, parseLimb, reachWorld } from './ik';
import { channelsFor, evaluateObject, evaluateProject, getChannel, isChannel, parseEasing, setChannel } from './interpolate';
import { POSES, resolvePose } from './poses';
import { clampRotation, emptyPose, isJoint, JOINTS, mirrorJointName, mirrorRotation } from './rig';
import type { BackdropSlot, BodySpec, Easing, Gender, ImageBackdrop, ImageFit, ImageMode, ImagePlane, JointName, Keyframe, Limb, ObjectKind, Pins, Pose, PoseData, Project, SceneObject, Vec3 } from './types';
import { BODY_PRESETS, BUILTIN_CHARACTER_IDS, DEFAULT_CHARACTER, IMAGE_FITS, IMAGE_MODES, isCharacterId, MATERIAL_MODES, OBJECT_KINDS, PROCEDURAL_CHARACTER, type MaterialMode } from './types';

export type Target = string | string[];

/** Reference to one key (or, with target "all", every key at that time) of an object. */
export interface KeyRef {
  object: string;
  target?: Target;
  time?: number;
  frame?: number;
}
export interface KeyEdit extends KeyRef {
  /** Move the key to this time (seconds) / frame. */
  to?: number;
  toFrame?: number;
  /** New value of the channel at this key (for rotation channels: Euler degrees). */
  value?: Vec3;
}
/** One copied key. dt is seconds relative to the first copied key. */
export interface ClipKey {
  channel: string;
  dt: number;
  value: Vec3;
  easing: Easing;
}
export type ScenePreset = 'duo' | 'trio' | 'group5' | 'keluarga';
export const SCENE_PRESETS: Record<ScenePreset, { count: number; spacing: number; label: string }> = {
  duo: { count: 2, spacing: 1.0, label: 'Duo' },
  trio: { count: 3, spacing: 0.95, label: 'Trio' },
  group5: { count: 5, spacing: 0.85, label: 'Group of 5' },
  keluarga: { count: 4, spacing: 0.95, label: 'Family' },
};

/** Members of the "keluarga" preset, left to right: father, child, baby (sitting), mother. */
export const FAMILY: { preset: BodySpec['preset']; gender: Gender; pose?: string }[] = [
  { preset: 'dewasa', gender: 'm' },
  { preset: 'pendek', gender: 'f' },
  { preset: 'kecil', gender: 'm', pose: 'duduk' },
  { preset: 'dewasa', gender: 'f' },
];

/** Display options shared by the three image modes. Not every field applies to every mode (see image_set). */
export interface ImageProps {
  opacity?: number;
  /** Backgrounds only. */
  visible?: boolean;
  fit?: ImageFit;
  /** Image planes only. */
  locked?: boolean;
  billboard?: boolean;
  doubleSided?: boolean;
  /** Plane, background and camera background. */
  inRender?: boolean;
}

export type Command =
  | { type: 'object_add'; kind: ObjectKind; name?: string; id?: string; position?: Vec3; character?: string; body?: BodySpec }
  | { type: 'object_set_character'; object: string; character: string; material?: MaterialMode }
  | { type: 'object_set_body'; object: string; preset?: BodySpec['preset']; heightScale?: number; gender?: Gender }
  | { type: 'body_restore'; object: string; body: BodySpec | null; character: string; pins: Pins } // internal
  | { type: 'object_remove'; object: string }
  | { type: 'object_restore'; object: SceneObject; index: number } // internal (inverse of object_remove)
  | { type: 'object_transform'; object: string; name?: string; position?: Vec3; rotation?: Vec3; scale?: Vec3 }
  | { type: 'joint_set'; object: string; joint: JointName; rotation?: Vec3; position?: Vec3 }
  | { type: 'pose_apply'; object: string; pose: string | PoseData; partial?: boolean }
  | { type: 'pose_save'; object: string; name: string } // saves the object's current pose into project.customPoses
  | { type: 'pose_delete'; name: string }
  | { type: 'pose_lib_restore'; name: string; data: PoseData | null } // internal
  | { type: 'pose_mirror'; object: string; from: 'L' | 'R' }
  | { type: 'joint_reset'; object: string; joint?: JointName }
  | { type: 'key_add'; object: string; target?: Target; time?: number; frame?: number; easing?: Easing; bakePins?: boolean }
  | { type: 'key_remove'; object: string; target?: Target; time?: number; frame?: number }
  | { type: 'key_move'; object: string; target?: Target; time?: number; frame?: number; to?: number; toFrame?: number }
  | { type: 'key_set_easing'; object: string; target?: Target; time?: number; frame?: number; easing: Easing }
  | { type: 'keys_edit'; edits: KeyEdit[] }
  | { type: 'keys_remove'; keys: KeyRef[] }
  | { type: 'keys_paste'; object: string; time?: number; frame?: number; kind?: ObjectKind; clip: ClipKey[] }
  | { type: 'ik_reach'; object: string; limb: Limb | 'L_foot' | 'R_foot'; target: Vec3; pole?: Vec3; poleAngle?: number }
  | { type: 'ik_pin'; object: string; limb: Limb | 'L_foot' | 'R_foot'; pinned: boolean; position?: Vec3 }
  | { type: 'ik_bake'; object: string; start?: number; end?: number; unpin?: boolean }
  | { type: 'camera_set'; object?: string; position?: Vec3; target?: Vec3; fov?: number }
  | { type: 'scene_preset'; preset: ScenePreset; character?: string; clear?: boolean; body?: BodySpec }
  | ({ type: 'image_add'; mode: ImageMode; imageId: string; id?: string; name?: string; aspect?: number; position?: Vec3; rotation?: Vec3; scale?: Vec3 } & ImageProps)
  | ({ type: 'image_set'; object?: string; background?: BackdropSlot; name?: string } & ImageProps)
  | { type: 'image_remove'; object?: string; background?: BackdropSlot }
  | { type: 'image_bg_restore'; slot: BackdropSlot; bg: ImageBackdrop | null } // internal
  | { type: 'pins_restore'; object: string; pins: Pins } // internal
  | { type: 'track_restore'; object: string; channel: string; keys: Keyframe[] } // internal
  | { type: 'timeline_set'; fps?: number; duration?: number; loop?: boolean }
  | { type: 'playhead_seek'; time?: number; frame?: number }
  | { type: 'batch'; commands: Command[] };

/** Commands that exist only as undo inverses; never accept them from outside. */
export const INTERNAL_COMMANDS = ['object_restore', 'track_restore', 'pose_lib_restore', 'pins_restore', 'body_restore', 'image_bg_restore'];

export interface CommandResult {
  project: Project;
  /** Command that undoes this one. null = not undoable (playhead_seek). */
  inverse: Command | null;
  /** Command normalized for exact replay (ids filled in, times explicit). */
  applied: Command;
}

export class CommandError extends Error {}
const fail = (m: string): never => {
  throw new CommandError(m);
};

const KEY_EPS = 1e-3;
const BAD_EASING = 'easing must be linear, easeIn, easeOut, easeInOut, step or {type:"bezier", c:[x1,y1,x2,y2]} with x1, x2 in 0..1';
let counter = 0;
export function uid(): string {
  counter++;
  return 'o' + Date.now().toString(36).slice(-4) + Math.random().toString(36).slice(2, 6) + counter;
}

export const KIND_LABEL: Record<ObjectKind, string> = {
  mannequin: 'Mannequin',
  cube: 'Cube',
  sphere: 'Sphere',
  cylinder: 'Cylinder',
  camera: 'Render Camera',
  image: 'Image',
};

export const CAMERA_DEFAULT = { position: [2.8, 1.6, 3.8] as Vec3, target: [0, 0.9, 0] as Vec3, fov: 40 };

export function createObject(kind: ObjectKind, name: string, id: string, position: Vec3, character?: string, body?: BodySpec): SceneObject {
  return {
    ...(body ? { body } : {}),
    id, kind, name, position,
    rotation: [0, 0, 0], scale: [1, 1, 1],
    pose: emptyPose(), hipsPos: [0, 0, 0], tracks: {},
    character: character ?? (kind === 'mannequin' ? DEFAULT_CHARACTER : PROCEDURAL_CHARACTER),
    material: 'doll',
    pins: {},
    target: [...CAMERA_DEFAULT.target] as Vec3,
    fov: CAMERA_DEFAULT.fov,
  };
}

export function newProject(): Project {
  return {
    version: 1,
    name: 'Untitled',
    fps: 30,
    duration: 4,
    loop: false,
    time: 0,
    objects: [createObject('mannequin', 'Mannequin 1', uid(), [0, 0, 0])],
    customPoses: {},
  };
}

function cleanTracks(t: unknown): Record<string, Keyframe[]> {
  if (!t || typeof t !== 'object') return {};
  const out: Record<string, Keyframe[]> = {};
  for (const [ch, keys] of Object.entries(t as Record<string, Keyframe[]>)) {
    if (!Array.isArray(keys)) continue;
    out[ch] = keys.map((k) => ({ ...k, easing: parseEasing(k.easing) ?? 'linear' }));
  }
  return out;
}
function cleanPins(p: unknown): Pins {
  const out: Pins = {};
  const src = (p && typeof p === 'object' ? p : {}) as Record<string, unknown>;
  for (const f of ['L_foot', 'R_foot'] as const) {
    const v = src[f];
    if (Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === 'number' && isFinite(n))) out[f] = [v[0], v[1], v[2]];
  }
  return out;
}

/** Keep a valid body spec on mannequins, drop anything else (old projects have none and stay unchanged). */
function normalizeBody(out: SceneObject, raw: SceneObject): SceneObject {
  const body = out.kind === 'mannequin' ? cleanBody(raw.body) : undefined;
  if (body) out.body = body;
  else delete out.body;
  return out;
}

const num01 = (v: unknown, def: number) => (typeof v === 'number' && isFinite(v) ? Math.min(1, Math.max(0, v)) : def);
const bool = (v: unknown, def: boolean) => (typeof v === 'boolean' ? v : def);
const validAspect = (v: unknown): v is number => typeof v === 'number' && isFinite(v) && v > 0.02 && v < 50;

/** Defaults of an image plane. */
export const IMAGE_PLANE_DEFAULTS = { opacity: 1, doubleSided: true, locked: false, inRender: true, billboard: false };

function cleanImagePlane(raw: unknown): ImagePlane | null {
  const r = raw as Partial<ImagePlane> | undefined;
  if (!r || typeof r !== 'object' || typeof r.imageId !== 'string' || !r.imageId) return null;
  const d = IMAGE_PLANE_DEFAULTS;
  return {
    imageId: r.imageId,
    aspect: validAspect(r.aspect) ? r.aspect : 16 / 9,
    opacity: num01(r.opacity, d.opacity),
    doubleSided: bool(r.doubleSided, d.doubleSided),
    locked: bool(r.locked, d.locked),
    inRender: bool(r.inRender, d.inRender),
    billboard: bool(r.billboard, d.billboard),
  };
}

function cleanBackdrop(raw: unknown): ImageBackdrop | null {
  const r = raw as Partial<ImageBackdrop> | undefined;
  if (!r || typeof r !== 'object' || typeof r.imageId !== 'string' || !r.imageId) return null;
  return {
    imageId: r.imageId,
    name: typeof r.name === 'string' && r.name ? r.name : 'Reference image',
    aspect: validAspect(r.aspect) ? r.aspect : 16 / 9,
    opacity: num01(r.opacity, 1),
    visible: bool(r.visible, true),
    inRender: bool(r.inRender, true),
    fit: IMAGE_FITS.includes(r.fit as ImageFit) ? (r.fit as ImageFit) : 'fit',
  };
}

function cleanBackdrops(p: Partial<Project>): Partial<Project> {
  const out: Partial<Project> = {};
  const bg = cleanBackdrop(p.background);
  const cb = cleanBackdrop(p.cameraBackground);
  if (bg) out.background = bg;
  if (cb) out.cameraBackground = cb;
  return out;
}

function normalizeImage(out: SceneObject, raw: SceneObject): SceneObject {
  const img = raw.kind === 'image' ? cleanImagePlane(raw.image) : null;
  if (img) out.image = img;
  else delete out.image;
  return out;
}

/** Fill gaps in a loaded project (forward-compat). Throws on garbage. */
export function normalizeProject(raw: unknown): Project {
  const r = raw as Partial<Project> | null;
  if (!r || typeof r !== 'object' || !Array.isArray(r.objects)) fail('Not a Doloyo project');
  const p = r as Project;
  return {
    version: 1,
    name: typeof p.name === 'string' ? p.name : 'Untitled',
    fps: [24, 30, 60].includes(p.fps) || (Number.isInteger(p.fps) && p.fps > 0 && p.fps <= 240) ? p.fps : 30,
    duration: p.duration > 0 ? p.duration : 4,
    loop: !!p.loop,
    time: p.time >= 0 ? p.time : 0,
    ...cleanBackdrops(p),
    objects: p.objects.filter((o) => o.kind !== 'image' || cleanImagePlane(o.image)).map((o) => normalizeImage(normalizeBody({
      ...createObject(o.kind, o.name ?? 'Object', o.id ?? uid(), o.position ?? [0, 0, 0], PROCEDURAL_CHARACTER),
      ...o,
      character: typeof o.character === 'string' && o.character ? o.character : PROCEDURAL_CHARACTER,
      material: MATERIAL_MODES.includes(o.material) ? o.material : 'doll',
      pose: { ...emptyPose(), ...(o.pose ?? {}) },
      tracks: cleanTracks(o.tracks),
      pins: cleanPins(o.pins),
      target: Array.isArray(o.target) && o.target.length === 3 && o.target.every((n) => typeof n === 'number') ? o.target : [...CAMERA_DEFAULT.target],
      fov: typeof o.fov === 'number' && o.fov > 0 && o.fov < 180 ? o.fov : CAMERA_DEFAULT.fov,
    }, o), o)),
    customPoses: p.customPoses && typeof p.customPoses === 'object' ? { ...p.customPoses } : {},
  };
}

// ---------- helpers ----------

const snap = (p: Project, t: number) => Math.max(0, Math.round(t * p.fps) / p.fps);

function findObject(p: Project, ref: string): SceneObject {
  const o = p.objects.find((x) => x.id === ref) ?? p.objects.find((x) => x.name === ref);
  return o ?? fail(`Object not found: ${ref}`);
}
function mannequin(p: Project, id: string): SceneObject {
  const o = findObject(p, id);
  if (o.kind !== 'mannequin') fail(`${o.name} is not a mannequin`);
  return o;
}
const putObject = (p: Project, o: SceneObject): Project => ({
  ...p,
  objects: p.objects.map((x) => (x.id === o.id ? o : x)),
});
const vec3 = (v: unknown, what: string): Vec3 => {
  if (!Array.isArray(v) || v.length !== 3 || v.some((n) => typeof n !== 'number' || !isFinite(n))) fail(`${what} must be [x,y,z] numbers`);
  return [(v as number[])[0], (v as number[])[1], (v as number[])[2]];
};
function setTrack(o: SceneObject, ch: string, keys: Keyframe[]): SceneObject {
  const tracks = { ...o.tracks };
  if (keys.length) tracks[ch] = keys;
  else delete tracks[ch];
  return { ...o, tracks };
}
function resolveTargets(o: SceneObject, target: Target | undefined): string[] {
  if (target === undefined || target === 'all') return channelsFor(o);
  const list = Array.isArray(target) ? target : [target];
  for (const ch of list) if (!isChannel(o, ch)) fail(`Unknown channel "${ch}" for ${o.name}`);
  return list;
}
const keyAt = (keys: Keyframe[] | undefined, t: number) => keys?.find((k) => Math.abs(k.t - t) < KEY_EPS);
const restoreBatch = (o: SceneObject, chs: string[]): Command => ({
  type: 'batch',
  commands: chs.map((ch) => ({ type: 'track_restore', object: o.id, channel: ch, keys: (o.tracks[ch] ?? []).map((k) => ({ ...k })) })),
});
const fullPoseCmd = (o: SceneObject): Command => ({
  type: 'pose_apply',
  object: o.id,
  pose: { joints: JSON.parse(JSON.stringify(o.pose)), hipsPos: [...o.hipsPos] as Vec3 },
});

/** Resolve refs to ids and times to explicit snapped seconds so replay is deterministic. */
function normalize(p: Project, c: Command): Command {
  if (c.type === 'image_add' || c.type === 'image_set' || c.type === 'image_remove' || c.type === 'image_bg_restore') return c;
  if (c.type === 'batch' || c.type === 'object_add' || c.type === 'object_restore' || c.type === 'timeline_set' || c.type === 'playhead_seek') return c;
  if (c.type === 'pose_delete' || c.type === 'pose_lib_restore') return c;
  if (c.type === 'track_restore' || c.type === 'pins_restore') return c;
  if (c.type === 'camera_set' || c.type === 'scene_preset' || c.type === 'keys_edit' || c.type === 'keys_remove') return c;
  const out: any = { ...c, object: findObject(p, c.object).id };
  if (c.type === 'keys_paste') {
    const t = c.time !== undefined ? c.time : c.frame !== undefined ? c.frame / p.fps : p.time;
    out.time = snap(p, t);
    delete out.frame;
  }
  if (c.type === 'key_add' || c.type === 'key_remove' || c.type === 'key_move' || c.type === 'key_set_easing') {
    const t = c.time !== undefined ? c.time : c.frame !== undefined ? c.frame / p.fps : p.time;
    out.time = snap(p, t);
    delete out.frame;
    if (c.type === 'key_move') {
      const to = c.to !== undefined ? c.to : c.toFrame !== undefined ? c.toFrame / p.fps : undefined;
      if (to === undefined) fail('key_move needs "to" (seconds) or "toFrame"');
      out.to = snap(p, to as number);
      delete out.toFrame;
    }
  }
  return out as Command;
}

const EVAL_AFTER = new Set(['key_remove', 'key_move', 'key_set_easing', 'keys_edit', 'keys_remove', 'keys_paste', 'ik_bake', 'track_restore', 'timeline_set', 'playhead_seek']);
/** Commands after which pinned feet are re-solved (the pose or transform they depend on may have changed). */
const REPIN = new Set(['joint_set', 'pose_apply', 'pose_mirror', 'joint_reset', 'object_transform', 'object_restore', 'pins_restore']);

function repin(before: Project, after: Project): Project {
  let changed = false;
  const prev = new Map(before.objects.map((o) => [o.id, o]));
  const objects = after.objects.map((o) => {
    if (!hasPins(o) || prev.get(o.id) === o) return o;
    const n = applyPins(o);
    if (n !== o) changed = true;
    return n;
  });
  return changed ? { ...after, objects } : after;
}

// ---------- body helpers ----------

interface BodyChange {
  preset?: unknown;
  heightScale?: unknown;
  gender?: unknown;
}

/** Validate a body change from outside (clear errors, no silent clamping). */
function checkBodyChange(c: BodyChange, what = 'body'): { preset?: BodySpec['preset']; heightScale?: number; gender?: Gender } {
  const out: { preset?: BodySpec['preset']; heightScale?: number; gender?: Gender } = {};
  if (c.preset !== undefined) {
    if (!isBodyPreset(c.preset)) fail(`${what}.preset must be one of ${BODY_PRESETS.join(', ')}`);
    out.preset = c.preset as BodySpec['preset'];
  }
  if (c.heightScale !== undefined) {
    const h = c.heightScale;
    if (typeof h !== 'number' || !isFinite(h) || h < HEIGHT_SCALE_MIN - 1e-9 || h > HEIGHT_SCALE_MAX + 1e-9) fail(`${what}.heightScale must be a number between ${HEIGHT_SCALE_MIN} and ${HEIGHT_SCALE_MAX}`);
    out.heightScale = clampHeightScale(h as number);
  }
  if (c.gender !== undefined) {
    if (c.gender !== 'm' && c.gender !== 'f') fail(`${what}.gender must be "m" or "f"`);
    out.gender = c.gender as Gender;
  }
  return out;
}

/**
 * New body + character for a change. Built-in mannequins switch mesh with the body (kids and teens use the neutral
 * mannequin-m mesh, only the adult female uses mannequin-f); superheroes reject the small presets.
 */
function resolveBody(character: string, cur: BodySpec | undefined, ch: { preset?: BodySpec['preset']; heightScale?: number; gender?: Gender }): { body: BodySpec | undefined; character: string } {
  const preset = ch.preset ?? cur?.preset ?? 'dewasa';
  const gender = ch.gender ?? genderOf({ character, body: cur });
  const hs = ch.heightScale ?? cur?.heightScale ?? 1;
  const err = bodyCharacterError(character, preset);
  if (err) fail(err);
  const nextChar = characterForBody(character, preset, gender);
  let body: BodySpec | undefined = { preset };
  if (Math.abs(hs - 1) > 1e-6) body.heightScale = hs;
  if (genderOf({ character: nextChar, body }) !== gender) body.gender = gender;
  if (preset === 'dewasa' && body.heightScale === undefined && body.gender === undefined) body = undefined;
  return { body, character: nextChar };
}

// ---------- main ----------

/**
 * Objects whose keyed channels are re-sampled after a command. Only the touched objects: sampling the whole
 * project would overwrite the manually applied (not yet keyed) pose of every OTHER animated object, e.g. a
 * pose_apply on A followed by a timeline_set / track_restore / key_move on B must not reset A to its animation.
 * The playhead moving (playhead_seek, or a timeline change that clamps it) samples everything.
 */
function evalScope(before: Project, after: Project, c: Command): ReadonlySet<string> | undefined {
  if (c.type === 'playhead_seek') return undefined;
  if (c.type === 'timeline_set') return after.time !== before.time ? undefined : new Set();
  if (c.type === 'keys_edit') return new Set(c.edits.map((e) => e.object));
  if (c.type === 'keys_remove') return new Set(c.keys.map((k) => k.object));
  return new Set([(c as { object: string }).object]);
}

export function applyCommand(project: Project, cmd: Command): CommandResult {
  const c = normalize(project, cmd);
  const r = exec(project, c);
  if (REPIN.has(c.type)) r.project = repin(project, r.project);
  if (EVAL_AFTER.has(c.type)) r.project = evaluateProject(r.project, r.project.time, evalScope(project, r.project, c));
  return r;
}

// ---------- helpers for IK / keys / presets ----------

const roundN = (n: number, d = 4) => Math.round(n * 10 ** d) / 10 ** d;
const rv3 = (v: Vec3): Vec3 => [roundN(v[0]), roundN(v[1]), roundN(v[2])];

const limbOf = (v: unknown): Limb => parseLimb(v) ?? fail('limb must be one of L_arm, R_arm, L_leg, R_leg (or L_foot, R_foot)');

/** Command restoring just the joints of one limb. */
function limbRestore(o: SceneObject, limb: Limb): Command {
  const joints: Partial<Record<JointName, Vec3>> = {};
  for (const j of LIMB_JOINTS[limb]) joints[j] = [...o.pose[j]] as Vec3;
  return { type: 'pose_apply', object: o.id, pose: { joints }, partial: true };
}

/** Matching keys of a reference as (channel, key) pairs. */
function matchKeys(p: Project, ref: KeyRef): { obj: SceneObject; matches: { ch: string; key: Keyframe }[]; time: number } {
  const o = findObject(p, ref.object);
  const t = snap(p, ref.time !== undefined ? ref.time : ref.frame !== undefined ? ref.frame / p.fps : p.time);
  const chs = resolveTargets(o, ref.target);
  const matches: { ch: string; key: Keyframe }[] = [];
  for (const ch of chs) {
    const k = keyAt(o.tracks[ch], t);
    if (k) matches.push({ ch, key: k });
  }
  if (!matches.length) fail('No key at t=' + t + 's on ' + o.name);
  return { obj: o, matches, time: t };
}

/** Arc formation facing the audience (+Z): the ends curve toward the camera and turn slightly inward. */
export function formation(preset: ScenePreset): { position: Vec3; yaw: number }[] {
  const { count, spacing } = SCENE_PRESETS[preset];
  const R = 3;
  return Array.from({ length: count }, (_, i) => {
    const phi = (i - (count - 1) / 2) * (spacing / R);
    return { position: [roundN(R * Math.sin(phi)), 0, roundN(R * (1 - Math.cos(phi)))] as Vec3, yaw: roundN((-phi * 180) / Math.PI, 2) };
  });
}

/** Copy keys (by reference) into a clip, times relative to the earliest key. */
export function copyKeys(p: Project, refs: KeyRef[]): { kind: ObjectKind; clip: ClipKey[] } {
  if (!refs.length) fail('No keys selected');
  let kind: ObjectKind | null = null;
  const seen = new Set<Keyframe>();
  const items: { ch: string; key: Keyframe }[] = [];
  for (const ref of refs) {
    const m = matchKeys(p, ref);
    if (kind && kind !== m.obj.kind) fail('Copy keys from one object (or objects of the same kind) at a time');
    kind = m.obj.kind;
    for (const x of m.matches) {
      if (seen.has(x.key)) continue;
      seen.add(x.key);
      items.push(x);
    }
  }
  const t0 = Math.min(...items.map((i) => i.key.t));
  return {
    kind: kind as ObjectKind,
    clip: items.map((i) => ({
      channel: i.ch,
      dt: roundN(i.key.t - t0, 6),
      value: [...i.key.value] as Vec3,
      easing: typeof i.key.easing === 'object' ? { type: 'bezier' as const, c: [...i.key.easing.c] as [number, number, number, number] } : i.key.easing,
    })),
  };
}
const family = (k: ObjectKind) => (k === 'mannequin' ? 'm' : k === 'camera' ? 'c' : 's');

const checkSlot = (v: unknown): BackdropSlot => (v === 'viewport' || v === 'camera' ? v : fail('background must be "viewport" or "camera"'));

type PropSet = Partial<Record<'opacity' | 'visible' | 'fit' | 'locked' | 'billboard' | 'doubleSided' | 'inRender', unknown>>;
const PLANE_PROPS = ['opacity', 'locked', 'billboard', 'doubleSided', 'inRender'] as const;
const BACKDROP_PROPS = ['opacity', 'visible', 'fit', 'inRender'] as const;

/** Validate image display options for one target kind; options that do not apply to it are an error (no silent ignoring). */
function checkImageProps(c: PropSet, target: 'plane' | 'backdrop'): PropSet {
  const allowed: readonly string[] = target === 'plane' ? PLANE_PROPS : BACKDROP_PROPS;
  const out: PropSet = {};
  for (const k of ['opacity', 'visible', 'fit', 'locked', 'billboard', 'doubleSided', 'inRender'] as const) {
    const v = c[k];
    if (v === undefined) continue;
    if (!allowed.includes(k)) fail(`"${k}" does not apply to ${target === 'plane' ? 'image planes' : 'background images'} (allowed: ${allowed.join(', ')})`);
    if (k === 'opacity') {
      if (typeof v !== 'number' || !isFinite(v) || v < 0 || v > 1) fail('opacity must be a number 0..1');
    } else if (k === 'fit') {
      if (!IMAGE_FITS.includes(v as ImageFit)) fail(`fit must be one of ${IMAGE_FITS.join(', ')}`);
    } else if (typeof v !== 'boolean') fail(`${k} must be true or false`);
    out[k] = v;
  }
  return out;
}
const pickPlane = (p: PropSet) => Object.fromEntries(Object.entries(p).filter(([k]) => (PLANE_PROPS as readonly string[]).includes(k))) as Partial<ImagePlane>;
const pickBackdrop = (p: PropSet) => Object.fromEntries(Object.entries(p).filter(([k]) => (BACKDROP_PROPS as readonly string[]).includes(k))) as Partial<ImageBackdrop>;
const bgKey = (slot: BackdropSlot) => (slot === 'camera' ? 'cameraBackground' : 'background');

function exec(p: Project, c: Command): CommandResult {
  switch (c.type) {
    case 'batch': {
      let cur = p;
      const inverses: Command[] = [];
      const applied: Command[] = [];
      for (const sub of c.commands) {
        const r = applyCommand(cur, sub);
        cur = r.project;
        applied.push(r.applied);
        if (r.inverse) inverses.unshift(r.inverse);
      }
      return { project: cur, inverse: { type: 'batch', commands: inverses }, applied: { type: 'batch', commands: applied } };
    }

    case 'object_add': {
      if (!OBJECT_KINDS.includes(c.kind)) fail(`Unknown kind: ${c.kind}`);
      if (c.kind === 'image') fail('Add image planes with image_add (mode "plane")');
      const id = c.id ?? uid();
      let name = c.name;
      if (!name && c.kind === 'camera') name = 'Render Camera';
      if (!name) {
        let n = p.objects.filter((o) => o.kind === c.kind).length + 1;
        while (p.objects.some((o) => o.name === `${KIND_LABEL[c.kind]} ${n}`)) n++;
        name = `${KIND_LABEL[c.kind]} ${n}`;
      }
      if (c.kind === 'camera' && p.objects.some((o) => o.kind === 'camera')) fail('There is already a render camera (use camera_set to change it)');
      const idx = p.objects.length;
      const slot = Math.ceil(idx / 2) * 0.9 * (idx % 2 ? 1 : -1);
      const position = c.position
        ? vec3(c.position, 'position')
        : c.kind === 'camera'
          ? ([...CAMERA_DEFAULT.position] as Vec3)
          : ([slot, c.kind === 'mannequin' ? 0 : 0.25, 0] as Vec3);
      if (c.character !== undefined && !isCharacterId(c.character)) fail(`Unknown character: ${c.character} (built-in: ${BUILTIN_CHARACTER_IDS.join(', ')}; imported: custom:<id>)`);
      let character = c.kind === 'mannequin' ? c.character : undefined;
      let body: BodySpec | undefined;
      if (c.body !== undefined) {
        if (c.kind !== 'mannequin') fail('body only applies to mannequins');
        const ch = checkBodyChange(c.body as BodyChange);
        if (!ch.preset) fail('body.preset is required');
        const r = resolveBody(character ?? DEFAULT_CHARACTER, undefined, ch);
        body = r.body;
        character = r.character;
      }
      const obj = createObject(c.kind, name, id, position, character, body);
      return {
        project: { ...p, objects: [...p.objects, obj] },
        inverse: { type: 'object_remove', object: id },
        applied: { ...c, id, name, position },
      };
    }

    case 'object_set_character': {
      const o = mannequin(p, c.object);
      if (!isCharacterId(c.character)) fail(`Unknown character: ${String(c.character)} (built-in: ${BUILTIN_CHARACTER_IDS.join(', ')}; imported: custom:<id>)`);
      if (c.material !== undefined && !MATERIAL_MODES.includes(c.material)) fail(`material must be one of ${MATERIAL_MODES.join(', ')}`);
      const preset = o.body?.preset ?? 'dewasa';
      const bodyErr = bodyCharacterError(c.character, preset);
      if (bodyErr) fail(bodyErr);
      if (c.character === 'mannequin-f' && preset !== 'dewasa') fail(`Mannequin F is the adult female mesh and is only used with the dewasa body (this one is "${preset}"). Use mannequin-m (neutral) or set the body to dewasa first.`);
      const inv: Command = { type: 'object_set_character', object: o.id, character: o.character, material: o.material };
      return { project: putObject(p, { ...o, character: c.character, material: c.material ?? o.material }), inverse: inv, applied: c };
    }

    case 'object_set_body': {
      const o = mannequin(p, c.object);
      const ch = checkBodyChange(c);
      if (ch.preset === undefined && ch.heightScale === undefined && ch.gender === undefined) fail('object_set_body needs preset, heightScale or gender');
      const r = resolveBody(o.character, o.body, ch);
      const next: SceneObject = { ...o, character: r.character, pins: {} }; // feet follow the new body: pins are dropped (undo restores them)
      if (r.body) next.body = r.body;
      else delete next.body;
      return { project: putObject(p, next), inverse: { type: 'body_restore', object: o.id, body: o.body ? { ...o.body } : null, character: o.character, pins: { ...o.pins } }, applied: c };
    }

    case 'body_restore': {
      const o = findObject(p, c.object);
      const next: SceneObject = { ...o, character: c.character, pins: { ...c.pins } };
      if (c.body) next.body = { ...c.body };
      else delete next.body;
      return { project: putObject(p, next), inverse: { type: 'body_restore', object: o.id, body: o.body ? { ...o.body } : null, character: o.character, pins: { ...o.pins } }, applied: c };
    }

    case 'object_remove': {
      const o = findObject(p, c.object);
      const index = p.objects.indexOf(o);
      return {
        project: { ...p, objects: p.objects.filter((x) => x !== o) },
        inverse: { type: 'object_restore', object: o, index },
        applied: c,
      };
    }

    case 'object_restore': {
      const objects = [...p.objects];
      objects.splice(c.index, 0, c.object);
      return { project: { ...p, objects }, inverse: { type: 'object_remove', object: c.object.id }, applied: c };
    }

    case 'object_transform': {
      const o = findObject(p, c.object);
      const next = { ...o };
      const inv: any = { type: 'object_transform', object: o.id };
      if (c.name !== undefined) { inv.name = o.name; next.name = String(c.name); }
      for (const f of ['position', 'rotation', 'scale'] as const) {
        if (c[f] !== undefined) { inv[f] = [...o[f]]; next[f] = vec3(c[f], f); }
      }
      return { project: putObject(p, next), inverse: inv, applied: c };
    }

    case 'joint_set': {
      const o = mannequin(p, c.object);
      if (!isJoint(c.joint)) fail(`Unknown joint: ${c.joint}`);
      let next = o;
      const inv: any = { type: 'joint_set', object: o.id, joint: c.joint };
      if (c.rotation !== undefined) {
        inv.rotation = [...o.pose[c.joint]];
        next = setChannel(next, c.joint, clampRotation(c.joint, vec3(c.rotation, 'rotation')));
      }
      if (c.position !== undefined) {
        if (c.joint !== 'hips') fail('Only the hips joint can be translated');
        inv.position = [...o.hipsPos];
        next = { ...next, hipsPos: vec3(c.position, 'position') };
      }
      return { project: putObject(p, next), inverse: inv, applied: c };
    }

    case 'pose_apply': {
      const o = mannequin(p, c.object);
      const { pose, hipsPos } = resolvePose(c.pose, p.customPoses);
      let np: Pose = pose;
      let hp = hipsPos;
      if (c.partial && typeof c.pose !== 'string') {
        np = { ...o.pose };
        for (const k of Object.keys(c.pose.joints)) if (isJoint(k)) np[k] = pose[k];
        hp = c.pose.hipsPos ? hipsPos : o.hipsPos;
      }
      for (const j of JOINTS) np[j] = clampRotation(j, np[j]);
      const data = typeof c.pose === 'string' ? (POSES[c.pose] ?? p.customPoses[c.pose]) : c.pose;
      // grounded presets (duduk, merangkak, ...): solve the hips height from the body so the contacts rest on the floor
      if (!c.partial && data?.ground?.length) hp = groundHipsPos(np, hp, profileOf(o), data.ground);
      return { project: putObject(p, { ...o, pose: np, hipsPos: hp }), inverse: fullPoseCmd(o), applied: c };
    }

    case 'pose_save': {
      const o = mannequin(p, c.object);
      const name = typeof c.name === 'string' ? c.name.trim() : '';
      if (!name) fail('Pose name is required');
      if (name.length > 40) fail('Pose name is too long (max 40 characters)');
      if (name in POSES) fail(`"${name}" is a built-in preset name; choose another name`);
      const data: PoseData = { joints: {} };
      for (const j of JOINTS) {
        const v = o.pose[j];
        if (v[0] || v[1] || v[2]) data.joints[j] = [...v] as Vec3;
      }
      if (o.hipsPos.some((n) => n)) data.hipsPos = [...o.hipsPos] as Vec3;
      return {
        project: { ...p, customPoses: { ...p.customPoses, [name]: data } },
        inverse: { type: 'pose_lib_restore', name, data: p.customPoses[name] ?? null },
        applied: { ...c, name },
      };
    }

    case 'pose_delete': {
      const old = p.customPoses[c.name];
      if (!old) fail(`No custom pose named "${c.name}"`);
      const customPoses = { ...p.customPoses };
      delete customPoses[c.name];
      return { project: { ...p, customPoses }, inverse: { type: 'pose_lib_restore', name: c.name, data: old }, applied: c };
    }

    case 'pose_lib_restore': {
      const customPoses = { ...p.customPoses };
      const cur = customPoses[c.name] ?? null;
      if (c.data) customPoses[c.name] = c.data;
      else delete customPoses[c.name];
      return { project: { ...p, customPoses }, inverse: { type: 'pose_lib_restore', name: c.name, data: cur }, applied: c };
    }

    case 'pose_mirror': {
      const o = mannequin(p, c.object);
      if (c.from !== 'L' && c.from !== 'R') fail('from must be "L" or "R"');
      const pose = { ...o.pose };
      for (const j of JOINTS) {
        if (!j.startsWith(c.from + '_')) continue;
        const dst = mirrorJointName(j);
        pose[dst] = clampRotation(dst, mirrorRotation(o.pose[j]));
      }
      return { project: putObject(p, { ...o, pose }), inverse: fullPoseCmd(o), applied: c };
    }

    case 'joint_reset': {
      const o = mannequin(p, c.object);
      if (!c.joint) {
        return { project: putObject(p, { ...o, pose: emptyPose(), hipsPos: [0, 0, 0] }), inverse: fullPoseCmd(o), applied: c };
      }
      if (!isJoint(c.joint)) fail(`Unknown joint: ${c.joint}`);
      let next = setChannel(o, c.joint, [0, 0, 0]);
      const inv: any = { type: 'joint_set', object: o.id, joint: c.joint, rotation: [...o.pose[c.joint]] };
      if (c.joint === 'hips') {
        next = { ...next, hipsPos: [0, 0, 0] };
        inv.position = [...o.hipsPos];
      }
      return { project: putObject(p, next), inverse: inv, applied: c };
    }

    case 'key_add': {
      const o = findObject(p, c.object);
      const t = c.time as number;
      const easing = c.easing === undefined ? undefined : (parseEasing(c.easing) ?? fail(BAD_EASING));
      let chs = resolveTargets(o, c.target);
      let next = o;
      const bake = !!c.bakePins && hasPins(o);
      if (bake) {
        for (const foot of ['L_foot', 'R_foot'] as const) {
          if (o.pins[foot]) for (const j of LIMB_JOINTS[FOOT_LIMB[foot]]) if (!chs.includes(j)) chs = [...chs, j];
        }
        next = { ...next, pins: {} };
      }
      for (const ch of chs) {
        const keys = (o.tracks[ch] ?? []).filter((k) => Math.abs(k.t - t) >= KEY_EPS);
        const old = keyAt(o.tracks[ch], t);
        keys.push({ t, value: getChannel(o, ch), easing: easing ?? old?.easing ?? 'linear' });
        keys.sort((a, b) => a.t - b.t);
        next = setTrack(next, ch, keys);
      }
      const inv = restoreBatch(o, chs);
      if (bake) (inv as { commands: Command[] }).commands.push({ type: 'pins_restore', object: o.id, pins: { ...o.pins } });
      return { project: putObject(p, next), inverse: inv, applied: { ...c, target: chs } };
    }

    case 'key_remove':
    case 'key_set_easing':
    case 'key_move': {
      const o = findObject(p, c.object);
      const t = c.time as number;
      const newEasing = c.type === 'key_set_easing' ? (parseEasing(c.easing) ?? fail(BAD_EASING)) : undefined;
      const chs = resolveTargets(o, c.target).filter((ch) => keyAt(o.tracks[ch], t));
      if (!chs.length) fail(`No key at t=${t}s`);
      let next = o;
      for (const ch of chs) {
        let keys = o.tracks[ch];
        const k = keyAt(keys, t) as Keyframe;
        if (c.type === 'key_remove') keys = keys.filter((x) => x !== k);
        else if (c.type === 'key_set_easing') keys = keys.map((x) => (x === k ? { ...x, easing: newEasing as Easing } : x));
        else {
          const to = c.to as number;
          keys = keys.filter((x) => x !== k && Math.abs(x.t - to) >= KEY_EPS);
          keys.push({ ...k, t: to });
          keys.sort((a, b) => a.t - b.t);
        }
        next = setTrack(next, ch, keys);
      }
      return { project: putObject(p, next), inverse: restoreBatch(o, chs), applied: { ...c, target: chs } };
    }

    case 'keys_edit': {
      if (!Array.isArray(c.edits) || !c.edits.length) fail('keys_edit needs a non-empty "edits" array');
      // group the edits per object channel
      const perTrack = new Map<string, { obj: SceneObject; ch: string; moves: Map<Keyframe, { to: number; value?: Vec3 }> }>();
      const norm: KeyEdit[] = [];
      for (const e of c.edits) {
        const m = matchKeys(p, e);
        const to = e.to !== undefined ? snap(p, e.to) : e.toFrame !== undefined ? snap(p, e.toFrame / p.fps) : m.time;
        const value = e.value !== undefined ? vec3(e.value, 'value') : undefined;
        for (const x of m.matches) {
          const id = m.obj.id + '\u0001' + x.ch;
          let tr = perTrack.get(id);
          if (!tr) perTrack.set(id, (tr = { obj: m.obj, ch: x.ch, moves: new Map() }));
          tr.moves.set(x.key, { to, value });
        }
        norm.push({ object: m.obj.id, target: m.matches.map((x) => x.ch), time: m.time, to, ...(value ? { value } : {}) });
      }
      let cur = p;
      const inv: Command[] = [];
      for (const { obj, ch, moves } of perTrack.values()) {
        const o = findObject(cur, obj.id);
        const dest = [...moves.values()].map((m) => m.to);
        const kept = o.tracks[ch].filter((k) => !moves.has(k) && !dest.some((d) => Math.abs(d - k.t) < KEY_EPS));
        const moved = [...moves.entries()].map(([k, m]) => ({ ...k, t: m.to, value: m.value ?? k.value }));
        const keys = [...kept, ...moved].sort((a, b) => a.t - b.t);
        cur = putObject(cur, setTrack(o, ch, keys));
        inv.push({ type: 'track_restore', object: o.id, channel: ch, keys: o.tracks[ch].map((k) => ({ ...k })) });
      }
      return { project: cur, inverse: { type: 'batch', commands: inv }, applied: { type: 'keys_edit', edits: norm } };
    }

    case 'keys_remove': {
      if (!Array.isArray(c.keys) || !c.keys.length) fail('keys_remove needs a non-empty "keys" array');
      let cur = p;
      const inv: Command[] = [];
      const restored = new Set<string>();
      const norm: KeyRef[] = [];
      for (const ref of c.keys) {
        const m = matchKeys(cur, ref);
        let o = m.obj;
        for (const x of m.matches) {
          const id = o.id + '\u0001' + x.ch;
          if (!restored.has(id)) {
            restored.add(id);
            inv.unshift({ type: 'track_restore', object: o.id, channel: x.ch, keys: (o.tracks[x.ch] ?? []).map((k) => ({ ...k })) });
          }
          o = setTrack(o, x.ch, o.tracks[x.ch].filter((k) => k !== x.key));
        }
        cur = putObject(cur, o);
        norm.push({ object: o.id, target: m.matches.map((x) => x.ch), time: m.time });
      }
      return { project: cur, inverse: { type: 'batch', commands: inv }, applied: { type: 'keys_remove', keys: norm } };
    }

    case 'keys_paste': {
      const o = findObject(p, c.object);
      if (!Array.isArray(c.clip) || !c.clip.length) fail('keys_paste needs a non-empty "clip"');
      if (c.kind && family(c.kind) !== family(o.kind)) fail('Cannot paste ' + c.kind + ' keys onto ' + o.name + ' (a ' + o.kind + ')');
      const t0 = c.time as number;
      let next = o;
      const touched: string[] = [];
      for (const item of c.clip) {
        if (!isChannel(o, item.channel)) continue;
        const easing = parseEasing(item.easing) ?? 'linear';
        const t = snap(p, t0 + item.dt);
        const keys = (next.tracks[item.channel] ?? []).filter((k) => Math.abs(k.t - t) >= KEY_EPS);
        keys.push({ t, value: vec3(item.value, 'value'), easing });
        keys.sort((a, b) => a.t - b.t);
        next = setTrack(next, item.channel, keys);
        if (!touched.includes(item.channel)) touched.push(item.channel);
      }
      if (!touched.length) fail('None of the copied channels exist on ' + o.name);
      return { project: putObject(p, next), inverse: restoreBatch(o, touched), applied: c };
    }

    case 'ik_reach': {
      const o = mannequin(p, c.object);
      const limb = limbOf(c.limb);
      const target = vec3(c.target, 'target');
      const pole = c.pole !== undefined ? vec3(c.pole, 'pole') : undefined;
      if (c.poleAngle !== undefined && (typeof c.poleAngle !== 'number' || !isFinite(c.poleAngle))) fail('poleAngle must be a number (degrees)');
      const r = reachWorld(o, limb, target, { pole, poleAngle: c.poleAngle });
      let next: SceneObject = { ...o, pose: { ...o.pose, ...r.joints } };
      const inv: Command[] = [];
      const foot = limb.endsWith('leg') ? LEG_FOOT[limb as 'L_leg' | 'R_leg'] : null;
      if (foot && o.pins[foot]) {
        // reaching with a pinned foot moves the pin
        inv.push({ type: 'pins_restore', object: o.id, pins: { ...o.pins } });
        next = { ...next, pins: { ...o.pins, [foot]: rv3(endWorld(next, limb)) } };
      }
      inv.push(limbRestore(o, limb));
      return { project: putObject(p, next), inverse: { type: 'batch', commands: inv }, applied: { ...c, limb } };
    }

    case 'ik_pin': {
      const o = mannequin(p, c.object);
      const limb = limbOf(c.limb);
      if (!limb.endsWith('leg')) fail('Only feet can be pinned (limb L_leg / R_leg or L_foot / R_foot)');
      if (typeof c.pinned !== 'boolean') fail('pinned must be true or false');
      const foot = LEG_FOOT[limb as 'L_leg' | 'R_leg'];
      const pins: Pins = { ...o.pins };
      let applied: Command = { ...c, limb };
      if (c.pinned) {
        const pos = c.position !== undefined ? vec3(c.position, 'position') : rv3(endWorld(o, limb));
        pins[foot] = pos;
        applied = { ...c, limb, position: pos };
      } else delete pins[foot];
      let next: SceneObject = { ...o, pins };
      if (c.pinned) next = applyPins(next);
      const inv: Command[] = [{ type: 'pins_restore', object: o.id, pins: { ...o.pins } }, limbRestore(o, limb)];
      return { project: putObject(p, next), inverse: { type: 'batch', commands: inv }, applied };
    }

    case 'ik_bake': {
      const o = mannequin(p, c.object);
      if (!hasPins(o)) fail(o.name + ' has no pinned feet (use ik_pin first)');
      const feet = (['L_foot', 'R_foot'] as const).filter((f) => o.pins[f]);
      const times = Object.values(o.tracks).flat().map((k) => k.t);
      const start = snap(p, c.start !== undefined ? c.start : times.length ? Math.min(...times) : 0);
      const end = snap(p, c.end !== undefined ? c.end : times.length ? Math.max(...times) : p.duration);
      if (end < start) fail('end must be >= start');
      const chs = feet.flatMap((f) => LIMB_JOINTS[FOOT_LIMB[f]]) as string[];
      const frames = Math.round((end - start) * p.fps);
      if (frames > 20000) fail('Range too long to bake');
      const fresh: Record<string, Keyframe[]> = {};
      for (const ch of chs) fresh[ch] = [];
      for (let i = 0; i <= frames; i++) {
        const t = snap(p, start + i / p.fps);
        const ev = evaluateObject(o, t);
        for (const ch of chs) fresh[ch].push({ t, value: [...getChannel(ev, ch)] as Vec3, easing: 'linear' });
      }
      let next = o;
      for (const ch of chs) {
        const kept = (o.tracks[ch] ?? []).filter((k) => k.t < start - KEY_EPS || k.t > end + KEY_EPS);
        next = setTrack(next, ch, [...kept, ...fresh[ch]].sort((a, b) => a.t - b.t));
      }
      const unpin = c.unpin !== false;
      if (unpin) {
        const pins = { ...o.pins };
        for (const f of feet) delete pins[f];
        next = { ...next, pins };
      }
      const inv = restoreBatch(o, chs) as { type: 'batch'; commands: Command[] };
      inv.commands.push({ type: 'pins_restore', object: o.id, pins: { ...o.pins } });
      return { project: putObject(p, next), inverse: inv, applied: { ...c, start, end, unpin } };
    }

    case 'pins_restore': {
      const o = findObject(p, c.object);
      return { project: putObject(p, { ...o, pins: { ...c.pins } }), inverse: { type: 'pins_restore', object: o.id, pins: { ...o.pins } }, applied: c };
    }

    case 'camera_set': {
      const cam = c.object !== undefined ? findObject(p, c.object) : p.objects.find((o) => o.kind === 'camera');
      if (cam && cam.kind !== 'camera') fail(cam.name + ' is not a camera');
      if (c.fov !== undefined && !(typeof c.fov === 'number' && c.fov >= 1 && c.fov <= 170)) fail('fov must be 1..170 degrees');
      const pos = c.position !== undefined ? vec3(c.position, 'position') : undefined;
      const tgt = c.target !== undefined ? vec3(c.target, 'target') : undefined;
      if (!cam) {
        // no render camera yet: create it (as one step) and aim it
        const id = uid();
        const sub: Command[] = [{ type: 'object_add', kind: 'camera', id, name: 'Render Camera', ...(pos ? { position: pos } : {}) }];
        const set: any = { type: 'camera_set', object: id };
        if (tgt) set.target = tgt;
        if (c.fov !== undefined) set.fov = c.fov;
        if (tgt || c.fov !== undefined) sub.push(set);
        return exec(p, { type: 'batch', commands: sub });
      }
      const inv: any = { type: 'camera_set', object: cam.id };
      const next = { ...cam };
      if (pos) { inv.position = [...cam.position]; next.position = pos; }
      if (tgt) { inv.target = [...cam.target]; next.target = tgt; }
      if (c.fov !== undefined) { inv.fov = cam.fov; next.fov = c.fov; }
      return { project: putObject(p, next), inverse: inv, applied: { ...c, object: cam.id } };
    }

    case 'scene_preset': {
      const def = SCENE_PRESETS[c.preset] ?? fail('preset must be one of ' + Object.keys(SCENE_PRESETS).join(', '));
      if (c.character !== undefined && !isCharacterId(c.character)) fail('Unknown character: ' + String(c.character));
      let bodyIn: ReturnType<typeof checkBodyChange> | undefined;
      if (c.body !== undefined) {
        if (c.preset === 'keluarga') fail('The keluarga preset has fixed body sizes (2 adults, 1 anak, 1 bayi); body cannot be set');
        bodyIn = checkBodyChange(c.body as BodyChange);
        const bp = bodyIn.preset ?? fail('body.preset is required');
        const err = c.character ? bodyCharacterError(c.character, bp) : null;
        if (err) fail(err);
      }
      const subs: Command[] = [];
      if (c.clear) for (const o of p.objects) if (o.kind === 'mannequin') subs.push({ type: 'object_remove', object: o.id });
      formation(c.preset).forEach((f, i) => {
        const id = uid();
        // mixed by default: alternate female / male mannequins (an explicit character applies to everyone)
        const gender: Gender = i % 2 === 0 ? 'f' : 'm';
        let character: string | undefined = c.character;
        let body: BodySpec | undefined;
        let pose: string | undefined;
        if (c.preset === 'keluarga') {
          const m = FAMILY[i];
          const small = m.preset === 'kecil' || m.preset === 'pendek';
          const base = c.character && !small ? c.character : m.gender === 'f' ? 'mannequin-f' : 'mannequin-m';
          const r = resolveBody(base, undefined, { preset: m.preset, gender: m.gender });
          character = r.character;
          body = r.body;
          pose = m.pose;
        } else if (bodyIn) {
          const r = resolveBody(c.character ?? (gender === 'f' ? 'mannequin-f' : 'mannequin-m'), undefined, bodyIn);
          character = r.character;
          body = r.body;
        } else if (!c.character) character = gender === 'f' ? 'mannequin-f' : 'mannequin-m';
        subs.push({ type: 'object_add', kind: 'mannequin', id, position: f.position, ...(character ? { character } : {}), ...(body ? { body } : {}) });
        subs.push({ type: 'object_transform', object: id, rotation: [0, f.yaw, 0] });
        if (pose) subs.push({ type: 'pose_apply', object: id, pose });
      });
      void def;
      return exec(p, { type: 'batch', commands: subs });
    }

    case 'track_restore': {
      const o = findObject(p, c.object);
      const cur = (o.tracks[c.channel] ?? []).map((k) => ({ ...k }));
      return {
        project: putObject(p, setTrack(o, c.channel, c.keys.map((k) => ({ ...k })))),
        inverse: { type: 'track_restore', object: o.id, channel: c.channel, keys: cur },
        applied: c,
      };
    }

    case 'image_add': {
      if (!IMAGE_MODES.includes(c.mode)) fail(`mode must be one of ${IMAGE_MODES.join(', ')}`);
      if (typeof c.imageId !== 'string' || !c.imageId) fail('imageId is required (the image must be stored in this browser)');
      const aspect = c.aspect === undefined ? 16 / 9 : validAspect(c.aspect) ? c.aspect : fail('aspect must be width / height of the picture (a positive number)');
      const props = checkImageProps(c, c.mode === 'plane' ? 'plane' : 'backdrop');
      if (c.mode === 'plane') {
        const id = c.id ?? uid();
        let name = c.name?.trim();
        if (!name) {
          let n = p.objects.filter((o) => o.kind === 'image').length + 1;
          while (p.objects.some((o) => o.name === `${KIND_LABEL.image} ${n}`)) n++;
          name = `${KIND_LABEL.image} ${n}`;
        }
        const obj = createObject('image', name, id, c.position ? vec3(c.position, 'position') : [0, 0.9, -1.2]);
        obj.scale = c.scale ? vec3(c.scale, 'scale') : [1.6, 1.6, 1.6];
        if (c.rotation) obj.rotation = vec3(c.rotation, 'rotation');
        obj.image = { imageId: c.imageId, aspect, ...IMAGE_PLANE_DEFAULTS, ...pickPlane(props) };
        return { project: { ...p, objects: [...p.objects, obj] }, inverse: { type: 'object_remove', object: id }, applied: { ...c, id, name, aspect } };
      }
      const slot: BackdropSlot = c.mode === 'camera' ? 'camera' : 'viewport';
      const key = bgKey(slot);
      const bg: ImageBackdrop = {
        imageId: c.imageId,
        name: c.name?.trim() || 'Reference image',
        aspect,
        opacity: 1,
        visible: true,
        inRender: true,
        fit: slot === 'camera' ? 'fill' : 'fit',
        ...pickBackdrop(props),
      };
      const old = p[key];
      return { project: { ...p, [key]: bg }, inverse: { type: 'image_bg_restore', slot, bg: old ? { ...old } : null }, applied: { ...c, aspect } };
    }

    case 'image_set': {
      if (c.background !== undefined) {
        const slot = checkSlot(c.background);
        const key = bgKey(slot);
        const cur = p[key] ?? fail(`There is no ${slot} background image (add one with image_add)`);
        const props = checkImageProps(c, 'backdrop');
        const next: ImageBackdrop = { ...cur, ...pickBackdrop(props) };
        if (c.name !== undefined) next.name = String(c.name).trim() || cur.name;
        return { project: { ...p, [key]: next }, inverse: { type: 'image_bg_restore', slot, bg: { ...cur } }, applied: c };
      }
      if (c.object === undefined) fail('image_set needs "object" (an image plane id or name) or "background" ("viewport" or "camera")');
      const o = findObject(p, c.object as string);
      if (o.kind !== 'image' || !o.image) fail(`${o.name} is not an image plane (use background: "viewport" | "camera" for backgrounds)`);
      const props = checkImageProps(c, 'plane');
      const prev = { ...(o.image as ImagePlane) };
      const next: SceneObject = { ...o, image: { ...prev, ...pickPlane(props) } };
      if (c.name !== undefined) next.name = String(c.name).trim() || o.name;
      const inv: Command = { type: 'image_set', object: o.id, name: o.name, opacity: prev.opacity, locked: prev.locked, billboard: prev.billboard, doubleSided: prev.doubleSided, inRender: prev.inRender };
      return { project: putObject(p, next), inverse: inv, applied: { ...c, object: o.id } };
    }

    case 'image_remove': {
      if (c.background !== undefined) {
        const slot = checkSlot(c.background);
        const key = bgKey(slot);
        const cur = p[key] ?? fail(`There is no ${slot} background image`);
        const next = { ...p };
        delete next[key];
        return { project: next, inverse: { type: 'image_bg_restore', slot, bg: { ...cur } }, applied: c };
      }
      if (c.object === undefined) fail('image_remove needs "object" (an image plane id or name) or "background" ("viewport" or "camera")');
      const o = findObject(p, c.object as string);
      if (o.kind !== 'image') fail(`${o.name} is not an image plane`);
      return { project: { ...p, objects: p.objects.filter((x) => x !== o) }, inverse: { type: 'object_restore', object: o, index: p.objects.indexOf(o) }, applied: { ...c, object: o.id } };
    }

    case 'image_bg_restore': {
      const key = bgKey(c.slot);
      const cur = p[key];
      const next = { ...p };
      if (c.bg) next[key] = { ...c.bg };
      else delete next[key];
      return { project: next, inverse: { type: 'image_bg_restore', slot: c.slot, bg: cur ? { ...cur } : null }, applied: c };
    }

    case 'timeline_set': {
      const inv: any = { type: 'timeline_set' };
      const next = { ...p };
      if (c.fps !== undefined) {
        if (!Number.isInteger(c.fps) || c.fps < 1 || c.fps > 240) fail('fps must be an integer 1..240');
        inv.fps = p.fps; next.fps = c.fps;
      }
      if (c.duration !== undefined) {
        if (!(c.duration >= 0.1 && c.duration <= 3600)) fail('duration must be 0.1..3600 seconds');
        inv.duration = p.duration; next.duration = c.duration;
      }
      if (c.loop !== undefined) { inv.loop = p.loop; next.loop = !!c.loop; }
      next.time = Math.min(next.time, next.duration);
      return { project: next, inverse: inv, applied: c };
    }

    case 'playhead_seek': {
      const t = c.time !== undefined ? c.time : c.frame !== undefined ? c.frame / p.fps : p.time;
      if (typeof t !== 'number' || !isFinite(t)) fail('playhead_seek needs time or frame');
      const time = Math.min(p.duration, snap(p, t));
      return { project: { ...p, time }, inverse: null, applied: { type: 'playhead_seek', time } };
    }
  }
}

export const COMMAND_HELP = `Doloyo command API. dispatch({type, ...args}). Objects are referenced by id or name. Rotations are Euler XYZ degrees. Times are seconds (or use frame).
object_add {kind: mannequin|cube|sphere|cylinder|camera, name?, position?, character?, body?: {preset, heightScale?, gender?}}
object_set_character {object, character: doll-procedural|mannequin-f|mannequin-m|superhero-m|superhero-f|custom:<id>, material?: doll|original}
object_set_body {object, preset?: kecil|pendek|remaja|dewasa, heightScale?: 0.9..1.1, gender?: m|f}   (body size; kecil = baby 0.75 m, pendek = child 1.20 m, remaja = teen 1.62 m, dewasa = adult; superheroes: remaja/dewasa only)
object_remove {object}
object_transform {object, name?, position?, rotation?, scale?}
joint_set {object, joint, rotation?: [x,y,z], position?: [x,y,z] (hips only)}
pose_apply {object, pose: "stand"|"t_pose"|"crouch"|"kneel"|"point"|"wave_up"|"duduk"|"merangkak"|"berdiri_pegangan"|<custom pose name> | {joints:{...}, hipsPos?}, partial?}
pose_save {object, name}   (saves the current pose to the project's pose library)
pose_delete {name}
pose_mirror {object, from: "L"|"R"}
joint_reset {object, joint?}  (no joint = whole pose)
key_add {object, target?: "all"|channel|channel[], time?|frame?, easing?}
key_remove {object, target?, time?|frame?}
key_move {object, target?, time?|frame?, to?|toFrame?}
key_set_easing {object, target?, time?|frame?, easing: linear|easeIn|easeOut|easeInOut|step | {type:"bezier", c:[x1,y1,x2,y2]}}
keys_edit {edits: [{object, target?, time?|frame?, to?|toFrame?, value?: [x,y,z]}]}   (move several keys / set values, one undo step)
keys_remove {keys: [{object, target?, time?|frame?}]}
keys_paste {object, time?|frame?, kind?, clip: [{channel, dt, value, easing}]}
ik_reach {object, limb: L_arm|R_arm|L_leg|R_leg, target: [x,y,z] (world), pole?: [x,y,z] (world point), poleAngle?: degrees}
ik_pin {object, limb: L_leg|R_leg|L_foot|R_foot, pinned: boolean, position?: [x,y,z]}   (pin a foot to a world position)
ik_bake {object, start?, end?, unpin?}   (key the pinned legs for every frame, then remove the pins)
camera_set {object?, position?, target?, fov?}   (the render camera; created when missing; keyable like other objects)
scene_preset {preset: duo|trio|group5|keluarga, character?, clear?, body?}   (adds dolls in an arc formation; mixed F/M by default; keluarga = 2 adults, 1 anak, 1 bayi sitting)
image_add {mode: background|plane|camera, imageId, name?, aspect?, opacity?, inRender?, fit?, visible?, locked?, billboard?, doubleSided?, position?, rotation?, scale?}   (reference image: background = screen space behind the scene, plane = textured object in the scene, camera = locked to the render camera frame; the picture itself is stored in this browser, by id)
image_set {object?|background?: viewport|camera, name?, opacity?, inRender?, visible?, fit?, locked?, billboard?, doubleSided?}   (plane: opacity, locked, billboard, doubleSided, inRender; background: opacity, visible, fit, inRender)
image_remove {object?|background?: viewport|camera}
timeline_set {fps?, duration?, loop?}
playhead_seek {time?|frame?}
batch {commands: [...]}`;
