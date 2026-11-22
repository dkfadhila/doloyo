/** Greedy person tracking between video frames: hip-centre distance plus pose similarity. Pure TS. */

export interface Candidate {
  /** Hip centre in normalized image coordinates. */
  hip: [number, number];
  /** Pose descriptor: landmark offsets from the hip centre divided by torso length (see descriptor()). */
  desc: number[];
}

export interface TrackState {
  id: number;
  hip: [number, number];
  desc: number[];
  /** Frames since this track last matched a detection. */
  missed: number;
}

export interface MatchOptions {
  /** Max hip distance (normalized image units) for a match. */
  maxDist?: number;
  /** Weight of the pose distance relative to the hip distance. */
  poseWeight?: number;
  /** Tracks unmatched for more than this many frames are no longer candidates. */
  maxMissed?: number;
}

/** MediaPipe landmark ids used by the descriptor: shoulders, elbows, wrists, knees, ankles. */
export const DESC_IDS = [11, 12, 13, 14, 15, 16, 25, 26, 27, 28];

export function descriptor(lm: { x: number; y: number }[]): Candidate {
  const hip: [number, number] = [(lm[23].x + lm[24].x) / 2, (lm[23].y + lm[24].y) / 2];
  const sh: [number, number] = [(lm[11].x + lm[12].x) / 2, (lm[11].y + lm[12].y) / 2];
  const torso = Math.max(0.02, Math.hypot(sh[0] - hip[0], sh[1] - hip[1]));
  const desc: number[] = [];
  for (const i of DESC_IDS) desc.push((lm[i].x - hip[0]) / torso, (lm[i].y - hip[1]) / torso);
  return { hip, desc };
}

const poseDist = (a: number[], b: number[]) => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += (a[i] - b[i]) ** 2;
  return Math.sqrt(s / a.length);
};

/**
 * Assign detections to existing tracks (greedy by lowest cost). Returns, for each detection, the track id it was
 * matched to (or a freshly created id). `tracks` is updated in place (new tracks appended, matches refreshed).
 */
export function matchDetections(tracks: TrackState[], dets: Candidate[], nextId: { value: number }, o: MatchOptions = {}): number[] {
  const maxDist = o.maxDist ?? 0.25;
  const pw = o.poseWeight ?? 0.15;
  const maxMissed = o.maxMissed ?? 30;
  const pairs: { t: number; d: number; cost: number }[] = [];
  tracks.forEach((t, ti) => {
    if (t.missed > maxMissed) return;
    dets.forEach((d, di) => {
      const dist = Math.hypot(t.hip[0] - d.hip[0], t.hip[1] - d.hip[1]);
      if (dist > maxDist * (1 + Math.min(t.missed, 10) * 0.2)) return;
      pairs.push({ t: ti, d: di, cost: dist / maxDist + pw * poseDist(t.desc, d.desc) });
    });
  });
  pairs.sort((a, b) => a.cost - b.cost);
  const out: number[] = new Array(dets.length).fill(-1);
  const usedT = new Set<number>();
  for (const p of pairs) {
    if (usedT.has(p.t) || out[p.d] !== -1) continue;
    usedT.add(p.t);
    out[p.d] = tracks[p.t].id;
    Object.assign(tracks[p.t], { hip: dets[p.d].hip, desc: dets[p.d].desc, missed: 0 });
  }
  tracks.forEach((t, ti) => {
    if (!usedT.has(ti)) t.missed++;
  });
  dets.forEach((d, di) => {
    if (out[di] === -1) {
      const id = nextId.value++;
      tracks.push({ id, hip: d.hip, desc: d.desc, missed: 0 });
      out[di] = id;
    }
  });
  return out;
}
