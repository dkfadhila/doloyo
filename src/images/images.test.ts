import { beforeAll, describe, expect, it } from 'vitest';
import { applyCommand, newProject, normalizeProject, type Command } from '../core/commands';
import { evaluateProject } from '../core/interpolate';
import { findInternalCommand } from '../agent/permissions';
import type { Project } from '../core/types';
import { fitRect, renderBackdrops } from '../render/backdrop';
import { buildGlbScene, writeGlb } from '../render/glb';

const run = (p: Project, c: Command) => applyCommand(p, c);
const apply = (p: Project, c: Command) => applyCommand(p, c).project;
const plane = (p: Project) => p.objects.find((o) => o.kind === 'image')!;

describe('image commands', () => {
  it('image_add plane creates a keyable plane object and undoes', () => {
    const p0 = newProject();
    const r = run(p0, { type: 'image_add', mode: 'plane', imageId: 'img1', aspect: 2, name: 'Ref' });
    const o = plane(r.project);
    expect(o.name).toBe('Ref');
    expect(o.image).toMatchObject({ imageId: 'img1', aspect: 2, opacity: 1, doubleSided: true, locked: false, inRender: true, billboard: false });
    expect(r.inverse).toMatchObject({ type: 'object_remove', object: o.id });
    expect(apply(r.project, r.inverse!).objects).toHaveLength(p0.objects.length);

    // transform keys like a shape
    let p = apply(r.project, { type: 'object_transform', object: o.id, position: [1, 1, 0] });
    p = apply(p, { type: 'key_add', object: o.id, time: 0 });
    p = apply(p, { type: 'object_transform', object: o.id, position: [3, 1, 0] });
    p = apply(p, { type: 'key_add', object: o.id, time: 1 });
    expect(Object.keys(plane(p).tracks)).toEqual(expect.arrayContaining(['position']));
    expect(evaluateProject({ ...p, time: 0.5 }, 0.5).objects.find((x) => x.id === o.id)!.position[0]).toBeCloseTo(2, 3);
  });

  it('backgrounds: add, replace, set, remove, with exact undo', () => {
    const p0 = newProject();
    const a = run(p0, { type: 'image_add', mode: 'background', imageId: 'a', aspect: 1.5, name: 'A', opacity: 0.5 });
    expect(a.project.background).toMatchObject({ imageId: 'a', opacity: 0.5, fit: 'fit', visible: true, inRender: true });
    const b = run(a.project, { type: 'image_add', mode: 'camera', imageId: 'b', aspect: 1 });
    expect(b.project.cameraBackground).toMatchObject({ imageId: 'b', fit: 'fill' });
    expect(b.project.background?.imageId).toBe('a');

    const s = run(b.project, { type: 'image_set', background: 'viewport', visible: false, fit: 'center', inRender: false });
    expect(s.project.background).toMatchObject({ visible: false, fit: 'center', inRender: false });
    expect(apply(s.project, s.inverse!).background).toEqual(b.project.background);

    const rep = run(s.project, { type: 'image_add', mode: 'background', imageId: 'c' });
    expect(rep.project.background?.imageId).toBe('c');
    expect(apply(rep.project, rep.inverse!).background?.imageId).toBe('a');

    const rm = run(rep.project, { type: 'image_remove', background: 'camera' });
    expect(rm.project.cameraBackground).toBeUndefined();
    expect(apply(rm.project, rm.inverse!).cameraBackground?.imageId).toBe('b');
  });

  it('image_set on a plane and image_remove (undo restores the same object)', () => {
    let p = apply(newProject(), { type: 'image_add', mode: 'plane', imageId: 'x', aspect: 1 });
    const id = plane(p).id;
    const s = run(p, { type: 'image_set', object: id, opacity: 0.4, locked: true, billboard: true, doubleSided: false, inRender: false });
    expect(plane(s.project).image).toMatchObject({ opacity: 0.4, locked: true, billboard: true, doubleSided: false, inRender: false });
    expect(plane(apply(s.project, s.inverse!)).image).toEqual(plane(p).image);
    p = s.project;
    const rm = run(p, { type: 'image_remove', object: id });
    expect(rm.project.objects.some((o) => o.id === id)).toBe(false);
    expect(plane(apply(rm.project, rm.inverse!))).toEqual(plane(p));
  });

  it('rejects bad input with clear errors', () => {
    const p = apply(newProject(), { type: 'image_add', mode: 'plane', imageId: 'x', aspect: 1 });
    const id = plane(p).id;
    expect(() => apply(p, { type: 'image_add', mode: 'plane', imageId: '' })).toThrow(/imageId/);
    expect(() => apply(p, { type: 'image_add', mode: 'nope' as never, imageId: 'x' })).toThrow(/mode/);
    expect(() => apply(p, { type: 'image_set', object: id, opacity: 2 })).toThrow(/opacity/);
    expect(() => apply(p, { type: 'image_set', object: id, fit: 'fill' })).toThrow(/does not apply/);
    expect(() => apply(p, { type: 'image_set', object: id, visible: false })).toThrow(/does not apply/);
    expect(() => apply(p, { type: 'image_set', background: 'viewport', opacity: 0.5 })).toThrow(/no viewport background/);
    const withBg = apply(p, { type: 'image_add', mode: 'background', imageId: 'bg', aspect: 1 });
    expect(() => apply(withBg, { type: 'image_set', background: 'viewport', locked: true })).toThrow(/does not apply/);
    expect(() => apply(p, { type: 'image_set', object: p.objects[0].id, opacity: 0.5 })).toThrow(/not an image plane/);
    expect(() => apply(p, { type: 'image_set' })).toThrow(/needs "object"/);
    expect(() => apply(p, { type: 'image_remove', background: 'camera' })).toThrow(/no camera background/);
    expect(() => apply(p, { type: 'object_add', kind: 'image' })).toThrow(/image_add/);
  });

  it('works inside a batch as one undo step and image_bg_restore stays internal', () => {
    const p0 = newProject();
    const r = run(p0, {
      type: 'batch',
      commands: [
        { type: 'image_add', mode: 'background', imageId: 'a', aspect: 1.5 },
        { type: 'image_add', mode: 'plane', imageId: 'b', aspect: 1 },
      ],
    });
    expect(r.project.background).toBeDefined();
    expect(r.project.objects.some((o) => o.kind === 'image')).toBe(true);
    const back = apply(r.project, r.inverse!);
    expect(back.background).toBeUndefined();
    expect(back.objects).toHaveLength(p0.objects.length);
    expect(findInternalCommand({ type: 'batch', commands: [{ type: 'image_bg_restore', slot: 'viewport', bg: null }] })).toBe('image_bg_restore');
    expect(findInternalCommand({ type: 'image_add' })).toBeNull();
  });
});

describe('project file', () => {
  it('survives normalize (kept fields) and drops broken image data', () => {
    let p = apply(newProject(), { type: 'image_add', mode: 'plane', imageId: 'x', aspect: 1.25, name: 'Pic' });
    p = apply(p, { type: 'image_add', mode: 'background', imageId: 'bg', aspect: 2 });
    p = apply(p, { type: 'image_add', mode: 'camera', imageId: 'cb', aspect: 2, fit: 'center' });
    const round = normalizeProject(JSON.parse(JSON.stringify(p)));
    expect(round.background).toEqual(p.background);
    expect(round.cameraBackground).toEqual(p.cameraBackground);
    expect(plane(round).image).toEqual(plane(p).image);

    const broken = JSON.parse(JSON.stringify(p));
    delete broken.objects.find((o: { kind: string }) => o.kind === 'image').image;
    broken.background = { imageId: 5 };
    broken.embeddedImages = { x: 'data:image/png;base64,AAAA' };
    const clean = normalizeProject(broken);
    expect(clean.objects.some((o) => o.kind === 'image')).toBe(false);
    expect(clean.background).toBeUndefined();
    expect((clean as unknown as { embeddedImages?: unknown }).embeddedImages).toBeUndefined();
  });

  it('opens a project from the previous version unchanged', () => {
    const old = JSON.parse(JSON.stringify(newProject()));
    const p = normalizeProject(old);
    expect(p.background).toBeUndefined();
    expect(p.objects).toHaveLength(1);
  });
});

describe('backdrops for renders', () => {
  it('fitRect: fit, fill and center', () => {
    expect(fitRect(200, 100, 100, 100, 'fit')).toEqual({ x: 0, y: 25, w: 100, h: 50 });
    expect(fitRect(200, 100, 100, 100, 'fill')).toEqual({ x: -50, y: 0, w: 200, h: 100 });
    expect(fitRect(40, 20, 100, 100, 'center')).toEqual({ x: 30, y: 40, w: 40, h: 20 });
  });

  it('honors inRender, visible and the render camera', () => {
    let p = apply(newProject(), { type: 'image_add', mode: 'background', imageId: 'a', aspect: 1 });
    p = apply(p, { type: 'image_add', mode: 'camera', imageId: 'b', aspect: 1 });
    expect(renderBackdrops(p, true).map((b) => b.imageId)).toEqual(['a']); // no render camera yet
    p = apply(p, { type: 'camera_set', position: [0, 1, 3], target: [0, 1, 0] });
    expect(renderBackdrops(p, true).map((b) => b.imageId)).toEqual(['a', 'b']);
    expect(renderBackdrops(p, false).map((b) => b.imageId)).toEqual(['a']);
    p = apply(p, { type: 'image_set', background: 'viewport', inRender: false });
    p = apply(p, { type: 'image_set', background: 'camera', visible: false });
    expect(renderBackdrops(p, true)).toEqual([]);
  });
});

describe('GLB with image planes', () => {
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

  it('exports an image plane as a quad of the right aspect, animated by its keys', async () => {
    let p = apply(newProject(), { type: 'timeline_set', fps: 10, duration: 1 });
    p = apply(p, { type: 'image_add', mode: 'plane', imageId: 'x', aspect: 2, scale: [1, 1, 1], position: [0, 1, 0] });
    const id = plane(p).id;
    p = apply(p, { type: 'key_add', object: id, time: 0 });
    p = apply(p, { type: 'object_transform', object: id, position: [2, 1, 0] });
    p = apply(p, { type: 'key_add', object: id, time: 1 });
    p = apply(p, { type: 'playhead_seek', time: 0 });
    const b = await buildGlbScene({ project: p, objects: [plane(p)], fps: 10, aspect: 16 / 9 });
    const holder = b.scene.children[0];
    expect(holder.name).toBe(plane(p).name.replace(/[^\w-]+/g, '_'));
    const mesh = holder.children[0] as import('three').Mesh;
    mesh.geometry.computeBoundingBox();
    const size = mesh.geometry.boundingBox!.getSize(new (await import('three')).Vector3());
    expect(size.x).toBeCloseTo(2, 5);
    expect(size.y).toBeCloseTo(1, 5);
    expect(b.clip.tracks.some((t) => t.name.endsWith('.position'))).toBe(true);
    const bytes = await writeGlb(b);
    expect(new TextDecoder().decode(bytes.slice(0, 4))).toBe('glTF');
    b.dispose();
  });
});
