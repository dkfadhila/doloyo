import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { applyCommand, normalizeProject } from './core/commands';
import { evaluateProject } from './core/interpolate';
import { isJoint } from './core/rig';
import { isCharacterId, type Project } from './core/types';
import { EXAMPLES } from './examples';

const dir = resolve(__dirname, '../public/examples');
const load = (file: string): Project => normalizeProject(JSON.parse(readFileSync(resolve(dir, file), 'utf8')));
const allFinite = (v: number[]) => v.every((n) => Number.isFinite(n));

describe('example projects', () => {
  it('the shipped list matches the files in public/examples', () => {
    const files = readdirSync(dir).filter((f) => f.endsWith('.mdoll.json')).sort();
    expect(EXAMPLES.map((e) => e.file).sort()).toEqual(files);
    expect(EXAMPLES.length).toBeGreaterThanOrEqual(3);
  });

  for (const ex of EXAMPLES) {
    describe(ex.name, () => {
      const raw = JSON.parse(readFileSync(resolve(dir, ex.file), 'utf8'));
      const p = load(ex.file);

      it('passes schema normalization unchanged and has sane timeline settings', () => {
        expect(p.version).toBe(1);
        expect(p.name).toBe(ex.name);
        expect(p.fps).toBe(30);
        expect(p.duration).toBeGreaterThan(1);
        expect(p.time).toBe(0);
        expect(normalizeProject(raw)).toEqual(p);
        expect(new Set(p.objects.map((o) => o.id)).size).toBe(p.objects.length);
      });

      it('has valid characters, tracks and keys', () => {
        for (const o of p.objects) {
          expect(isCharacterId(o.character), o.name).toBe(true);
          for (const [ch, keys] of Object.entries(o.tracks)) {
            if (o.kind === 'camera') expect(['position', 'target', 'fov']).toContain(ch);
            else expect(isJoint(ch) || ch === 'hipsPos' || ch === 'position' || ch === 'rotation' || ch === 'scale', `${o.name}.${ch}`).toBe(true);
            expect(keys.length).toBeGreaterThan(0);
            for (let i = 0; i < keys.length; i++) {
              expect(allFinite(keys[i].value)).toBe(true);
              expect(keys[i].t).toBeGreaterThanOrEqual(0);
              expect(keys[i].t).toBeLessThanOrEqual(p.duration + 1e-6);
              if (i) expect(keys[i].t).toBeGreaterThan(keys[i - 1].t);
            }
          }
        }
      });

      it('samples to finite poses across the whole timeline and actually moves', () => {
        const dolls = p.objects.filter((o) => o.kind === 'mannequin');
        const first = evaluateProject(p, 0);
        let moved = false;
        for (let t = 0; t <= p.duration + 1e-9; t += 0.25) {
          const ev = evaluateProject(p, t);
          for (const o of ev.objects) {
            expect(allFinite(o.position) && allFinite(o.rotation) && allFinite(o.scale), o.name).toBe(true);
            if (o.kind === 'mannequin') {
              for (const v of Object.values(o.pose)) expect(allFinite(v)).toBe(true);
              expect(allFinite(o.hipsPos)).toBe(true);
            }
          }
          if (JSON.stringify(ev.objects.map((o) => o.pose)) !== JSON.stringify(first.objects.map((o) => o.pose))) moved = true;
        }
        expect(dolls.length).toBeGreaterThan(0);
        expect(moved).toBe(true);
      });

      it('accepts further commands (loaded projects are editable and undoable)', () => {
        const r = applyCommand(p, { type: 'key_add', object: p.objects[0].id, time: 0.5 });
        expect(applyCommand(r.project, r.inverse!).project).toEqual(p);
      });
    });
  }

  it('Wave hello: one doll', () => {
    const p = load('wave-hello.mdoll.json');
    expect(p.objects.filter((o) => o.kind === 'mannequin')).toHaveLength(1);
    expect(evaluateProject(p, 1.3).objects[0].pose.R_elbow).not.toEqual(evaluateProject(p, 1.0).objects[0].pose.R_elbow);
  });

  it('Dance crew: five dolls in an arc and an animated render camera', () => {
    const p = load('dance-crew.mdoll.json');
    expect(p.objects.filter((o) => o.kind === 'mannequin')).toHaveLength(5);
    expect(p.objects.find((o) => o.kind === 'camera')).toBeTruthy();
    const a = evaluateProject(p, 0).objects.find((o) => o.kind === 'camera')!;
    const b = evaluateProject(p, p.duration).objects.find((o) => o.kind === 'camera')!;
    expect(a.position).not.toEqual(b.position);
  });

  it('Sword duel: two dolls facing each other, both animated', () => {
    const p = load('sword-duel.mdoll.json');
    const [a, b] = p.objects.filter((o) => o.kind === 'mannequin');
    expect(a.position[0]).toBeLessThan(0);
    expect(b.position[0]).toBeGreaterThan(0);
    expect(a.rotation[1]).toBeCloseTo(90);
    expect(b.rotation[1]).toBeCloseTo(-90);
    expect(Object.keys(a.tracks).length).toBeGreaterThan(10);
    expect(Object.keys(b.tracks).length).toBeGreaterThan(10);
  });
});
