/** MediaPipe pose landmarks -> our rig samples. Pure TS (no MediaPipe import) so it can be unit-tested. */
import type { BakeSample } from '../core/bake';
import type { Pose, Vec3 } from '../core/types';
import { bodyPointsFromFK, rigFK, solvePose, type BodyPoints } from '../retarget/solver';
import { OneEuro, OneEuroBank } from './oneEuro';

export interface LM {
  x: number;
  y: number;
  z: number;
  visibility?: number;
}

/** One person in one video frame. `image` is normalized (0..1), `world` is meters centred on the hips. */
export interface Detection {
  image: LM[];
  world: LM[];
}

export interface Track {
  id: number;
  color: string;
  /** frame index -> detection */
  frames: Map<number, Detection>;
  first: number;
  last: number;
}

export interface VideoInfo {
  width: number;
  height: number;
  fps: number;
  frames: number;
  duration: number;
}

export interface ConvertOptions {
  fps: number;
  /** One-Euro parameters (seconds-based). */
  minCutoff: number;
  beta: number;
  footLock: boolean;
  inPlace: boolean;
  /** Mirror (selfie video): flips left/right. */
  mirror: boolean;
  /** Project time of the origin frame. */
  start: number;
  /** Video frame that maps to `start` (default: the track's first frame). Use the earliest first frame of all assigned tracks to keep dancers in sync. */
  originFrame?: number;
}

export const DEFAULT_CONVERT: Omit<ConvertOptions, 'fps' | 'start'> = { minCutoff: 1.5, beta: 0.8, footLock: true, inPlace: false, mirror: false };

/** MediaPipe pose landmark ids. */
export const MP = {
  nose: 0, earL: 7, earR: 8, shoulderL: 11, shoulderR: 12, elbowL: 13, elbowR: 14, wristL: 15, wristR: 16,
  pinkyL: 17, pinkyR: 18, indexL: 19, indexR: 20, hipL: 23, hipR: 24, kneeL: 25, kneeR: 26,
  ankleL: 27, ankleR: 28, heelL: 29, heelR: 30, toeL: 31, toeR: 32,
} as const;

const SOLE = 0.04; // ankle joint height above the sole in our rig

/**
 * Coordinates: MediaPipe world is x to the image right, y down, z away from the camera (smaller = closer).
 * Our frame: +X character left, +Y up, +Z forward. A subject facing the camera has their left on the image right,
 * so x maps straight across, y flips, and z flips (towards the camera = forward). `mirror` flips x and swaps the
 * left/right landmarks, which is a true mirror image of the motion (selfie videos).
 */
export function worldToPoints(world: LM[], mirror: boolean): BodyPoints {
  const mx = mirror ? -1 : 1;
  const P = (i: number): Vec3 => [mx * world[i].x, -world[i].y, -world[i].z];
  const pick = (l: number, r: number): [Vec3, Vec3] => (mirror ? [P(r), P(l)] : [P(l), P(r)]);
  const mid = (a: Vec3, b: Vec3): Vec3 => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
  const [hipL, hipR] = pick(MP.hipL, MP.hipR);
  const [shoulderL, shoulderR] = pick(MP.shoulderL, MP.shoulderR);
  const [elbowL, elbowR] = pick(MP.elbowL, MP.elbowR);
  const [wristL, wristR] = pick(MP.wristL, MP.wristR);
  const [kneeL, kneeR] = pick(MP.kneeL, MP.kneeR);
  const [ankleL, ankleR] = pick(MP.ankleL, MP.ankleR);
  const [toeL, toeR] = pick(MP.toeL, MP.toeR);
  const [heelL, heelR] = pick(MP.heelL, MP.heelR);
  const [earL, earR] = pick(MP.earL, MP.earR);
  const [pinkyL, pinkyR] = pick(MP.pinkyL, MP.pinkyR);
  const [indexL, indexR] = pick(MP.indexL, MP.indexR);
  return {
    hipL, hipR, shoulderL, shoulderR, elbowL, elbowR, wristL, wristR, kneeL, kneeR, ankleL, ankleR,
    toeL, toeR, heelL, heelR, earL, earR, nose: P(MP.nose),
    handL: mid(pinkyL, indexL), handR: mid(pinkyR, indexR),
  };
}

const flatten = (lm: LM[]) => lm.flatMap((p) => [p.x, p.y, p.z]);
const unflatten = (v: number[]): LM[] => Array.from({ length: v.length / 3 }, (_, i) => ({ x: v[i * 3], y: v[i * 3 + 1], z: v[i * 3 + 2] }));

/** Detections for every frame index first..last; gaps up to maxGap frames are interpolated, longer gaps hold the last pose. */
export function fillGaps(track: Track, maxGap: number): { frame: number; det: Detection }[] {
  const out: { frame: number; det: Detection }[] = [];
  let prev: { frame: number; det: Detection } | null = null;
  for (let f = track.first; f <= track.last; f++) {
    const det = track.frames.get(f);
    if (det) {
      if (prev && f - prev.frame > 1 && f - prev.frame <= maxGap + 1) {
        for (let g = prev.frame + 1; g < f; g++) {
          const u = (g - prev.frame) / (f - prev.frame);
          const lerp = (a: LM[], b: LM[]) => a.map((p, i) => ({ x: p.x + (b[i].x - p.x) * u, y: p.y + (b[i].y - p.y) * u, z: p.z + (b[i].z - p.z) * u }));
          out.push({ frame: g, det: { image: lerp(prev.det.image, det.image), world: lerp(prev.det.world, det.world) } });
        }
      } else if (prev && f - prev.frame > 1) {
        for (let g = prev.frame + 1; g < f; g++) out.push({ frame: g, det: prev.det });
      }
      prev = { frame: f, det };
      out.push(prev);
    }
  }
  return out;
}

/** Torso length (hip centre to shoulder centre) in meters, from world landmarks. */
function worldTorso(w: LM[]): number {
  const m = (a: LM, b: LM) => [(a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2];
  const h = m(w[MP.hipL], w[MP.hipR]);
  const s = m(w[MP.shoulderL], w[MP.shoulderR]);
  return Math.hypot(s[0] - h[0], s[1] - h[1], s[2] - h[2]);
}

/**
 * Convert one tracked person to bake samples (one per video frame at `o.fps`, which must equal the analysis fps).
 * Smoothing is applied to the 3D landmarks (before solving) so rotations never see raw jitter.
 */
export function trackToSamples(track: Track, video: VideoInfo, o: ConvertOptions): BakeSample[] {
  const frames = fillGaps(track, Math.round(video.fps * 0.5));
  if (!frames.length) return [];
  const bank = new OneEuroBank(33 * 3, o.minCutoff, o.beta);
  const fx = new OneEuro(o.minCutoff, o.beta);
  const fy = new OneEuro(o.minCutoff, o.beta);
  const fhx = new OneEuro(o.minCutoff, o.beta);
  const fhy = new OneEuro(o.minCutoff, o.beta);

  // meters per image pixel for hip travel: median over the track of world torso / image torso (px)
  const ratios: number[] = [];
  for (const { det } of frames) {
    const im = det.image;
    const hx = (im[MP.hipL].x + im[MP.hipR].x) / 2, hy = (im[MP.hipL].y + im[MP.hipR].y) / 2;
    const sx = (im[MP.shoulderL].x + im[MP.shoulderR].x) / 2, sy = (im[MP.shoulderL].y + im[MP.shoulderR].y) / 2;
    const px = Math.hypot((sx - hx) * video.width, (sy - hy) * video.height);
    if (px > 5) ratios.push(worldTorso(det.world) / px);
  }
  ratios.sort((a, b) => a - b);
  const mpp = ratios.length ? ratios[Math.floor(ratios.length / 2)] : 0;
  const mx = o.mirror ? -1 : 1;

  const samples: BakeSample[] = [];
  let cx0: number | null = null, cy0: number | null = null;
  const startFrame = o.originFrame ?? frames[0].frame;
  for (const { frame, det } of frames) {
    const t = frame / video.fps;
    const world = unflatten(bank.filter(flatten(det.world), t));
    const sol = solvePose(worldToPoints(world, o.mirror));
    const pose: Pose = sol.pose;

    const im = det.image;
    const cx = fhx.filter((im[MP.hipL].x + im[MP.hipR].x) / 2, t);
    const cy = fhy.filter((im[MP.hipL].y + im[MP.hipR].y) / 2, t);
    cx0 ??= cx;
    cy0 ??= cy;
    let hx = 0, hy = 0;
    if (!o.inPlace) hx = mx * (cx - cx0) * video.width * mpp;
    if (o.footLock) {
      const fk = rigFK(pose);
      const pts = bodyPointsFromFK(fk);
      const low = Math.min(pts.ankleL[1], pts.ankleR[1], pts.toeL![1], pts.toeR![1]);
      hy = SOLE - low; // lift so the lowest foot point rests on y = 0 (fk is evaluated with hipsPos = 0)
    } else {
      hy = -(cy - cy0) * video.height * mpp;
    }
    samples.push({ t: o.start + (frame - startFrame) / video.fps, pose, hipsPos: [fx.filter(hx, t), fy.filter(hy, t), 0] });
  }
  return samples;
}
