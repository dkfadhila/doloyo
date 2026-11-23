import { create } from 'zustand';
import { applyCommand, COMMAND_HELP, newProject, type ClipKey, type Command } from './core/commands';
import { LIMB_JOINTS, parseLimb } from './core/ik';
import { evaluateProject } from './core/interpolate';
import { JOINTS } from './core/rig';
import type { JointName, Limb, ObjectKind, Project, SceneObject } from './core/types';

export interface KeySel {
  object: string;
  target: string; // 'all' or a channel
  time: number;
}
export interface Selection {
  object: string | null;
  joint: JointName | null;
  key: KeySel | null;
}
export type Mode = 'rotate' | 'translate' | 'scale';
export interface KeyClip {
  kind: ObjectKind;
  clip: ClipKey[];
}
export type Source = 'ui' | 'agent';
interface Entry {
  forward: Command;
  inverse: Command;
  group?: string;
  source?: Source;
}
export interface OnionSettings {
  on: boolean;
  /** 0 = previous/next key; N > 0 = fixed offset of +-N frames. */
  frames: number;
}
export interface DispatchResult {
  ok: boolean;
  error?: string;
}
export interface DispatchOpts {
  /** Consecutive dispatches with the same group merge into one undo step (scrubbing). */
  group?: string;
  noAutoKey?: boolean;
  /** Who issued the command (agent commands share the same undo stack). */
  source?: Source;
}

interface State {
  project: Project;
  selection: Selection;
  playing: boolean;
  autoKey: boolean;
  mode: Mode;
  undoStack: Entry[];
  redoStack: Entry[];
  collapse: Record<string, boolean>;
  focusTick: number;
  onion: OnionSettings;
  /** Every selected key (marquee / shift-click). `selection.key` is the primary one. */
  keySet: KeySel[];
  clipboard: KeyClip | null;
  /** IK handles on the selected mannequin, and the handle (limb) being dragged/selected. */
  ikOn: boolean;
  ikLimb: Limb | null;
  /** Viewport shows the render camera (C). */
  lookThrough: boolean;

  dispatch: (cmd: Command, opts?: DispatchOpts) => DispatchResult;
  undo: () => void;
  redo: () => void;
  select: (object: string | null, joint?: JointName | null) => void;
  selectKey: (k: KeySel | null) => void;
  selectKeys: (k: KeySel[]) => void;
  setClipboard: (c: KeyClip | null) => void;
  setIkOn: (v: boolean) => void;
  setIkLimb: (l: Limb | null) => void;
  setLookThrough: (v: boolean) => void;
  setMode: (m: Mode) => void;
  toggleAutoKey: () => void;
  toggleCollapse: (k: string) => void;
  requestFocus: () => void;
  setOnion: (o: Partial<OnionSettings>) => void;
  setProject: (p: Project) => void;
  play: () => void;
  pause: () => void;
  stop: () => void;
  togglePlay: () => void;
  tick: (dt: number) => void;
}

const MAX_UNDO = 300;
const ALL_POSE_CHANNELS = [...JOINTS, 'hipsPos'];

function withAutoKey(c: Command): Command {
  let target: string[] | null = null;
  switch (c.type) {
    case 'ik_reach': {
      const limb = parseLimb(c.limb);
      target = limb ? [...LIMB_JOINTS[limb]] : null;
      break;
    }
    case 'camera_set':
      target = [];
      if (c.position) target.push('position');
      if (c.target) target.push('target');
      if (c.fov !== undefined) target.push('fov');
      {
        const cam = c.object ?? firstCamera();
        return target.length && cam ? { type: 'batch', commands: [c, { type: 'key_add', object: cam, target }] } : c;
      }
    case 'joint_set':
      target = [];
      if (c.rotation) target.push(c.joint);
      if (c.position) target.push('hipsPos');
      break;
    case 'object_transform':
      target = (['position', 'rotation', 'scale'] as const).filter((f) => c[f] !== undefined);
      break;
    case 'pose_apply':
    case 'pose_mirror':
    case 'joint_reset':
      target = ALL_POSE_CHANNELS;
      break;
  }
  if (!target || !target.length) return c;
  return { type: 'batch', commands: [c, { type: 'key_add', object: (c as { object: string }).object, target }] };
}

function firstCamera(): string {
  return useStore.getState().project.objects.find((o) => o.kind === 'camera')?.id ?? '';
}

/** Drop selected keys that no longer exist. */
function pruneKeys(keys: KeySel[], p: Project): KeySel[] {
  const out = keys.filter((k) => {
    const o = p.objects.find((x) => x.id === k.object);
    if (!o) return false;
    const chans = k.target === 'all' ? Object.keys(o.tracks) : [k.target];
    return chans.some((ch) => o.tracks[ch]?.some((x) => Math.abs(x.t - k.time) < 1e-3));
  });
  return out.length === keys.length ? keys : out;
}

function keyAlive(k: KeySel, p: Project): boolean {
  const o = p.objects.find((x) => x.id === k.object);
  if (!o) return false;
  const chans = k.target === 'all' ? Object.keys(o.tracks) : [k.target];
  return chans.some((ch) => o.tracks[ch]?.some((x) => Math.abs(x.t - k.time) < 1e-3));
}

function fixSelection(sel: Selection, p: Project): Selection {
  if (sel.object && !p.objects.some((o) => o.id === sel.object)) return { object: null, joint: null, key: null };
  if (sel.key && !keyAlive(sel.key, p)) return { ...sel, key: null };
  return sel;
}

export const useStore = create<State>((set, get) => ({
  project: newProject(),
  selection: { object: null, joint: null, key: null },
  playing: false,
  autoKey: false,
  mode: 'rotate',
  undoStack: [],
  redoStack: [],
  collapse: {},
  focusTick: 0,
  onion: { on: false, frames: 0 },
  keySet: [],
  clipboard: null,
  ikOn: false,
  ikLimb: null,
  lookThrough: false,

  dispatch: (cmd, opts) => {
    const s = get();
    try {
      const c = s.autoKey && !opts?.noAutoKey ? withAutoKey(cmd) : cmd;
      const r = applyCommand(s.project, c);
      let undoStack = s.undoStack;
      let redoStack = s.redoStack;
      if (r.inverse) {
        const top = undoStack[undoStack.length - 1];
        if (opts?.group && top?.group === opts.group) {
          undoStack = [...undoStack.slice(0, -1), { forward: r.applied, inverse: top.inverse, group: opts.group, source: opts.source }];
        } else {
          undoStack = [...undoStack, { forward: r.applied, inverse: r.inverse, group: opts?.group, source: opts?.source }].slice(-MAX_UNDO);
        }
        redoStack = [];
      }
      let selection = fixSelection(s.selection, r.project);
      if (r.applied.type === 'object_add') selection = { object: r.applied.id ?? null, joint: null, key: null };
      set({ project: r.project, undoStack, redoStack, selection, keySet: pruneKeys(s.keySet, r.project) });
      return { ok: true };
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      console.warn('[doloyo] command failed:', error);
      return { ok: false, error };
    }
  },

  undo: () => {
    const s = get();
    const e = s.undoStack[s.undoStack.length - 1];
    if (!e) return;
    try {
      const r = applyCommand(s.project, e.inverse);
      set({
        project: r.project,
        undoStack: s.undoStack.slice(0, -1),
        redoStack: [...s.redoStack, e],
        selection: fixSelection(s.selection, r.project),
        keySet: pruneKeys(s.keySet, r.project),
      });
    } catch (err) {
      console.warn('[doloyo] undo failed', err);
      set({ undoStack: [], redoStack: [] });
    }
  },

  redo: () => {
    const s = get();
    const e = s.redoStack[s.redoStack.length - 1];
    if (!e) return;
    try {
      const r = applyCommand(s.project, e.forward);
      set({
        project: r.project,
        redoStack: s.redoStack.slice(0, -1),
        undoStack: [...s.undoStack, { ...e, group: undefined }],
        selection: fixSelection(s.selection, r.project),
        keySet: pruneKeys(s.keySet, r.project),
      });
    } catch (err) {
      console.warn('[doloyo] redo failed', err);
      set({ undoStack: [], redoStack: [] });
    }
  },

  select: (object, joint = null) => set((s) => ({ selection: { object, joint: object ? joint : null, key: s.selection.key }, ikLimb: null })),
  selectKey: (key) => set((s) => ({ selection: { ...s.selection, key }, keySet: key ? [key] : [] })),
  selectKeys: (keys) => set((s) => ({ selection: { ...s.selection, key: keys.length ? keys[keys.length - 1] : null }, keySet: keys })),
  setClipboard: (clipboard) => set({ clipboard }),
  setIkOn: (ikOn) => set((s) => ({ ikOn, ikLimb: ikOn ? s.ikLimb : null })),
  setIkLimb: (ikLimb) => set({ ikLimb }),
  setLookThrough: (lookThrough) => set({ lookThrough }),
  setMode: (mode) => set({ mode }),
  toggleAutoKey: () => set((s) => ({ autoKey: !s.autoKey })),
  toggleCollapse: (k) => set((s) => ({ collapse: { ...s.collapse, [k]: !s.collapse[k] } })),
  requestFocus: () => set((s) => ({ focusTick: s.focusTick + 1 })),
  setOnion: (o) => set((s) => ({ onion: { ...s.onion, ...o } })),

  setProject: (p) =>
    set({
      project: evaluateProject(p),
      undoStack: [],
      redoStack: [],
      playing: false,
      selection: { object: null, joint: null, key: null },
      keySet: [],
      ikLimb: null,
    }),

  play: () => {
    const s = get();
    if (s.project.time >= s.project.duration - 1e-6) s.dispatch({ type: 'playhead_seek', time: 0 });
    set({ playing: true });
  },
  pause: () => set({ playing: false }),
  stop: () => {
    set({ playing: false });
    get().dispatch({ type: 'playhead_seek', time: 0 });
  },
  togglePlay: () => (get().playing ? get().pause() : get().play()),

  tick: (dt) => {
    const s = get();
    if (!s.playing) return;
    const p = s.project;
    let t = p.time + dt;
    let playing = true;
    if (t >= p.duration) {
      if (p.loop && p.duration > 0) t = t % p.duration;
      else {
        t = p.duration;
        playing = false;
      }
    }
    set({ project: evaluateProject({ ...p, time: t }), playing });
  },
}));

export function selectedObject(s: Pick<State, 'project' | 'selection'>): SceneObject | undefined {
  return s.project.objects.find((o) => o.id === s.selection.object);
}

// ---- console API (the MCP bridge in src/agent/bridge.ts uses the same dispatch) ----
export interface DoloyoApi {
  dispatch: (cmd: Command) => DispatchResult;
  /** Like dispatch, but image_add may carry a dataUrl (it is stored in this browser first). */
  dispatchAsync?: (cmd: Record<string, unknown> & { type: string }) => Promise<DispatchResult>;
  getState: () => Project;
  help: () => string;
  anim?: { list: (q?: string) => Promise<unknown>; apply: (req: never) => Promise<unknown> };
  mocap?: { fromBlob: (blob: Blob, p: never) => Promise<unknown> };
  render?: (o: never, label?: string) => Promise<unknown>;
}
declare global {
  interface Window {
    doloyo: DoloyoApi;
    /** Former name of window.doloyo, kept as an alias (same object). */
    motionDoll: DoloyoApi;
  }
}
if (typeof window !== 'undefined') {
  const api: DoloyoApi = {
    dispatch: (cmd) => useStore.getState().dispatch(cmd),
    getState: () => JSON.parse(JSON.stringify(useStore.getState().project)),
    help: () => COMMAND_HELP,
  };
  window.doloyo = api;
  window.motionDoll = api;
}
