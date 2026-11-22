import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { emptyPose } from '../core/rig';
import type { JointName, Pose } from '../core/types';
import { bodyPointsFromFK, rigFK, segmentDirections } from '../retarget/solver';
import { fillGaps, MP, trackToSamples, worldToPoints, type Detection, type LM, type Track } from './convert';
import { OneEuro } from './oneEuro';
import { descriptor, matchDetections, type TrackState } from './tracker';

describe('One-Euro filter', () => {
  it('passes a constant signal unchanged', () => {
    const f = new OneEuro(1, 0.5);
    for (let i = 0; i < 50; i++) expect(f.filter(2.5, i / 30)).toBeCloseTo(2.5, 9);
  });

  it('reduces jitter on a still signal', () => {
    const f = new OneEuro(1, 0);
    let rawVar = 0, outVar = 0;
    let s = 1;
    for (let i = 0; i < 300; i++) {
      s = (s * 16807) % 2147483647;
      const noise = (s / 2147483647 - 0.5) * 0.1;
      const y = f.filter(noise, i / 30);
      if (i > 30) {
        rawVar += noise * noise;
        outVar += y * y;
      }
    }
    expect(outVar).toBeLessThan(rawVar * 0.35);
  });

  it('a higher beta follows fast motion with less lag', () => {
    const lag = (beta: number) => {
      const f = new OneEuro(0.5, beta);
      let err = 0;
      for (let i = 0; i < 90; i++) {
        const t = i / 30;
        const x = Math.sin(t * 6) * 0.5; // fast sweep
        const y = f.filter(x, t);
        if (i > 10) err += Math.abs(x - y);
      }
      return err;
    };
    expect(lag(5)).toBeLessThan(lag(0));
  });

  it('converges after a step', () => {
    const f = new OneEuro(1.5, 0.8);
    f.filter(0, 0);
    let y = 0;
    for (let i = 1; i <= 60; i++) y = f.filter(1, i / 30);
    expect(y).toBeGreaterThan(0.99);
  });
});

/** Minimal landmark set around a hip centre, enough for descriptor(). */
function person(cx: number, cy: number, arm = 0): { x: number; y: number }[] {
  const lm = Array.from({ length: 33 }, () => ({ x: cx, y: cy }));
  const set = (i: number, dx: number, dy: number) => (lm[i] = { x: cx + dx, y: cy + dy });
  set(23, 0.03, 0); set(24, -0.03, 0);
  set(11, 0.05, -0.2); set(12, -0.05, -0.2);
  set(13, 0.08, -0.1 + arm); set(14, -0.08, -0.1);
  set(15, 0.1, 0 + arm); set(16, -0.1, 0);
  set(25, 0.03, 0.2); set(26, -0.03, 0.2);
  set(27, 0.03, 0.4); set(28, -0.03, 0.4);
  return lm;
}

describe('track matching', () => {
  it('keeps ids stable while two people move', () => {
    const tracks: TrackState[] = [];
    const next = { value: 1 };
    let ids: number[] = [];
    for (let f = 0; f < 30; f++) {
      const a = descriptor(person(0.25 + f * 0.003, 0.5));
      const b = descriptor(person(0.75 - f * 0.003, 0.5, 0.1));
      // detection order flips every frame: the tracker must not care
      const dets = f % 2 ? [b, a] : [a, b];
      const out = matchDetections(tracks, dets, next);
      const idA = f % 2 ? out[1] : out[0];
      const idB = f % 2 ? out[0] : out[1];
      if (f === 0) ids = [idA, idB];
      expect([idA, idB]).toEqual(ids);
    }
    expect(tracks.length).toBe(2);
  });

  it('creates a new track for a new person and keeps the old one through a short occlusion', () => {
    const tracks: TrackState[] = [];
    const next = { value: 1 };
    const first = matchDetections(tracks, [descriptor(person(0.3, 0.5))], next)[0];
    for (let i = 0; i < 5; i++) matchDetections(tracks, [], next); // occluded
    const back = matchDetections(tracks, [descriptor(person(0.32, 0.5))], next)[0];
    expect(back).toBe(first);
    const [again, other] = matchDetections(tracks, [descriptor(person(0.32, 0.5)), descriptor(person(0.8, 0.5))], next);
    expect(again).toBe(first);
    expect(other).not.toBe(first);
  });

  it('never assigns two detections to the same track', () => {
    const tracks: TrackState[] = [];
    const next = { value: 1 };
    matchDetections(tracks, [descriptor(person(0.5, 0.5))], next);
    const out = matchDetections(tracks, [descriptor(person(0.5, 0.5)), descriptor(person(0.52, 0.5))], next);
    expect(new Set(out).size).toBe(2);
  });
});

/** Inverse of worldToPoints for the landmarks the converter reads. */
function landmarksFromPoints(pose: Pose): { world: LM[]; image: LM[] } {
  const fk = rigFK(pose);
  const p = bodyPointsFromFK(fk);
  const world: LM[] = Array.from({ length: 33 }, () => ({ x: 0, y: 0, z: 0 }));
  const put = (i: number, v: [number, number, number]) => (world[i] = { x: v[0], y: -v[1], z: -v[2], visibility: 1 });
  const m = (a: [number, number, number], b: [number, number, number]): [number, number, number] => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
  put(MP.nose, p.nose!); put(MP.earL, p.earL!); put(MP.earR, p.earR!);
  put(MP.shoulderL, p.shoulderL); put(MP.shoulderR, p.shoulderR);
  put(MP.elbowL, p.elbowL); put(MP.elbowR, p.elbowR);
  put(MP.wristL, p.wristL); put(MP.wristR, p.wristR);
  // index and pinky straddle the hand centre
  put(MP.indexL, p.handL!); put(MP.pinkyL, p.handL!); put(MP.indexR, p.handR!); put(MP.pinkyR, p.handR!);
  put(MP.hipL, p.hipL); put(MP.hipR, p.hipR);
  put(MP.kneeL, p.kneeL); put(MP.kneeR, p.kneeR);
  put(MP.ankleL, p.ankleL); put(MP.ankleR, p.ankleR);
  put(MP.heelL, p.heelL!); put(MP.heelR, p.heelR!);
  put(MP.toeL, p.toeL!); put(MP.toeR, p.toeR!);
  void m;
  // image landmarks: a 640x480 frame, hips centred
  const image: LM[] = world.map((w) => ({ x: 0.5 + w.x * 0.5, y: 0.6 + w.y * 0.5, z: 0 }));
  return { world, image };
}

describe('MediaPipe conversion', () => {
  it('maps world landmarks to our frame (y up, left = +X, forward = +Z) and mirrors', () => {
    const pose = emptyPose();
    pose.L_shoulder = [-90, 0, 0]; // left arm raised forward
    const { world } = landmarksFromPoints(pose);
    const pts = worldToPoints(world, false);
    expect(pts.shoulderL[0]).toBeGreaterThan(pts.shoulderR[0]);
    expect(pts.wristL[2]).toBeGreaterThan(pts.shoulderL[2] + 0.3); // forward
    const mir = worldToPoints(world, true);
    // mirror: the raised arm is now the right arm and the whole motion is reflected
    expect(mir.wristR[2]).toBeGreaterThan(mir.shoulderR[2] + 0.3);
    expect(mir.shoulderL[0]).toBeGreaterThan(mir.shoulderR[0]);
  });

  it('track -> samples reproduces segment directions and keeps the lowest foot on the floor', () => {
    const base = emptyPose();
    const poses: Pose[] = [0, 1, 2, 3].map((i) => {
      const p = { ...base } as Pose;
      p.L_shoulder = [-40 - i * 20, 0, 20 + i * 15];
      p.L_elbow = [-30 - i * 25, 0, 0];
      p.R_hip = [-20 - i * 10, 0, -5];
      p.R_knee = [20 + i * 25, 0, 0];
      p.chest = [5 * i, 10 * i, 0];
      return p;
    });
    const frames = new Map<number, Detection>();
    poses.forEach((p, i) => frames.set(i, landmarksFromPoints(p)));
    const track: Track = { id: 1, color: '#fff', frames, first: 0, last: poses.length - 1 };
    const out = trackToSamples(track, { width: 640, height: 480, fps: 30, frames: 4, duration: 4 / 30 }, { fps: 30, minCutoff: 1000, beta: 0, footLock: true, inPlace: true, mirror: false, start: 2 });
    expect(out.length).toBe(4);
    expect(out[0].t).toBeCloseTo(2);
    expect(out[3].t).toBeCloseTo(2 + 3 / 30);
    // smoothing is effectively off (cutoff 1000 Hz): directions must match the source poses
    out.forEach((s, i) => {
      const want = segmentDirections(rigFK(poses[i]));
      const got = segmentDirections(rigFK(s.pose));
      for (const k of ['L_upperArm', 'L_foreArm', 'R_thigh', 'R_shin']) {
        expect((Math.acos(Math.min(1, want[k].dot(got[k]))) * 180) / Math.PI, `frame ${i} ${k}`).toBeLessThan(2);
      }
      // foot lock: after applying the hips offset the lowest foot point sits at the sole height
      const fk = rigFK(s.pose, s.hipsPos);
      const pts = bodyPointsFromFK(fk);
      const low = Math.min(pts.ankleL[1], pts.ankleR[1], pts.toeL![1], pts.toeR![1]);
      expect(low).toBeCloseTo(0.04, 2);
      expect(s.hipsPos[0]).toBeCloseTo(0, 6); // in place
    });
  });

  it('fills short gaps by interpolation and holds across long gaps', () => {
    const a = landmarksFromPoints(emptyPose());
    const p2 = emptyPose();
    p2.L_shoulder = [-90, 0, 0];
    const b = landmarksFromPoints(p2);
    const frames = new Map<number, Detection>([[0, a], [3, b], [20, b]]);
    const filled = fillGaps({ id: 1, color: '', frames, first: 0, last: 20 }, 5);
    expect(filled.map((f) => f.frame)).toEqual(Array.from({ length: 21 }, (_, i) => i).filter((i) => i <= 20));
    expect(filled[1].det.world[MP.wristL].z).not.toBe(a.world[MP.wristL].z); // interpolated
    expect(filled[10].det).toBe(b); // long gap: hold
    void Vector3;
    void ({} as JointName);
  });
});
