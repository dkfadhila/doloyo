import type { PoseLandmarker } from '@mediapipe/tasks-vision';
import { assetUrl } from '../characters/registry';
import type { Detection, Track, VideoInfo } from './convert';
import { descriptor, matchDetections, type TrackState } from './tracker';

const base = (import.meta as unknown as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/';
const mpUrl = (p: string) => base.replace(/\/$/, '') + '/mediapipe/' + p;
export { assetUrl };

export const TRACK_COLORS = ['#3B6FE0', '#E0A23B', '#3BC9A0', '#E0564F', '#A06BE0', '#9BC93B'];

export type ModelSize = 'full' | 'heavy';
export const MODEL_FILE: Record<ModelSize, string> = { full: 'pose_landmarker_full.task', heavy: 'pose_landmarker_heavy.task' };

export class MissingModelError extends Error {}

/** Pinned CDN fallbacks, used only when public/mediapipe is missing (hosted builds without fetch-models). */
export const MP_VERSION = '0.10.8';
export const CDN_WASM = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}/wasm`;
const CDN_MODEL_BASE = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker';
export const cdnModelUrl = (size: ModelSize) => `${CDN_MODEL_BASE}/pose_landmarker_${size}/float16/latest/${MODEL_FILE[size]}`;

export type ModelSource = 'local' | 'cdn';
let lastSource: ModelSource | null = null;
export const getModelSource = () => lastSource;

async function exists(url: string): Promise<boolean> {
  try {
    const r = await fetch(url, { method: 'HEAD' });
    // Vite dev serves index.html for unknown paths, so look at the content type too
    return r.ok && !(r.headers.get('content-type') ?? '').includes('html');
  } catch {
    return false;
  }
}

/** Local files win when both the model and the WASM runtime exist; otherwise fall back to the pinned CDN copies. */
export async function resolveModelSource(size: ModelSize): Promise<{ source: ModelSource; wasm: string; model: string }> {
  const localModel = mpUrl(MODEL_FILE[size]);
  const localWasm = mpUrl('wasm');
  const local = (await exists(localModel)) && (await exists(localWasm + '/vision_wasm_internal.wasm'));
  lastSource = local ? 'local' : 'cdn';
  return local ? { source: 'local', wasm: localWasm, model: localModel } : { source: 'cdn', wasm: CDN_WASM, model: cdnModelUrl(size) };
}

async function createLandmarker(size: ModelSize, numPoses: number, delegate: 'GPU' | 'CPU'): Promise<PoseLandmarker> {
  const { FilesetResolver, PoseLandmarker } = await import('@mediapipe/tasks-vision'); // heavy: loaded on first use
  const src = await resolveModelSource(size);
  try {
    const fileset = await FilesetResolver.forVisionTasks(src.wasm);
    return await PoseLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: src.model, delegate },
      runningMode: 'VIDEO',
      numPoses,
      minPoseDetectionConfidence: 0.5,
      minPosePresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });
  } catch (e) {
    if (src.source === 'cdn' && !navigator.onLine) throw new MissingModelError(`The pose model is not bundled with this build and could not be downloaded (offline). Run "npm run fetch-models" in a local install, or reconnect and retry.`);
    throw e;
  }
}

export interface AnalyzeOptions {
  maxPeople: number;
  fps: number;
  model?: ModelSize;
  signal?: AbortSignal;
  onProgress?: (done: number, total: number, delegate: string) => void;
}

export interface VideoAnalysis {
  video: VideoInfo;
  tracks: Track[];
  delegate: 'GPU' | 'CPU';
}

export class AnalyzeCancelled extends Error {
  constructor() {
    super('Analysis cancelled');
  }
}

function seek(video: HTMLVideoElement, t: number): Promise<void> {
  return new Promise((resolve, reject) => {
    if (Math.abs(video.currentTime - t) < 1e-4 && video.readyState >= 2) return resolve();
    const done = () => {
      video.removeEventListener('seeked', done);
      video.removeEventListener('error', fail);
      resolve();
    };
    const fail = () => {
      video.removeEventListener('seeked', done);
      video.removeEventListener('error', fail);
      reject(new Error('The video could not be decoded (try MP4/H.264 or WebM).'));
    };
    video.addEventListener('seeked', done);
    video.addEventListener('error', fail);
    video.currentTime = t;
  });
}

/** Wait until the video element knows its size and duration. */
export function videoReady(video: HTMLVideoElement): Promise<void> {
  return new Promise((resolve, reject) => {
    if (video.readyState >= 1 && video.videoWidth) return resolve();
    video.addEventListener('loadedmetadata', () => resolve(), { once: true });
    video.addEventListener('error', () => reject(new Error('The video could not be loaded (try MP4/H.264 or WebM).')), { once: true });
  });
}

/**
 * Run PoseLandmarker in VIDEO mode, stepping the video with currentTime at `fps`, and build person tracks.
 * GPU delegate first, CPU fallback.
 */
export async function analyzeVideo(video: HTMLVideoElement, o: AnalyzeOptions): Promise<VideoAnalysis> {
  await videoReady(video);
  const size = o.model ?? 'full';
  const fps = o.fps;
  const duration = video.duration;
  if (!isFinite(duration) || duration <= 0) throw new Error('The video has no usable duration.');
  const frames = Math.max(1, Math.floor(duration * fps));
  const info: VideoInfo = { width: video.videoWidth, height: video.videoHeight, fps, frames, duration };

  let delegate: 'GPU' | 'CPU' = 'GPU';
  let lm: PoseLandmarker;
  try {
    lm = await createLandmarker(size, o.maxPeople, 'GPU');
  } catch (e) {
    if (e instanceof MissingModelError) throw e;
    delegate = 'CPU';
    lm = await createLandmarker(size, o.maxPeople, 'CPU');
  }

  const states: TrackState[] = [];
  const tracks = new Map<number, Track>();
  const nextId = { value: 1 };
  let stamp = 0;
  try {
    for (let i = 0; i < frames; i++) {
      if (o.signal?.aborted) throw new AnalyzeCancelled();
      await seek(video, Math.min(duration - 0.001, i / fps));
      stamp += 1 + Math.round(1000 / fps); // strictly increasing timestamps in ms
      let res;
      try {
        res = lm.detectForVideo(video, stamp);
      } catch (e) {
        if (delegate === 'GPU') {
          // some GPUs/drivers only fail at the first inference: restart on CPU
          lm.close();
          delegate = 'CPU';
          lm = await createLandmarker(size, o.maxPeople, 'CPU');
          res = lm.detectForVideo(video, stamp);
        } else throw e;
      }
      const dets: Detection[] = res.landmarks.map((image, k) => ({ image, world: res.worldLandmarks[k] }));
      const cands = dets.map((d) => descriptor(d.image));
      const ids = matchDetections(states, cands, nextId);
      ids.forEach((id, k) => {
        let tr = tracks.get(id);
        if (!tr) {
          tr = { id, color: TRACK_COLORS[(id - 1) % TRACK_COLORS.length], frames: new Map(), first: i, last: i };
          tracks.set(id, tr);
        }
        tr.frames.set(i, dets[k]);
        tr.last = i;
      });
      o.onProgress?.(i + 1, frames, delegate);
      if (i % 4 === 3) await new Promise((r) => setTimeout(r, 0));
    }
  } finally {
    lm.close();
  }
  // drop flickers: tracks seen in fewer than 5% of the frames (and < 8 frames)
  const list = [...tracks.values()].filter((t) => t.frames.size >= Math.min(8, frames * 0.05));
  list.sort((a, b) => b.frames.size - a.frames.size);
  return { video: info, tracks: list, delegate };
}

/** Skeleton lines for the overlay (same as MediaPipe POSE_CONNECTIONS, kept here so the library is not loaded just to draw). */
const PAIRS = [
  [0, 1], [1, 2], [2, 3], [3, 7], [0, 4], [4, 5], [5, 6], [6, 8], [9, 10], [11, 12], [11, 13], [13, 15], [15, 17], [15, 19], [15, 21], [17, 19],
  [12, 14], [14, 16], [16, 18], [16, 20], [16, 22], [18, 20], [11, 23], [12, 24], [23, 24], [23, 25], [24, 26], [25, 27], [26, 28],
  [27, 29], [28, 30], [29, 31], [30, 32], [27, 31], [28, 32],
];
export const POSE_CONNECTIONS = PAIRS.map(([start, end]) => ({ start, end }));
