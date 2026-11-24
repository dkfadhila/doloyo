import { describe, expect, it, vi } from 'vitest';
import { bakeCommand, clampLoose, thin, type BakeSample } from './bake';
import { applyCommand, newProject, normalizeProject, type Command } from './commands';
import { emptyPose } from './rig';
import { DEFAULT_CHARACTER, PROCEDURAL_CHARACTER, type Project } from './types';

const run = (p: Project, c: Command) => applyCommand(p, c);
const roundTrip = (p: Project, c: Command) => {
  const r = run(p, c);
  const back = run(r.project, r.inverse!);
  return { r, back };
};

describe('object_set_character', () => {
  it('new mannequins default to the Quaternius mannequin, shapes to the procedural id', () => {
    const p = newProject();
    expect(p.objects[0].character).toBe(DEFAULT_CHARACTER);
    expect(p.objects[0].material).toBe('doll');
    const r = run(p, { type: 'object_add', kind: 'cube' });
    expect(r.project.objects[1].character).toBe(PROCEDURAL_CHARACTER);
  });

  it('sets character and material, and undo restores both', () => {
    const p = newProject();
    const id = p.objects[0].id;
    const { r, back } = roundTrip(p, { type: 'object_set_character', object: id, character: 'mannequin-m', material: 'original' });
    expect(r.project.objects[0].character).toBe('mannequin-m');
    expect(r.project.objects[0].material).toBe('original');
    expect(back.project.objects[0].character).toBe(DEFAULT_CHARACTER);
    expect(back.project.objects[0].material).toBe('doll');
  });

  it('keeps the current material when none is given and accepts imported ids', () => {
    const p = newProject();
    const r = run(run(p, { type: 'object_set_character', object: p.objects[0].name, character: 'mannequin-m', material: 'original' }).project, {
      type: 'object_set_character', object: p.objects[0].id, character: 'custom:abc123',
    });
    expect(r.project.objects[0].character).toBe('custom:abc123');
    expect(r.project.objects[0].material).toBe('original');
  });

  it('rejects unknown characters, bad materials and non-mannequins', () => {
    const p = run(newProject(), { type: 'object_add', kind: 'cube', name: 'Box' }).project;
    const id = p.objects[0].id;
    expect(() => run(p, { type: 'object_set_character', object: id, character: 'robot' })).toThrow(/Unknown character/);
    expect(() => run(p, { type: 'object_set_character', object: id, character: 'mannequin-f', material: 'shiny' as never })).toThrow(/material/);
    expect(() => run(p, { type: 'object_set_character', object: 'Box', character: 'mannequin-f' })).toThrow(/not a mannequin/);
    expect(() => run(p, { type: 'object_add', kind: 'mannequin', character: 'nope' })).toThrow(/Unknown character/);
  });

  it('object_add accepts a character; old projects load as the procedural doll', () => {
    const p = run(newProject(), { type: 'object_add', kind: 'mannequin', character: 'doll-procedural' }).project;
    expect(p.objects[1].character).toBe('doll-procedural');
    const legacy = JSON.parse(JSON.stringify(newProject()));
    for (const o of legacy.objects) {
      delete o.character;
      delete o.material;
    }
    const n = normalizeProject(legacy);
    expect(n.objects[0].character).toBe(PROCEDURAL_CHARACTER);
    expect(n.objects[0].material).toBe('doll');
  });
});

function samples(n: number, t0 = 0, fps = 30): BakeSample[] {
  return Array.from({ length: n }, (_, i) => {
    const pose = emptyPose();
    pose.L_shoulder = [0, 0, i * 3];
    pose.head = [0, i, 0];
    return { t: t0 + i / fps, pose, hipsPos: [i * 0.01, 0, 0] };
  });
}

describe('bakeCommand', () => {
  it('writes one key per sample on every joint channel and hipsPos', () => {
    const p = newProject();
    const o = p.objects[0];
    const r = run(p, bakeCommand(p, o, samples(10)));
    const t = r.project.objects[0].tracks;
    expect(Object.keys(t).length).toBe(18);
    expect(t.L_shoulder.length).toBe(10);
    expect(t.L_shoulder[9].value[2]).toBeCloseTo(27);
    expect(t.hipsPos[9].value[0]).toBeCloseTo(0.09);
  });

  it('is a single undo step that restores the previous tracks exactly', () => {
    let p = newProject();
    const id = p.objects[0].id;
    p = run(p, { type: 'joint_set', object: id, joint: 'head', rotation: [5, 0, 0] }).project;
    p = run(p, { type: 'key_add', object: id, frame: 0, target: ['head'] }).project;
    const before = JSON.stringify(p.objects[0].tracks);
    const { r, back } = roundTrip(p, bakeCommand(p, p.objects[0], samples(6, 0.5)));
    expect(r.project.objects[0].tracks.head.length).toBe(7); // old key at 0 kept + 6 new
    expect(JSON.stringify(back.project.objects[0].tracks)).toBe(before);
  });

  it('replaces keys inside the baked range and keeps those outside', () => {
    let p = newProject();
    const id = p.objects[0].id;
    for (const f of [0, 15, 60]) {
      p = run(p, { type: 'playhead_seek', frame: f }).project;
      p = run(p, { type: 'key_add', object: id, target: ['head'] }).project;
    }
    const r = run(p, bakeCommand(p, p.objects[0], samples(31, 0.2)));
    const times = r.project.objects[0].tracks.head.map((k) => Math.round(k.t * 30));
    expect(times).toContain(0); // before the range
    expect(times).toContain(60); // after the range
    expect(times.length).toBe(33); // 31 new + the 2 outside keys; the old key at frame 15 was replaced, not duplicated
    const k15 = r.project.objects[0].tracks.head.find((k) => Math.round(k.t * 30) === 15)!;
    expect(k15.value[1]).toBeCloseTo(9); // the baked value (sample 9), not the old one
  });

  it('can extend the timeline in the same undo step, and thins by key density', () => {
    const p = newProject(); // 4 s
    const s = samples(151); // 5 s
    const { r, back } = roundTrip(p, bakeCommand(p, p.objects[0], s, { extend: true, every: 5 }));
    expect(r.project.duration).toBeCloseTo(5);
    expect(r.project.objects[0].tracks.head.length).toBe(31); // 0,5,...,150
    expect(back.project.duration).toBe(4);
    expect(Object.keys(back.project.objects[0].tracks).length).toBe(0);
    expect(thin([1, 2, 3, 4, 5, 6, 7], 3)).toEqual([1, 4, 7]);
  });

  it('clamps baked values loosely, not to the strict human limits', () => {
    const knee = clampLoose('L_knee', [170, 40, 40]);
    expect(knee[0]).toBeGreaterThan(150); // looser than the strict 150
    expect(knee[0]).toBeLessThan(200);
    expect(Math.abs(knee[1])).toBeLessThan(20); // locked axes stay nearly locked
    expect(clampLoose('hips', [400, 0, 0])[0]).toBe(400);
  });

  it('retired superhero characters load as the matching mannequin, with a warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // a project saved by an older version
    const old = JSON.parse(JSON.stringify(newProject()));
    old.objects[0].character = 'superhero-m';
    old.objects[0].material = 'original';
    old.objects.push({ ...JSON.parse(JSON.stringify(old.objects[0])), id: 'x2', name: 'Her', character: 'superhero-f' });
    const n = normalizeProject(old);
    expect(n.objects.map((o) => o.character)).toEqual(['mannequin-m', 'mannequin-f']);
    expect(n.objects[0].material).toBe('original');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('superhero-m'));
    // commands (UI or MCP) that still name them
    const p = newProject();
    const r = run(p, { type: 'object_set_character', object: p.objects[0].id, character: 'superhero-m' });
    expect(r.project.objects[0].character).toBe('mannequin-m');
    expect(run(p, r.inverse!).project).toEqual(p);
    expect(run(newProject(), { type: 'object_add', kind: 'mannequin', character: 'superhero-f' }).project.objects[1].character).toBe('mannequin-f');
    expect(run(newProject(), { type: 'scene_preset', preset: 'duo', character: 'superhero-m', clear: true }).project.objects.every((o) => o.character === 'mannequin-m')).toBe(true);
    expect(() => run(p, { type: 'object_set_character', object: p.objects[0].id, character: 'superhero-x' })).toThrow(/Unknown character/);
    warn.mockRestore();
  });
});
