import { bodyHeight, genderOf } from '../core/body';
import { applyClip } from '../anim/apply';
import { isLoop, listClips, searchClips } from '../anim/library';
import { charactersReady } from '../characters/loader';
import { runMocapFromBlob } from '../mocap/job';
import type { Command } from '../core/commands';
import { POSE_NAMES } from '../core/poses';
import { JOINTS } from '../core/rig';
import type { SceneObject } from '../core/types';
import { runExport } from '../render/run';
import { EXPORT_FORMATS, type ExportFormat } from '../render/plan';
import { useStore } from '../store';
import { takeSnapshot } from '../three/shared';
import { AUTO_KEY, CODE_KEY, loadCode, useAgent, type LogEntry } from './agentStore';
import { checkPermission, findInternalCommand } from './permissions';

export const BRIDGE_PORT = 7777;
export const BRIDGE_URL = `ws://127.0.0.1:${BRIDGE_PORT}`;
/** Failed connection attempts before auto-retry stops (the user can press Retry). */
export const MAX_ATTEMPTS = 3;
const CHUNK_RAW = 3_000_000; // 3 MB raw -> 4 MB base64

interface CallMsg {
  id: string | number;
  type: 'call';
  method: string;
  params?: Record<string, unknown>;
}

// ---------- handlers ----------

const r3 = (n: number) => Math.round(n * 1000) / 1000;
const rv = (v: readonly number[]) => v.map(r3);

function summarizeObject(o: SceneObject) {
  const times = new Set<number>();
  const channels: Record<string, number> = {};
  for (const [ch, keys] of Object.entries(o.tracks)) {
    channels[ch] = keys.length;
    keys.forEach((k) => times.add(r3(k.t)));
  }
  const out: Record<string, unknown> = {
    id: o.id,
    name: o.name,
    kind: o.kind,
    ...(o.kind === 'mannequin' ? { character: o.character, material: o.material, body: o.body ?? { preset: 'dewasa' }, height: r3(bodyHeight(o.body, genderOf(o))) } : {}),
    position: rv(o.position),
    ...(o.kind === 'camera' ? { target: rv(o.target), fov: r3(o.fov) } : { rotation: rv(o.rotation), scale: rv(o.scale) }),
  };
  if (o.kind === 'mannequin') {
    const pose: Record<string, number[]> = {};
    for (const j of JOINTS) if (o.pose[j].some((n) => Math.abs(n) > 1e-6)) pose[j] = rv(o.pose[j]);
    out.pose = pose; // joints not listed are at rest [0,0,0]
    out.hipsPos = rv(o.hipsPos);
    if (o.pins && (o.pins.L_foot || o.pins.R_foot)) out.pins = Object.fromEntries(Object.entries(o.pins).map(([k, v]) => [k, rv(v as number[])]));
  }
  out.keys = { channels, times: [...times].sort((a, b) => a - b) };
  return out;
}

export function sceneGet() {
  const s = useStore.getState();
  const p = s.project;
  return {
    name: p.name,
    fps: p.fps,
    duration: p.duration,
    loop: p.loop,
    time: r3(p.time),
    frame: Math.round(p.time * p.fps),
    objects: p.objects.map(summarizeObject),
    joints: JOINTS,
    poses: { presets: POSE_NAMES, custom: Object.keys(p.customPoses) },
    selected: s.selection.object,
    canUndo: s.undoStack.length > 0,
    canRedo: s.redoStack.length > 0,
  };
}

function dispatchCommand(params: Record<string, unknown> | undefined) {
  const cmd = params as unknown as Command | undefined;
  if (!cmd || typeof cmd !== 'object' || typeof cmd.type !== 'string') throw new Error('dispatch needs a command object with a "type"');
  const internal = findInternalCommand(cmd);
  if (internal) throw new Error(`"${internal}" is an internal command and cannot be dispatched`);
  const st = useStore.getState();
  const before = new Set(st.project.objects.map((o) => o.id));
  const res = st.dispatch(cmd, { noAutoKey: true, source: 'agent' });
  if (!res.ok) throw new Error(res.error ?? 'Command failed');
  const after = useStore.getState().project;
  const created = after.objects.filter((o) => !before.has(o.id)).map((o) => ({ id: o.id, name: o.name }));
  return { ok: true, ...(created.length ? { created } : {}), time: r3(after.time), frame: Math.round(after.time * after.fps) };
}

function stepHistory(kind: 'undo' | 'redo', params: Record<string, unknown> | undefined) {
  const steps = Math.max(1, Math.min(50, Math.floor(Number(params?.steps ?? 1)) || 1));
  const st = useStore.getState();
  let n = 0;
  for (let i = 0; i < steps; i++) {
    const stack = kind === 'undo' ? useStore.getState().undoStack : useStore.getState().redoStack;
    if (!stack.length) break;
    if (kind === 'undo') st.undo();
    else st.redo();
    n++;
  }
  const after = useStore.getState();
  return { ok: true, [kind === 'undo' ? 'undone' : 'redone']: n, canUndo: after.undoStack.length > 0, canRedo: after.redoStack.length > 0 };
}

function num(v: unknown, def: number, name: string, min = 16, max = 7680): number {
  if (v === undefined || v === null) return def;
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) throw new Error(`${name} must be an integer ${min}..${max}`);
  return v;
}

async function snapshot(params: Record<string, unknown> | undefined) {
  await charactersReady(); // skinned characters load asynchronously
  const width = num(params?.width, 960, 'width');
  const height = num(params?.height, 540, 'height');
  const url = takeSnapshot({ width, height, transparent: false });
  return { mimeType: 'image/png', width, height, data: url.slice(url.indexOf(',') + 1) };
}

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

async function renderExport(params: Record<string, unknown> | undefined, send: (m: unknown) => void, id: CallMsg['id']) {
  const format = params?.format as ExportFormat;
  if (!EXPORT_FORMATS.includes(format)) throw new Error(`format must be one of ${EXPORT_FORMATS.join(', ')}`);
  const p = useStore.getState().project;
  const res = await runExport(
    {
      format,
      width: num(params?.width, 1280, 'width'),
      height: num(params?.height, 720, 'height'),
      fps: num(params?.fps, p.fps, 'fps', 1, 240),
      transparent: !!params?.transparent,
      objects: Array.isArray(params?.objects) ? (params!.objects as unknown[]).map(String) : undefined,
    },
    `Agent render (${format})`,
  );
  let chunks = 0;
  for (let off = 0; off < res.bytes.length; off += CHUNK_RAW) {
    send({ id, type: 'chunk', seq: chunks++, data: toBase64(res.bytes.subarray(off, off + CHUNK_RAW)) });
    await new Promise((r) => setTimeout(r, 0));
  }
  return { filename: res.filename, ext: res.ext, mime: res.mime, bytes: res.bytes.length, chunks, width: res.width, height: res.height, fps: res.fps, frames: res.frames };
}

// ---------- animation library + motion capture ----------

const opt = <T,>(v: unknown, type: 'number' | 'boolean' | 'string', name: string): T | undefined => {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== type) throw new Error(`${name} must be a ${type}`);
  return v as T;
};

async function animList(params: Record<string, unknown> | undefined) {
  const all = await listClips();
  const q = opt<string>(params?.query, 'string', 'query');
  const clips = searchClips(all, q).map((c) => ({ id: c.id, name: c.name, duration: c.duration, loop: isLoop(c) }));
  return { total: all.length, count: clips.length, clips };
}

async function animApply(params: Record<string, unknown> | undefined) {
  const p = params ?? {};
  const clip = opt<string>(p.clip, 'string', 'clip');
  if (!clip) throw new Error('clip is required (see anim_list)');
  if (p.objects !== undefined && !(Array.isArray(p.objects) && p.objects.every((x) => typeof x === 'string'))) throw new Error('objects must be an array of object ids or names');
  const r = await applyClip(
    {
      clip,
      objects: p.objects as string[] | undefined,
      start: opt<number>(p.start, 'number', 'start'),
      speed: opt<number>(p.speed, 'number', 'speed'),
      loops: opt<number>(p.loops, 'number', 'loops'),
      keyEvery: opt<number>(p.keyEvery, 'number', 'keyEvery'),
      mirror: opt<boolean>(p.mirror, 'boolean', 'mirror'),
      inPlace: opt<boolean>(p.inPlace, 'boolean', 'inPlace'),
      extend: opt<boolean>(p.extend, 'boolean', 'extend'),
    },
    'agent',
  );
  return { ok: true, ...r };
}

const uploads = new Map<string, { parts: Uint8Array[]; total: number; got: number; bytes: number }>();

function fromBase64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function mocapUpload(params: Record<string, unknown> | undefined) {
  const id = opt<string>(params?.uploadId, 'string', 'uploadId');
  const seq = opt<number>(params?.seq, 'number', 'seq');
  const total = opt<number>(params?.total, 'number', 'total');
  const data = opt<string>(params?.data, 'string', 'data');
  if (!id || seq === undefined || !total || data === undefined) throw new Error('mocap_upload needs uploadId, seq, total, data');
  let u = uploads.get(id);
  if (!u || seq === 0) uploads.set(id, (u = { parts: [], total, got: 0, bytes: 0 }));
  const part = fromBase64(data);
  u.parts[seq] = part;
  u.got++;
  u.bytes += part.length;
  return { ok: true, received: u.got, total: u.total, bytes: u.bytes };
}

async function mocapFromVideo(params: Record<string, unknown> | undefined) {
  const p = params ?? {};
  const id = opt<string>(p.uploadId, 'string', 'uploadId');
  const u = id ? uploads.get(id) : undefined;
  if (!id || !u) throw new Error('Unknown uploadId: upload the video first (mocap_upload)');
  if (u.got !== u.total) throw new Error(`Upload incomplete (${u.got}/${u.total} chunks)`);
  uploads.delete(id);
  const mime = opt<string>(p.mime, 'string', 'mime') ?? 'video/mp4';
  const blob = new Blob(u.parts as BlobPart[], { type: mime });
  const smoothing = opt<number>(p.smoothing, 'number', 'smoothing') ?? 0.5;
  if (smoothing < 0 || smoothing > 1) throw new Error('smoothing must be 0..1');
  const assign = p.assign as { track: number; object: string }[] | undefined;
  if (assign !== undefined && !(Array.isArray(assign) && assign.every((a) => a && typeof a.track === 'number' && typeof a.object === 'string'))) {
    throw new Error('assign must be [{track:number, object:string|"new"}]');
  }
  const fps = opt<number>(p.fps, 'number', 'fps');
  if (fps !== undefined && (!Number.isInteger(fps) || fps < 5 || fps > 60)) throw new Error('fps must be an integer 5..60');
  const res = await runMocapFromBlob(blob, {
    maxPeople: opt<number>(p.maxPeople, 'number', 'maxPeople'),
    fps,
    assign,
    minCutoff: 5 * Math.pow(0.04, smoothing), // smoothing 0 -> 5 Hz (raw), 0.5 -> 1 Hz, 1 -> 0.2 Hz
    footLock: opt<boolean>(p.footLock, 'boolean', 'footLock'),
    inPlace: opt<boolean>(p.inPlace, 'boolean', 'inPlace'),
    mirror: opt<boolean>(p.mirror, 'boolean', 'mirror'),
    keyEvery: opt<number>(p.keyEvery, 'number', 'keyEvery'),
    start: opt<number>(p.start, 'number', 'start'),
  });
  return { ok: true, ...res };
}

function summarizeCall(method: string, params: Record<string, unknown> | undefined): string {
  if (method === 'dispatch') {
    const t = String(params?.type ?? '?');
    if (t === 'batch' && Array.isArray(params?.commands)) return `batch (${params.commands.length})`;
    const extra = params?.joint ?? params?.object ?? params?.kind ?? params?.name ?? '';
    return extra ? `${t} ${String(extra)}` : t;
  }
  if (method === 'anim_apply') return String(params?.clip ?? '');
  if (method === 'anim_list') return String(params?.query ?? '');
  if (method === 'mocap_upload') return `chunk ${Number(params?.seq ?? 0) + 1}/${params?.total ?? '?'}`;
  if (method === 'mocap_from_video') return 'analyze video';
  if (method === 'render_export') return `${String(params?.format ?? '?')} ${params?.width ?? ''}x${params?.height ?? ''}`.trim();
  if (method === 'viewport_snapshot') return `${params?.width ?? 960}x${params?.height ?? 540}`;
  if (method === 'undo' || method === 'redo') return `x${params?.steps ?? 1}`;
  return '';
}

// ---------- connection ----------

let ws: WebSocket | null = null;
let wanted = false;
let code = '';
let attempt = 0;
let retryTimer: number | undefined;
let logId = 0;

const set = useAgent.getState;

function send(m: unknown) {
  ws?.send(JSON.stringify(m));
}

async function handleCall(msg: CallMsg) {
  const mode = useAgent.getState().mode;
  const entry: LogEntry = { id: ++logId, time: Date.now(), method: msg.method, summary: summarizeCall(msg.method, msg.params), state: 'pending' };
  set().addLog(entry);
  const fail = (error: string) => {
    set().updateLog(entry.id, { state: 'error', error });
    send({ id: msg.id, type: 'result', ok: false, error });
  };
  const gate = checkPermission(mode, msg.method);
  if (!gate.ok) return fail(gate.error);
  try {
    let data: unknown;
    switch (msg.method) {
      case 'scene_get':
        data = sceneGet();
        break;
      case 'dispatch':
        data = dispatchCommand(msg.params);
        break;
      case 'undo':
      case 'redo':
        data = stepHistory(msg.method, msg.params);
        break;
      case 'viewport_snapshot':
        data = await snapshot(msg.params);
        break;
      case 'render_export':
        data = await renderExport(msg.params, send, msg.id);
        break;
      case 'anim_list':
        data = await animList(msg.params);
        break;
      case 'anim_apply':
        data = await animApply(msg.params);
        break;
      case 'mocap_upload':
        data = mocapUpload(msg.params);
        break;
      case 'mocap_from_video':
        data = await mocapFromVideo(msg.params);
        break;
      default:
        throw new Error(`Unknown method: ${msg.method}`);
    }
    set().updateLog(entry.id, { state: 'ok' });
    send({ id: msg.id, type: 'result', ok: true, data });
  } catch (e) {
    fail(e instanceof Error ? e.message : String(e));
  }
}

function open() {
  window.clearTimeout(retryTimer);
  set().setStatus('connecting', null);
  let sock: WebSocket;
  try {
    sock = new WebSocket(BRIDGE_URL);
  } catch (e) {
    set().setStatus('disconnected', e instanceof Error ? e.message : String(e));
    wanted = false;
    return;
  }
  ws = sock;
  sock.onopen = () => sock.send(JSON.stringify({ type: 'hello', code }));
  sock.onmessage = (ev) => {
    let msg: { type?: string };
    try {
      msg = JSON.parse(String(ev.data));
    } catch {
      return;
    }
    if (msg.type === 'welcome') {
      attempt = 0;
      set().setStatus('connected', null);
    } else if (msg.type === 'call') {
      void handleCall(msg as CallMsg);
    }
  };
  sock.onclose = (ev) => {
    if (ws !== sock) return;
    ws = null;
    if (!wanted) return set().setStatus('disconnected', null);
    if (ev.code === 4001) {
      wanted = false;
      return set().setStatus('disconnected', 'Wrong pairing code. Check the MCP server log or the agent (bridge_status).');
    }
    if (ev.code === 4002) {
      wanted = false;
      return set().setStatus('disconnected', 'Another browser tab took over the connection.');
    }
    attempt++;
    if (attempt >= MAX_ATTEMPTS) {
      // stop hammering a bridge that is not there (every failed attempt logs a browser console error)
      wanted = false;
      return set().setStatus('disconnected', 'Bridge offline: the MCP server is not reachable (is it running?).', true);
    }
    const delay = 1000 * 2 ** (attempt - 1);
    set().setStatus('connecting', `Bridge not reachable (attempt ${attempt}/${MAX_ATTEMPTS}). Retrying...`);
    retryTimer = window.setTimeout(() => wanted && open(), delay);
  };
  sock.onerror = () => {
    /* onclose follows and handles retry */
  };
}

export function connectBridge(pairingCode: string) {
  code = pairingCode.trim();
  try {
    sessionStorage.setItem(CODE_KEY, code);
    sessionStorage.setItem(AUTO_KEY, '1');
  } catch {
    /* ignore */
  }
  disconnectSocket();
  wanted = true;
  attempt = 0;
  open();
}

/** Manual retry after "Bridge offline". */
export function retryBridge() {
  if (!code) return;
  connectBridge(code);
}

function disconnectSocket() {
  window.clearTimeout(retryTimer);
  const s = ws;
  ws = null;
  s?.close(1000);
}

export function disconnectBridge() {
  wanted = false;
  try {
    sessionStorage.removeItem(AUTO_KEY);
  } catch {
    /* ignore */
  }
  disconnectSocket();
  set().setStatus('disconnected', null);
}

/** Reconnect after a page reload if the user was connected in this tab session. */
export function autoConnectBridge() {
  try {
    if (sessionStorage.getItem(AUTO_KEY) === '1' && loadCode()) connectBridge(loadCode());
  } catch {
    /* ignore */
  }
}
