import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { describe, expect, it } from 'vitest';
import { QUATERNIUS_BONES, QUATERNIUS_CALIBRATION } from '../characters/registry';
import { Retargeter } from '../retarget/skeletal';
import { rigFK } from '../retarget/solver';
import { ClipSampler, DEFAULT_APPLY, mirrorSample, sampleClip, type ClipInfo } from './library';

const load = (file: string) => {
  const b = readFileSync(resolve(__dirname, '../../public/assets', file));
  const ab = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
  return new Promise<GLTF>((res, rej) => new GLTFLoader().parse(ab, '', res, rej));
};

async function sampler(file: string, name: string) {
  const g = await load(`anims/${file}.glb`);
  const clip = g.animations.find((c) => c.name === name)!;
  expect(clip, name).toBeTruthy();
  const info: ClipInfo = { id: `${file}/${name}`, file: file as 'ual1', name, duration: clip.duration };
  return { s: new ClipSampler(new Retargeter(clone(g.scene), QUATERNIUS_BONES, QUATERNIUS_CALIBRATION), clip), info };
}

describe('animation library sampling', () => {
  it('index.json matches the GLB files (86 clips)', async () => {
    const idx = JSON.parse(readFileSync(resolve(__dirname, '../../public/assets/anims/index.json'), 'utf8')).clips as ClipInfo[];
    expect(idx.length).toBe(86);
    const g1 = await load('anims/ual1.glb');
    expect(g1.animations.length).toBe(43);
    expect(idx.filter((c) => c.file === 'ual1').map((c) => c.name).sort()).toEqual(g1.animations.map((c) => c.name).sort());
  });

  it('the A_TPose clip converts to a T-pose (arms out sideways)', async () => {
    const { s } = await sampler('ual1', 'A_TPose');
    const { pose } = s.sample(0.5);
    // our t_pose preset is L_shoulder [0,0,90], R_shoulder [0,0,-90]; the clip pose is within a few degrees of it
    const fk = rigFK(pose);
    const arm = fk.L_elbow.pos.clone().sub(fk.L_shoulder.pos).normalize();
    expect(arm.x).toBeGreaterThan(0.9);
    expect(Math.abs(arm.y)).toBeLessThan(0.4);
    const armR = fk.R_elbow.pos.clone().sub(fk.R_shoulder.pos).normalize();
    expect(armR.x).toBeLessThan(-0.9);
  });

  it('samples a walk on the frame grid with hips motion and finite values', async () => {
    const { s, info } = await sampler('ual1', 'Walk_Loop');
    const out = sampleClip(s, info, { ...DEFAULT_APPLY, start: 1, fps: 30, every: 3 });
    expect(out[0].t).toBeCloseTo(1);
    expect(out[out.length - 1].t).toBeCloseTo(1 + Math.round(info.duration * 30) / 30); // always ends exactly on the last frame
    for (let i = 1; i < out.length; i++) expect(out[i].t).toBeGreaterThan(out[i - 1].t);
    for (const o of out) for (const v of Object.values(o.pose)) for (const n of v) expect(Number.isFinite(n)).toBe(true);
    // legs swing: the hip flexion range over the loop is large
    const xs = out.map((o) => o.pose.L_hip[0]);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(25);
    // standing hips height stays near the rig's rest height
    for (const o of out) expect(Math.abs(o.hipsPos[1])).toBeLessThan(0.3);
  });

  it('a looping clip ends where it starts; inPlace drops horizontal travel; mirror swaps sides', async () => {
    const { s, info } = await sampler('ual1', 'Walk_Loop');
    const out = sampleClip(s, info, { ...DEFAULT_APPLY, start: 0, fps: 30, every: 1, inPlace: true });
    expect(out[0].hipsPos[0]).toBe(0);
    expect(out.every((o) => o.hipsPos[0] === 0 && o.hipsPos[2] === 0)).toBe(true);
    const a = out[0].pose, z = out[out.length - 1].pose;
    for (const j of ['L_hip', 'L_knee', 'R_shoulder'] as const) {
      for (let i = 0; i < 3; i++) expect(Math.abs(a[j][i] - z[j][i])).toBeLessThan(6);
    }
    const m = mirrorSample(out[5]);
    expect(m.pose.R_hip[0]).toBeCloseTo(out[5].pose.L_hip[0], 6);
    expect(m.pose.R_shoulder[2]).toBeCloseTo(-out[5].pose.L_shoulder[2], 6);
  });
});
