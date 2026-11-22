import { WebIO } from '@gltf-transform/core';
import { Bone, Group, Mesh, MeshBasicMaterial, Object3D, Skeleton, SkinnedMesh, BoxGeometry, Uint16BufferAttribute, Float32BufferAttribute, Vector3 } from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { applyCommand, newProject, type Command } from '../core/commands';
import { fk } from '../core/ik';
import { evaluateProject } from '../core/interpolate';
import { PROCEDURAL_CHARACTER, type Project, type SceneObject } from '../core/types';
import { buildBvh, buildGlbScene, writeGlb, type SkinRig } from './glb';

// GLTFExporter uses FileReader to assemble the binary; node only has Blob.
beforeAll(() => {
  class NodeFileReader {
    result: ArrayBuffer | string | null = null;
    onloadend: (() => void) | null = null;
    onload: (() => void) | null = null;
    readAsArrayBuffer(blob: Blob) {
      void blob.arrayBuffer().then((b) => {
        this.result = b;
        this.onloadend?.();
        this.onload?.();
      });
    }
    readAsDataURL(blob: Blob) {
      void blob.arrayBuffer().then((b) => {
        this.result = 'data:application/octet-stream;base64,' + Buffer.from(b).toString('base64');
        this.onloadend?.();
        this.onload?.();
      });
    }
  }
  (globalThis as unknown as { FileReader: unknown }).FileReader = NodeFileReader;
});

const run = (p: Project, c: Command) => applyCommand(p, c).project;

function animatedProject(): Project {
  let p = newProject();
  const id = p.objects[0].id;
  p = run(p, { type: 'object_transform', object: id, name: 'Dancer' });
  p = run(p, { type: 'object_set_character', object: id, character: PROCEDURAL_CHARACTER });
  p = run(p, { type: 'timeline_set', fps: 10, duration: 1 });
  p = run(p, { type: 'key_add', object: id, time: 0 });
  p = run(p, { type: 'joint_set', object: id, joint: 'R_shoulder', rotation: [-60, 0, -80] });
  p = run(p, { type: 'joint_set', object: id, joint: 'hips', position: [0.1, -0.1, 0] });
  p = run(p, { type: 'object_transform', object: id, position: [1, 0, 0], rotation: [0, 30, 0] });
  p = run(p, { type: 'key_add', object: id, time: 1 });
  p = run(p, { type: 'camera_set', position: [0, 1.5, 4], target: [0, 1, 0], fov: 35 });
  const cam = p.objects.find((o) => o.kind === 'camera')!.id;
  p = run(p, { type: 'key_add', object: cam, time: 0 });
  p = run(p, { type: 'camera_set', position: [3, 1.5, 3], target: [0, 1, 0], fov: 50 });
  p = run(p, { type: 'key_add', object: cam, time: 1 });
  return run(p, { type: 'playhead_seek', time: 0 });
}

describe('GLB export', () => {
  it('builds a clip with baked tracks at the project fps (procedural doll + render camera)', async () => {
    const p = animatedProject();
    const b = await buildGlbScene({ project: p, objects: p.objects.filter((o) => o.kind === 'mannequin'), camera: p.objects.find((o) => o.kind === 'camera'), fps: 10, aspect: 16 / 9 });
    expect(b.frames).toBe(11);
    expect(b.duration).toBeCloseTo(1, 6);
    const names = b.clip.tracks.map((t) => t.name);
    expect(names).toContain('Dancer.position');
    expect(names).toContain('Dancer_R_shoulder.quaternion');
    expect(names).toContain('Dancer_hips.position');
    expect(names).toContain('RenderCamera.position');
    expect(names).toContain('RenderCamera.quaternion');
    expect(names).not.toContain('Dancer_head.quaternion'); // static joints are not animated
    const t = b.clip.tracks.find((x) => x.name === 'Dancer.position')!;
    expect(t.times.length).toBe(11);
    expect(Array.from(t.values.slice(15, 18))).toEqual([0.5, 0, 0]); // frame 5, halfway to x=1
    // the joint hierarchy matches the rig
    expect(b.scene.getObjectByName('Dancer_L_wrist')!.parent!.name).toBe('Dancer_L_elbow');
    expect(b.scene.getObjectByName('Dancer_hips')!.parent!.name).toBe('Dancer');
    b.dispose();
  });

  it('writes a parseable GLB with a skeleton of nodes, meshes, an animation and a camera', async () => {
    const p = animatedProject();
    const b = await buildGlbScene({ project: p, objects: p.objects.filter((o) => o.kind === 'mannequin'), camera: p.objects.find((o) => o.kind === 'camera'), fps: 10, aspect: 16 / 9 });
    const bytes = await writeGlb(b);
    b.dispose();
    expect(new TextDecoder().decode(bytes.subarray(0, 4))).toBe('glTF');
    expect(new DataView(bytes.buffer, bytes.byteOffset).getUint32(4, true)).toBe(2);
    expect(new DataView(bytes.buffer, bytes.byteOffset).getUint32(8, true)).toBe(bytes.length);

    const doc = await new WebIO().readBinary(bytes);
    const root = doc.getRoot();
    expect(root.listAnimations()).toHaveLength(1);
    const anim = root.listAnimations()[0];
    const targets = new Set(anim.listChannels().map((c) => `${c.getTargetNode()!.getName()}.${c.getTargetPath()}`));
    expect(targets.has('Dancer_R_shoulder.rotation')).toBe(true);
    expect(targets.has('Dancer.translation')).toBe(true);
    expect(targets.has('RenderCamera.translation')).toBe(true);
    const sh = anim.listChannels().find((c) => c.getTargetNode()!.getName() === 'Dancer_R_shoulder' && c.getTargetPath() === 'rotation')!;
    expect(sh.getSampler()!.getInput()!.getCount()).toBe(11);
    expect(sh.getSampler()!.getInput()!.getMax([])[0]).toBeCloseTo(1, 5);
    // 17 joint nodes, each with the doll geometry that belongs to it
    const nodes = root.listNodes().map((n) => n.getName());
    for (const j of ['hips', 'spine', 'chest', 'neck', 'head', 'L_shoulder', 'R_ankle']) expect(nodes).toContain(`Dancer_${j}`);
    expect(root.listMeshes().length).toBeGreaterThan(15);
    expect(root.listCameras()).toHaveLength(1);
    expect(root.listCameras()[0].getYFov()).toBeCloseTo((35 * Math.PI) / 180, 4);
    // the last baked rotation of the shoulder equals the evaluated pose at t = 1
    const last = sh.getSampler()!.getOutput()!.getElement(10, []);
    expect(last).toHaveLength(4);
    expect(Math.hypot(...last)).toBeCloseTo(1, 4);
  });

  it('exports only the selected objects and unique names for duplicates', async () => {
    let p = animatedProject();
    p = run(p, { type: 'object_add', kind: 'mannequin', name: 'Dancer', character: PROCEDURAL_CHARACTER });
    p = run(p, { type: 'object_add', kind: 'cube' });
    const dolls = p.objects.filter((o) => o.kind !== 'camera');
    const all = await buildGlbScene({ project: p, objects: dolls, fps: 10, aspect: 1 });
    expect(all.names).toEqual(['Dancer', 'Dancer_2', 'Cube_1']);
    expect(all.scene.getObjectByName('Dancer_2_hips')).toBeTruthy();
    expect(all.scene.getObjectByName('RenderCamera')).toBeUndefined();
    all.dispose();
    const one = await buildGlbScene({ project: p, objects: [dolls[2]], fps: 10, aspect: 1 });
    expect(one.names).toEqual(['Cube_1']);
    one.dispose();
  });

  it('bakes skinned characters: bone quaternion tracks sampled through the rig, unique bone names, skin kept', async () => {
    const p = animatedProject();
    const doll = p.objects.find((o) => o.kind === 'mannequin') as SceneObject;
    // a tiny skinned model (3 bones) with a rig that follows the R_shoulder pose
    const root = new Group();
    const b0 = new Bone();
    b0.name = 'pelvis';
    const b1 = new Bone();
    b1.name = 'arm';
    b1.position.set(0, 1, 0);
    b0.add(b1);
    root.add(b0);
    const geo = new BoxGeometry(1, 2, 1, 1, 2, 1);
    const n = geo.getAttribute('position').count;
    geo.setAttribute('skinIndex', new Uint16BufferAttribute(new Array(n * 4).fill(0).map((_, i) => (i % 4 === 0 ? (geo.getAttribute('position').getY(Math.floor(i / 4)) > 0 ? 1 : 0) : 0)), 4));
    geo.setAttribute('skinWeight', new Float32BufferAttribute(new Array(n * 4).fill(0).map((_, i) => (i % 4 === 0 ? 1 : 0)), 4));
    const mesh = new SkinnedMesh(geo, new MeshBasicMaterial());
    mesh.name = 'Body';
    mesh.add(b0);
    mesh.bind(new Skeleton([b0, b1]));
    root.add(mesh);
    const applied: number[] = [];
    const rig: SkinRig = {
      root,
      apply: (pose) => {
        applied.push(pose.R_shoulder[2]);
        b1.rotation.set(0, 0, (pose.R_shoulder[2] * Math.PI) / 180);
      },
    };
    let disposed = false;
    const b = await buildGlbScene({
      project: p,
      objects: [doll],
      fps: 10,
      aspect: 1,
      loadSkin: async () => ({ ...rig, dispose: () => (disposed = true) }),
    });
    expect(applied).toHaveLength(11);
    expect(applied[0]).toBe(0);
    expect(applied[10]).toBe(-80);
    const names = b.clip.tracks.map((t) => t.name);
    expect(names).toContain('Dancer__arm.quaternion');
    expect(names).not.toContain('Dancer__pelvis.quaternion');
    const bytes = await writeGlb(b);
    b.dispose();
    expect(disposed).toBe(true);
    const doc = await new WebIO().readBinary(bytes);
    expect(doc.getRoot().listSkins()).toHaveLength(1);
    expect(doc.getRoot().listSkins()[0].listJoints().map((j) => j.getName())).toEqual(['Dancer__pelvis', 'Dancer__arm']);
    const anim = doc.getRoot().listAnimations()[0];
    expect(anim.listChannels().some((c) => c.getTargetNode()!.getName() === 'Dancer__arm' && c.getTargetPath() === 'rotation')).toBe(true);
    void new Mesh();
    void new Object3D();
    void new Vector3();
  });

  it('GLB without any animation is still valid (static scene)', async () => {
    const p = newProject();
    const b = await buildGlbScene({ project: p, objects: p.objects, fps: 24, aspect: 1 });
    expect(b.clip.tracks).toHaveLength(0);
    const doc = await new WebIO().readBinary(await writeGlb(b));
    expect(doc.getRoot().listAnimations()).toHaveLength(0);
    expect(doc.getRoot().listNodes().length).toBeGreaterThan(17);
    b.dispose();
  });
});

describe('BVH export', () => {
  it('writes the 17-joint hierarchy and one line of channel values per frame', () => {
    const p = animatedProject();
    const doll = p.objects.find((o) => o.kind === 'mannequin') as SceneObject;
    const text = buildBvh(p, doll, 10);
    const lines = text.trim().split('\n');
    expect(lines[0]).toBe('HIERARCHY');
    expect(lines.filter((l) => /^\s*(ROOT|JOINT) /.test(l))).toHaveLength(17);
    expect(lines.filter((l) => l.includes('End Site'))).toHaveLength(5); // head, wrists, ankles
    const i = lines.indexOf('MOTION');
    expect(lines[i + 1]).toBe('Frames: 11');
    expect(lines[i + 2]).toBe('Frame Time: 0.100000');
    const rows = lines.slice(i + 3);
    expect(rows).toHaveLength(11);
    const channels = lines.filter((l) => l.includes('CHANNELS')).reduce((a, l) => a + parseInt(l.split(/\s+/)[2], 10), 0);
    expect(channels).toBe(6 + 16 * 3);
    expect(rows[0].trim().split(/\s+/)).toHaveLength(channels);
    // root position at the last frame: object x = 1 m (100 cm) plus the hips offset rotated by the 30 degree yaw
    const last = rows[10].trim().split(/\s+/).map(Number);
    const o = evaluateProject({ ...p, time: 1 }, 1).objects[0];
    const hipsLocal = fk(o.pose, o.hipsPos).hips.p;
    expect(last[1]).toBeCloseTo((o.position[1] + hipsLocal.y) * 100, 2);
    expect(Math.hypot(last[0] - 100, last[2])).toBeCloseTo(Math.hypot(hipsLocal.x, hipsLocal.z) * 100, 2);
  });
});
