import { zipSync } from 'fflate';
import { ArrayBufferTarget as Mp4Target, Muxer as Mp4Muxer } from 'mp4-muxer';
import { PerspectiveCamera, Vector3, WebGLRenderer, type Light, type Object3D } from 'three';
import { ArrayBufferTarget as WebmTarget, Muxer as WebmMuxer } from 'webm-muxer';
import { getCharacter } from '../characters/registry';
import { charactersReady } from '../characters/loader';
import { evaluateProject } from '../core/interpolate';
import type { Project, SceneObject } from '../core/types';
import { useStore } from '../store';
import { applyAll, getRenderContext, live } from '../three/shared';
import { createSkinned } from '../three/skinned';
import { useUi } from '../ui/uiStore';
import { buildBvh, buildGlbScene, writeGlb, type SkinRig } from './glb';
import { checkSize, evenSize, extFor, frameCount, frameTime, isModelFormat, mimeFor, safeName, videoBitrate, type ExportFormat } from './plan';

export interface ExportOptions {
  format: ExportFormat;
  width: number;
  height: number;
  fps: number;
  /** PNG only (video codecs here have no alpha). */
  transparent?: boolean;
  /** glb / bvh: object ids or names to export (default: every mannequin and shape; the render camera is always included). */
  objects?: string[];
  signal?: AbortSignal;
  onProgress?: (done: number, total: number) => void;
}

export interface ExportResult {
  bytes: Uint8Array;
  mime: string;
  ext: string;
  filename: string;
  width: number;
  height: number;
  fps: number;
  frames: number;
}

export class ExportCancelled extends Error {
  constructor() {
    super('Export cancelled');
  }
}

const tick = () => new Promise<void>((r) => setTimeout(r, 0));
const check = (s?: AbortSignal) => {
  if (s?.aborted) throw new ExportCancelled();
};

/** Shadow maps live on the light and are tied to one renderer; drop them when switching renderers. */
function resetShadowMaps(root: Object3D) {
  root.traverse((o) => {
    const sh = (o as Light).shadow;
    if (sh?.map) {
      sh.map.dispose();
      sh.map = null;
    }
  });
}

interface FrameSource {
  width: number;
  height: number;
  /** Render the project at time t and return the canvas holding the pixels. */
  draw: (t: number) => HTMLCanvasElement;
  dispose: () => void;
}

/**
 * Dedicated offscreen renderer that shares the live scene (so the viewport keeps its own size and state)
 * and is driven deterministically: every frame the scene is put into the sampled state synchronously.
 */
function createFrameSource(width: number, height: number, transparent: boolean): FrameSource {
  const { gl: mainGl, scene, camera } = getRenderContext();
  const project = useStore.getState().project;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const gl = new WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
  gl.setPixelRatio(1);
  gl.setSize(width, height, false);
  gl.shadowMap.enabled = mainGl.shadowMap.enabled;
  gl.shadowMap.type = mainGl.shadowMap.type;
  gl.outputColorSpace = mainGl.outputColorSpace;
  gl.toneMapping = mainGl.toneMapping;
  gl.toneMappingExposure = mainGl.toneMappingExposure;
  gl.setClearColor(0x000000, 0);

  camera.updateMatrixWorld();
  // the render camera (animated) wins over the editor view
  const camObj = project.objects.find((o) => o.kind === 'camera') ?? null;
  const cam = camera.clone() as PerspectiveCamera;
  cam.aspect = width / height;
  cam.updateProjectionMatrix();
  cam.updateMatrixWorld();

  // Hide grid, gizmo, onion ghosts and anything flagged noSnap for the whole export.
  const hidden: Object3D[] = [];
  scene.traverse((o) => {
    if (o.visible && (o.userData.noSnap || (o as unknown as { isTransformControls?: boolean }).isTransformControls)) {
      o.visible = false;
      hidden.push(o);
    }
  });
  const prevBg = scene.background;
  if (transparent) scene.background = null;
  resetShadowMaps(scene);

  return {
    width,
    height,
    draw: (t) => {
      const proj: Project = evaluateProject({ ...project, time: t }, t);
      const c = camObj ? proj.objects.find((o) => o.id === camObj.id) : null;
      if (c) {
        cam.position.set(...c.position);
        cam.up.set(0, 1, 0);
        cam.lookAt(new Vector3(...c.target));
        cam.fov = c.fov;
        cam.aspect = width / height;
        cam.updateProjectionMatrix();
        cam.updateMatrixWorld();
      }
      live.override = { project: proj, selected: null, joint: null };
      applyAll(live.override);
      gl.render(scene, cam);
      return canvas;
    },
    dispose: () => {
      live.override = null;
      hidden.forEach((o) => (o.visible = true));
      scene.background = prevBg;
      resetShadowMaps(scene);
      gl.dispose();
      gl.forceContextLoss();
      applyAll();
    },
  };
}

const toPng = (c: HTMLCanvasElement) =>
  new Promise<Uint8Array>((resolve, reject) => {
    c.toBlob(async (b) => (b ? resolve(new Uint8Array(await b.arrayBuffer())) : reject(new Error('PNG encoding failed'))), 'image/png');
  });

// ---------- video ----------

const NO_WEBCODECS = 'Video export needs WebCodecs (Chrome or Edge 94+, recent Safari). Use PNG sequence instead and assemble the video with ffmpeg.';

async function pickCodec(candidates: string[], base: VideoEncoderConfig): Promise<string> {
  if (typeof VideoEncoder === 'undefined' || typeof VideoFrame === 'undefined') throw new Error(NO_WEBCODECS);
  for (const codec of candidates) {
    try {
      const r = await VideoEncoder.isConfigSupported({ ...base, codec });
      if (r.supported) return codec;
    } catch {
      /* try next */
    }
  }
  throw new Error(`This browser has no usable video encoder for ${candidates[0].startsWith('avc') ? 'H.264 (MP4)' : 'VP9/VP8 (WebM)'} at ${base.width}x${base.height}. Try a smaller size, WebM/MP4 in another browser, or PNG sequence.`);
}

async function encodeVideo(
  format: 'webm' | 'mp4',
  src: FrameSource,
  total: number,
  fps: number,
  duration: number,
  o: ExportOptions,
): Promise<Uint8Array> {
  const { width, height } = src;
  const bitrate = videoBitrate(width, height, fps);
  const base: VideoEncoderConfig = { codec: '', width, height, bitrate, framerate: fps };
  const big = width * height > 2_228_224;
  const codec =
    format === 'webm'
      ? await pickCodec(['vp09.00.10.08', 'vp8'], base)
      : await pickCodec(big ? ['avc1.640033', 'avc1.640034'] : ['avc1.64002A', 'avc1.640033', 'avc1.4D0028', 'avc1.42E01F'], base);

  let failure: Error | null = null;
  let target: WebmTarget | Mp4Target;
  let addChunk: (c: EncodedVideoChunk, m?: EncodedVideoChunkMetadata) => void;
  let finalize: () => void;
  if (format === 'webm') {
    const t = new WebmTarget();
    const m = new WebmMuxer({ target: t, video: { codec: codec.startsWith('vp09') ? 'V_VP9' : 'V_VP8', width, height, frameRate: fps } });
    target = t;
    addChunk = (c, meta) => m.addVideoChunk(c, meta);
    finalize = () => m.finalize();
  } else {
    const t = new Mp4Target();
    const m = new Mp4Muxer({ target: t, video: { codec: 'avc', width, height }, fastStart: 'in-memory' });
    target = t;
    addChunk = (c, meta) => m.addVideoChunk(c, meta);
    finalize = () => m.finalize();
  }

  const encoder = new VideoEncoder({
    output: (chunk, meta) => addChunk(chunk, meta),
    error: (e) => {
      failure = e instanceof Error ? e : new Error(String(e));
    },
  });
  encoder.configure({ ...base, codec });
  const frameDur = Math.round(1e6 / fps);
  try {
    for (let i = 0; i < total; i++) {
      check(o.signal);
      if (failure) throw failure;
      const canvas = src.draw(frameTime(i, fps, duration));
      const frame = new VideoFrame(canvas, { timestamp: Math.round((i * 1e6) / fps), duration: frameDur });
      encoder.encode(frame, { keyFrame: i % Math.max(1, Math.round(fps * 2)) === 0 });
      frame.close();
      while (encoder.encodeQueueSize > 6) await new Promise((r) => setTimeout(r, 2));
      o.onProgress?.(i + 1, total);
      if (i % 2 === 1) await tick();
    }
    await encoder.flush();
    if (failure) throw failure;
    finalize();
  } finally {
    if (encoder.state !== 'closed') encoder.close();
  }
  return new Uint8Array((target as WebmTarget).buffer);
}

// ---------- model export (glb / bvh) ----------

async function loadSkin(o: SceneObject): Promise<SkinRig | null> {
  const def = getCharacter(o.character);
  if (!def || def.kind === 'procedural') return null;
  try {
    const inst = await createSkinned(def.id);
    return { root: inst.root, prepare: (ob) => inst.setLook(ob.material, false), apply: (p, h) => inst.apply(p, h), dispose: () => inst.dispose() };
  } catch (e) {
    console.warn('[export] character failed to load, exporting the procedural doll instead', def.id, e);
    return null;
  }
}

function pickObjects(project: Project, refs: string[] | undefined): SceneObject[] {
  const all = project.objects.filter((o) => o.kind !== 'camera');
  if (!refs || !refs.length) return all;
  const out = refs.map((r) => all.find((o) => o.id === r) ?? all.find((o) => o.name === r) ?? null);
  const bad = refs.filter((_, i) => !out[i]);
  if (bad.length) throw new Error('Object not found (or not exportable): ' + bad.join(', '));
  return out as SceneObject[];
}

export async function exportModel(o: ExportOptions): Promise<{ bytes: Uint8Array; frames: number }> {
  const project = useStore.getState().project;
  const objs = pickObjects(project, o.objects);
  if (!objs.length) throw new Error('Nothing to export: add a mannequin or shape first');
  if (o.format === 'bvh') {
    const m = objs.find((x) => x.kind === 'mannequin');
    if (!m) throw new Error('BVH needs a mannequin');
    return { bytes: new TextEncoder().encode(buildBvh(project, m, o.fps)), frames: frameCount(project, o.fps) };
  }
  await charactersReady();
  const camera = project.objects.find((x) => x.kind === 'camera') ?? null;
  const aspect = o.width > 0 && o.height > 0 ? o.width / o.height : useUi.getState().renderAspect;
  const b = await buildGlbScene({ project, objects: objs, camera, fps: o.fps, aspect, loadSkin });
  try {
    check(o.signal);
    return { bytes: await writeGlb(b), frames: b.frames };
  } finally {
    b.dispose();
  }
}

// ---------- entry point ----------

export async function exportRender(o: ExportOptions): Promise<ExportResult> {
  const project = useStore.getState().project;
  const base = safeName(project.name);
  const done = (bytes: Uint8Array, width: number, height: number, frames: number): ExportResult => ({
    bytes,
    mime: mimeFor(o.format),
    ext: extFor(o.format),
    filename: `${base}.${extFor(o.format)}`,
    width,
    height,
    fps: o.fps,
    frames,
  });

  if (o.format === 'project') {
    return done(new TextEncoder().encode(JSON.stringify(project, null, 2)), 0, 0, 0);
  }

  if (isModelFormat(o.format)) {
    if (!Number.isInteger(o.fps) || o.fps < 1 || o.fps > 240) throw new Error('fps must be an integer 1..240');
    useStore.getState().pause();
    const m = await exportModel(o);
    o.onProgress?.(1, 1);
    return done(m.bytes, 0, 0, m.frames);
  }

  checkSize(o.width, o.height);
  if (!Number.isInteger(o.fps) || o.fps < 1 || o.fps > 240) throw new Error('fps must be an integer 1..240');
  if (o.transparent && o.format !== 'png' && o.format !== 'png_seq') throw new Error('Transparent background is only available for PNG and PNG sequence');
  const video = o.format === 'webm' || o.format === 'mp4';
  const [w, h] = video ? evenSize(o.width, o.height) : [o.width, o.height];

  useStore.getState().pause();
  const src = createFrameSource(w, h, !!o.transparent);
  try {
    check(o.signal);
    if (o.format === 'png') {
      const bytes = await toPng(src.draw(project.time));
      o.onProgress?.(1, 1);
      const r = done(bytes, w, h, 1);
      r.filename = `${base}_f${Math.round(project.time * project.fps)}.png`;
      return r;
    }
    const total = frameCount(project, o.fps);
    const duration = project.duration;
    if (o.format === 'png_seq') {
      const files: Record<string, Uint8Array> = {};
      const pad = Math.max(4, String(total).length);
      for (let i = 0; i < total; i++) {
        check(o.signal);
        files[`${base}_${String(i + 1).padStart(pad, '0')}.png`] = await toPng(src.draw(frameTime(i, o.fps, duration)));
        o.onProgress?.(i + 1, total);
        if (i % 2 === 1) await tick();
      }
      return done(zipSync(files, { level: 0 }), w, h, total);
    }
    const bytes = await encodeVideo(o.format as 'webm' | 'mp4', src, total, o.fps, duration, o);
    return done(bytes, w, h, total);
  } finally {
    src.dispose();
  }
}

export function downloadResult(r: ExportResult): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([r.bytes as BlobPart], { type: r.mime }));
  a.download = r.filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
