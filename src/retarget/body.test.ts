import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Vector3, type SkinnedMesh } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { describe, expect, it } from 'vitest';
import { QUATERNIUS_BONES, QUATERNIUS_CALIBRATION } from '../characters/registry';
import { ADULT, bodyProfile } from '../core/body';
import { emptyPose } from '../core/rig';
import type { BodyPreset } from '../core/types';
import { Retargeter } from './skeletal';

function loadGlb(file: string) {
  const b = readFileSync(resolve(__dirname, '../../public/assets', file));
  const ab = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
  return new Promise<import('three/examples/jsm/loaders/GLTFLoader.js').GLTF>((res, rej) => new GLTFLoader().parse(ab, '', res, rej));
}

/** Lowest sole vertex (vertices owned by the foot bones) and the head bone height, world y. */
function extent(rt: Retargeter): { min: number; max: number } {
  rt.root.updateMatrixWorld(true);
  let min = Infinity;
  const v = new Vector3();
  rt.model.traverse((o) => {
    const m = o as SkinnedMesh;
    if (!m.isSkinnedMesh) return;
    const si = m.geometry.getAttribute('skinIndex');
    const sw = m.geometry.getAttribute('skinWeight');
    for (let i = 0; i < si.count; i++) {
      let k = 0;
      for (let j = 1; j < 4; j++) if (sw.getComponent(i, j) > sw.getComponent(i, k)) k = j;
      const name = m.skeleton.bones[si.getComponent(i, k)].name;
      if (!/^(foot|ball)_/.test(name)) continue;
      m.getVertexPosition(i, v);
      m.applyBoneTransform(i, v);
      v.applyMatrix4(m.matrixWorld);
      min = Math.min(min, v.y);
    }
  });
  const max = rt.model.getObjectByName('Head')!.getWorldPosition(new Vector3()).y;
  return { min, max };
}

const PRESETS: BodyPreset[] = ['kecil', 'pendek', 'remaja', 'dewasa'];

describe('skinned body fit', () => {
  for (const file of ['mannequin_m.glb', 'mannequin_f.glb']) {
    it(`${file}: every preset stands on the floor with the hips at the profile height and scales with it`, async () => {
      const g = await loadGlb('characters/' + file);
      const rt = new Retargeter(g.scene, QUATERNIUS_BONES, QUATERNIUS_CALIBRATION);
      const tops: number[] = [];
      for (const preset of PRESETS) {
        const prof = bodyProfile(preset, 1, 'm');
        rt.setBody(prof.identity ? null : prof);
        rt.apply(emptyPose(), [0, 0, 0]);
        const e = extent(rt);
        // the unmodified adult keeps its original placement (the retargeted foot rests ~2 cm up); fitted bodies are grounded exactly
        expect(Math.abs(e.min), `${preset} soles`).toBeLessThan(prof.identity ? 0.03 : 0.01);
        const pelvis = rt.model.getObjectByName('pelvis')!.getWorldPosition(new Vector3());
        expect(Math.abs(pelvis.y - prof.hipsY), `${preset} hips height`).toBeLessThan(0.015);
        tops.push(e.max);
      }
      // strictly growing, and the baby is well under half the adult height
      for (let i = 1; i < tops.length; i++) expect(tops[i]).toBeGreaterThan(tops[i - 1]);
      expect(tops[0] / tops[3]).toBeLessThan(0.55);
    });
  }

  it('the height fine-tune scales the body and keeps the feet on the floor; null restores the original', async () => {
    const g = await loadGlb('characters/mannequin_m.glb');
    const rt = new Retargeter(g.scene, QUATERNIUS_BONES, QUATERNIUS_CALIBRATION);
    rt.apply(emptyPose(), [0, 0, 0]);
    const base = extent(rt);
    const tall = bodyProfile('dewasa', 1.1, 'm');
    rt.setBody(tall);
    rt.apply(emptyPose(), [0, 0, 0]);
    const e = extent(rt);
    expect(Math.abs(e.min)).toBeLessThan(0.01);
    expect(e.max / base.max).toBeGreaterThan(1.07);
    expect(e.max / base.max).toBeLessThan(1.13);
    rt.setBody(null);
    rt.apply(emptyPose(), [0, 0, 0]);
    const back = extent(rt);
    expect(back.max).toBeCloseTo(base.max, 4);
    expect(back.min).toBeCloseTo(base.min, 4);
  });

  it('hips translation is scaled by the body: a crouch keeps the lowest foot point on the floor', async () => {
    const g = await loadGlb('characters/mannequin_m.glb');
    const rt = new Retargeter(g.scene, QUATERNIUS_BONES, QUATERNIUS_CALIBRATION);
    const prof = bodyProfile('kecil', 1, 'm');
    rt.setBody(prof);
    const hipsPos: [number, number, number] = [0, -0.2, 0.1];
    rt.apply(emptyPose(), hipsPos);
    const rest = rt.model.getObjectByName('pelvis')!.getWorldPosition(new Vector3());
    rt.apply(emptyPose(), [0, 0, 0]);
    const zero = rt.model.getObjectByName('pelvis')!.getWorldPosition(new Vector3());
    rt.root.updateMatrixWorld(true);
    expect(rest.y - zero.y).toBeCloseTo(-0.2 * prof.hipsScale, 3);
    expect(rest.z - zero.z).toBeCloseTo(0.1 * prof.hipsScale, 3);
    // read() gives back adult units
    rt.apply(emptyPose(), hipsPos);
    rt.root.updateMatrixWorld(true);
    const back = rt.read().hipsPos;
    expect(back[1]).toBeCloseTo(-0.2, 3);
    expect(ADULT.hipsScale).toBe(1);
  });
});
