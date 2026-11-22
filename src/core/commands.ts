import { applyPins, endWorld, FOOT_LIMB, hasPins, LEG_FOOT, LIMB_JOINTS, parseLimb, reachWorld } from './ik';
import { channelsFor, evaluateObject, evaluateProject, getChannel, isChannel, parseEasing, setChannel } from './interpolate';
import { POSES, resolvePose } from './poses';
import { clampRotation, emptyPose, isJoint, JOINTS, mirrorJointName, mirrorRotation } from './rig';
import type { Easing, JointName, Keyframe, Limb, ObjectKind, Pins, Pose, PoseData, Project, SceneObject, Vec3 } from './types';
import { BUILTIN_CHARACTER_IDS, DEFAULT_CHARACTER, isCharacterId, MATERIAL_MODES, OBJECT_KINDS, PROCEDURAL_CHARACTER, type MaterialMode } from './types';

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
export type ScenePreset = 'duo' | 'trio' | 'group5';
export const SCENE_PRESETS: Record<ScenePreset, { count: number; spacing: number; label: string }> = {
  duo: { count: 2, spacing: 1.0, label: 'Duo' },
  trio: { count: 3, spacing: 0.95, label: 'Trio' },
  group5: { count: 5, spacing: 0.85, label: 'Group of 5' },
};

export type Command =
  | { type: 'object_add'; kind: ObjectKind; name?: string; id?: string; position?: Vec3; character?: string }
  | { type: 'object_set_character'; object: string; character: string; material?: MaterialMode }
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
  | { type: 'scene_preset'; preset: ScenePreset; character?: string; clear?: boolean }
  | { type: 'pins_restore'; object: string; pins: Pins } // internal
  | { type: 'track_restore'; object: string; channel: string; keys: Keyframe[] } // internal
  | { type: 'timeline_set'; fps?: number; duration?: number; loop?: boolean }
  | { type: 'playhead_seek'; time?: number; frame?: number }
  | { type: 'batch'; commands: Command[] };

/** Commands that exist only as undo inverses; never accept them from outside. */
export const INTERNAL_COMMANDS = ['object_restore', 'track_restore', 'pose_lib_restore', 'pins_restore'];

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
};

export const CAMERA_DEFAULT = { position: [2.8, 1.6, 3.8] as Vec3, target: [0, 0.9, 0] as Vec3, fov: 40 };

export function createObject(kind: ObjectKind, name: string, id: string, position: Vec3, character?: string): SceneObject {
  return {
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

/** Fill gaps in a loaded project (forward-compat). Throws on garbage. */
export function normalizeProject(raw: unknown): Project {
  const r = raw as Partial<Project> | null;
  if (!r || typeof r !== 'object' || !Array.isArray(r.objects)) fail('Not a Motion Doll project');
  const p = r as Project;
  return {
    version: 1,
    name: typeof p.name === 'string' ? p.name : 'Untitled',
    fps: [24, 30, 60].includes(p.fps) || (Number.isInteger(p.fps) && p.fps > 0 && p.fps <= 240) ? p.fps : 30,
    duration: p.duration > 0 ? p.duration : 4,
    loop: !!p.loop,
    time: p.time >= 0 ? p.time : 0,
    objects: p.objects.map((o) => ({
      ...createObject(o.kind, o.name ?? 'Object', o.id ?? uid(), o.position ?? [0, 0, 0], PROCEDURAL_CHARACTER),
      ...o,
      character: typeof o.character === 'string' && o.character ? o.character : PROCEDURAL_CHARACTER,
      material: MATERIAL_MODES.includes(o.material) ? o.material : 'doll',
      pose: { ...emptyPose(), ...(o.pose ?? {}) },
      tracks: cleanTracks(o.tracks),
      pins: cleanPins(o.pins),
      target: Array.isArray(o.target) && o.target.length === 3 && o.target.every((n) => typeof n === 'number') ? o.target : [...CAMERA_DEFAULT.target],
      fov: typeof o.fov === 'number' && o.fov > 0 && o.fov < 180 ? o.fov : CAMERA_DEFAULT.fov,
    })),
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

// ---------- main ----------

export function applyCommand(project: Project, cmd: Command): CommandResult {
  const c = normalize(project, cmd);
  const r = exec(project, c);
  if (REPIN.has(c.type)) r.project = repin(project, r.project);
  if (EVAL_AFTER.has(c.type)) r.project = evaluateProject(r.project);
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
      const obj = createObject(c.kind, name, id, position, c.kind === 'mannequin' ? c.character : undefined);
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
      const inv: Command = { type: 'object_set_character', object: o.id, character: o.character, material: o.material };
      return { project: putObject(p, { ...o, character: c.character, material: c.material ?? o.material }), inverse: inv, applied: c };
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
      const subs: Command[] = [];
      if (c.clear) for (const o of p.objects) if (o.kind === 'mannequin') subs.push({ type: 'object_remove', object: o.id });
      formation(c.preset).forEach((f) => {
        const id = uid();
        subs.push({ type: 'object_add', kind: 'mannequin', id, position: f.position, ...(c.character ? { character: c.character } : {}) });
        subs.push({ type: 'object_transform', object: id, rotation: [0, f.yaw, 0] });
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

export const COMMAND_HELP = `Motion Doll command API. dispatch({type, ...args}). Objects are referenced by id or name. Rotations are Euler XYZ degrees. Times are seconds (or use frame).
object_add {kind: mannequin|cube|sphere|cylinder|camera, name?, position?, character?}
object_set_character {object, character: doll-procedural|mannequin-f|mannequin-m|superhero-m|superhero-f|custom:<id>, material?: doll|original}
object_remove {object}
object_transform {object, name?, position?, rotation?, scale?}
joint_set {object, joint, rotation?: [x,y,z], position?: [x,y,z] (hips only)}
pose_apply {object, pose: "stand"|"t_pose"|"crouch"|"kneel"|"point"|"wave_up"|<custom pose name> | {joints:{...}, hipsPos?}, partial?}
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
scene_preset {preset: duo|trio|group5, character?, clear?}   (adds dolls in an arc formation)
timeline_set {fps?, duration?, loop?}
playhead_seek {time?|frame?}
batch {commands: [...]}`;
