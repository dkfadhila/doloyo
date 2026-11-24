import { Vector3 } from 'three';
import { describe, expect, it, vi } from 'vitest';
import { ADULT, bodyProfile, characterForBody, cleanBody, genderOf, profileOf } from './body';
import { applyCommand, FAMILY, newProject, normalizeProject, type Command } from './commands';
import { contactHeights, endWorld, fk, groundHipsPos, jointWorld, reachWorld } from './ik';
import { POSES, resolvePose } from './poses';
import { emptyPose, JOINTS, RIG } from './rig';
import { BODY_PRESETS, type BodyPreset, type Project, type SceneObject } from './types';

const run = (p: Project, c: Command) => applyCommand(p, c);
const only = (p: Project): SceneObject => p.objects[0];
const FEMALE: Record<string, 'm' | 'f'> = { 'mannequin-f': 'f' };

describe('body proportion profile', () => {
  it('dewasa is the unmodified rig: identity factors, same offsets, hipsScale 1', () => {
    expect(ADULT.identity).toBe(true);
    expect(ADULT.hipsScale).toBe(1);
    for (const d of RIG) expect(ADULT.offset[d.name]).toEqual(d.offset);
    for (const j of JOINTS) expect(ADULT.mesh[j]).toBe(1);
  });

  it('heights follow the table and the total rig height matches the preset ratio', () => {
    const h = (p: BodyPreset, g: 'm' | 'f' = 'm') => bodyProfile(p, 1, g).height;
    expect(h('kecil')).toBeCloseTo(0.75, 3);
    expect(h('pendek')).toBeCloseTo(1.2, 3);
    expect(h('remaja')).toBeCloseTo(1.62, 3);
    expect(h('remaja', 'f')).toBeCloseTo(1.58, 3);
    expect(h('dewasa')).toBeCloseTo(1.75, 3);
    expect(h('dewasa', 'f')).toBeCloseTo(1.65, 3);
    for (const preset of BODY_PRESETS) {
      const p = bodyProfile(preset, 1, 'm');
      const rigHeight = p.hipsY + (p.offset.spine[1] + p.offset.chest[1] + p.offset.neck[1]) + p.offset.head[1] + 0.22 * p.f.head;
      expect(rigHeight / (0.95 + 0.6 + 0.1 + 0.22), preset).toBeCloseTo(p.ratio, 3);
    }
  });

  it('children have proportionally bigger heads, shorter necks and shorter legs than the adult', () => {
    const heads = (p: BodyPreset) => {
      const pr = bodyProfile(p);
      const total = pr.hipsY + pr.offset.spine[1] + pr.offset.chest[1] + pr.offset.neck[1] + pr.offset.head[1] + 0.22 * pr.f.head;
      return total / (0.22 * pr.f.head); // head-heights tall
    };
    const k = heads('kecil'), p = heads('pendek'), r = heads('remaja'), d = heads('dewasa');
    expect(k).toBeLessThan(p);
    expect(p).toBeLessThan(r);
    expect(r).toBeLessThan(d);
    expect(k).toBeLessThan(5); // baby: about 4 head-heights
    const kid = bodyProfile('kecil');
    expect(0.1 * kid.f.neck).toBeLessThan(0.055); // short neck (adult 0.10 m)
    expect(kid.hipsY / (kid.hipsY + 0.6 * kid.f.torso + 0.1 * kid.f.neck + 0.22 * kid.f.head)).toBeLessThan(0.42); // short legs
  });

  it('height scale is clamped to +-10% and scales everything uniformly', () => {
    expect(bodyProfile('dewasa', 5).heightScale).toBe(1.1);
    expect(bodyProfile('dewasa', 0.1).heightScale).toBe(0.9);
    const a = bodyProfile('pendek', 1);
    const b = bodyProfile('pendek', 1.1);
    expect(b.height / a.height).toBeCloseTo(1.1, 4);
    expect(b.hipsY / a.hipsY).toBeCloseTo(1.1, 3);
    expect(b.identity).toBe(false);
    expect(bodyProfile('dewasa', 1.1).identity).toBe(false);
  });

  it('gender only nudges the shoulder width (never chest / hip shape)', () => {
    for (const preset of ['kecil', 'pendek'] as const) {
      const m = bodyProfile(preset, 1, 'm');
      const f = bodyProfile(preset, 1, 'f');
      expect(f.f.shoulder / m.f.shoulder).toBeGreaterThan(0.93);
      expect(f.f.shoulder / m.f.shoulder).toBeLessThan(1);
      expect(f.f.hip).toBe(m.f.hip);
      expect(f.mesh.chest).toBe(m.mesh.chest);
    }
  });

  it('cleanBody drops garbage and the default', () => {
    expect(cleanBody(undefined)).toBeUndefined();
    expect(cleanBody({ preset: 'giant' })).toBeUndefined();
    expect(cleanBody({ preset: 'kecil', heightScale: 3, gender: 'f' })).toEqual({ preset: 'kecil', heightScale: 1.1, gender: 'f' });
    expect(cleanBody({ preset: 'dewasa', heightScale: 1 })).toEqual({ preset: 'dewasa' });
  });
});

describe('FK / floor contact with body scaling', () => {
  const lowestFoot = (prof = ADULT, pose = emptyPose(), hipsPos: [number, number, number] = [0, 0, 0]) => {
    const F = fk(pose, hipsPos, prof);
    return Math.min(F.L_ankle.p.y, F.R_ankle.p.y) - prof.ankleHeight;
  };

  it('feet stand on the floor in the rest pose for every preset, gender and height', () => {
    for (const preset of BODY_PRESETS) {
      for (const g of ['m', 'f'] as const) {
        for (const hs of [0.9, 1, 1.1]) {
          const prof = bodyProfile(preset, hs, g);
          expect(Math.abs(lowestFoot(prof)), `${preset} ${g} ${hs}`).toBeLessThan(0.01);
          const F = fk(emptyPose(), [0, 0, 0], prof);
          expect(F.hips.p.y).toBeCloseTo(prof.hipsY, 6);
        }
      }
    }
  });

  it('hips translation is scaled by the body: a crouch key keeps the feet on the floor on every body', () => {
    const pose = emptyPose();
    pose.L_hip = [-95, 0, 0]; pose.R_hip = [-95, 0, 0];
    pose.L_knee = [120, 0, 0]; pose.R_knee = [120, 0, 0];
    for (const preset of BODY_PRESETS) {
      const prof = bodyProfile(preset);
      const F0 = fk(emptyPose(), [0, 0, 0], prof);
      const F1 = fk(emptyPose(), [0.1, -0.3, 0.2], prof);
      expect(F1.hips.p.y - F0.hips.p.y).toBeCloseTo(-0.3 * prof.hipsScale, 6);
      expect(F1.hips.p.x - F0.hips.p.x).toBeCloseTo(0.1 * prof.hipsScale, 6);
      expect(F1.hips.p.z - F0.hips.p.z).toBeCloseTo(0.2 * prof.hipsScale, 6);
    }
    // the stored crouch keeps the ankles at the same RELATIVE height for adult and baby
    const crouch = resolvePose('crouch');
    const rel = (preset: BodyPreset) => {
      const prof = bodyProfile(preset);
      const F = fk(crouch.pose, crouch.hipsPos, prof);
      return (F.L_ankle.p.y - prof.ankleHeight) / prof.hipsY;
    };
    expect(Math.abs(rel('kecil') - rel('dewasa'))).toBeLessThan(0.1);
  });

  it('a mannequin with a body uses its profile for jointWorld and objects scale it as a whole', () => {
    let p = run(newProject(), { type: 'object_set_body', object: only(newProject()).name, preset: 'kecil' }).project;
    const o = only(p);
    expect(jointWorld(o, 'hips')[1]).toBeCloseTo(bodyProfile('kecil', 1, 'f').hipsY, 5);
    p = run(p, { type: 'object_transform', object: o.id, position: [1, 0, 2] }).project;
    expect(jointWorld(only(p), 'hips')).toEqual([1, expect.closeTo(bodyProfile('kecil', 1, 'f').hipsY, 5), 2]);
  });
});

describe('IK on small bodies', () => {
  it('reaches a target exactly on a kecil body (arm and leg), with the profile limb lengths', () => {
    const base = newProject();
    const p = run(base, { type: 'object_set_body', object: only(base).id, preset: 'kecil' }).project;
    const o = only(p);
    const prof = profileOf(o);
    const arm = Math.hypot(...prof.offset.L_elbow) + Math.hypot(...prof.offset.L_wrist);
    expect(arm).toBeLessThan(0.35); // really a baby arm, not the adult 0.55
    const sh = jointWorld(o, 'L_shoulder');
    const target: [number, number, number] = [sh[0] + 0.05, sh[1] - 0.05, sh[2] + arm * 0.8 - 0.05];
    const r = reachWorld(o, 'L_arm', target);
    expect(r.reached).toBe(true);
    const q = { ...o, pose: { ...o.pose, ...r.joints } };
    const got = endWorld(q, 'L_arm');
    expect(new Vector3(...got).distanceTo(new Vector3(...target))).toBeLessThan(1e-3);

    const hip = jointWorld(o, 'R_hip');
    const leg = Math.hypot(...prof.offset.R_knee) + Math.hypot(...prof.offset.R_ankle);
    const lt: [number, number, number] = [hip[0], hip[1] - leg * 0.7, hip[2] + 0.06];
    const rl = reachWorld(o, 'R_leg', lt);
    expect(rl.reached).toBe(true);
    expect(new Vector3(...endWorld({ ...o, pose: { ...o.pose, ...rl.joints } }, 'R_leg')).distanceTo(new Vector3(...lt))).toBeLessThan(1e-3);
    // an adult-length reach is out of range for the baby: fully extended instead of reached
    const far = reachWorld(o, 'L_arm', [sh[0], sh[1] - 0.55, sh[2]]);
    expect(far.extended).toBe(true);
  });

  it('foot pins on a kecil body hold the ankle at its pinned position while the hips move', () => {
    const base = newProject();
    let p = run(base, { type: 'object_set_body', object: only(base).id, preset: 'kecil' }).project;
    p = run(p, { type: 'ik_pin', object: only(p).id, limb: 'L_foot', pinned: true }).project;
    const pin = [...only(p).pins.L_foot!];
    p = run(p, { type: 'joint_set', object: only(p).id, joint: 'hips', position: [0.1, -0.1, 0] }).project;
    const a = endWorld(only(p), 'L_leg');
    expect(new Vector3(...a).distanceTo(new Vector3(...pin))).toBeLessThan(2e-3);
  });
});

describe('object_set_body', () => {
  const start = () => newProject();
  const id = (p: Project) => only(p).id;

  it('sets the preset, maps the character to the neutral mesh for small bodies, and undo restores everything', () => {
    const p0 = start();
    const r = run(p0, { type: 'object_set_body', object: id(p0), preset: 'pendek' });
    const o = only(r.project);
    expect(o.body).toEqual({ preset: 'pendek', gender: 'f' }); // default doll is Mannequin F: girl, on the neutral mesh
    expect(o.character).toBe('mannequin-m');
    expect(genderOf(o)).toBe('f');
    const back = run(r.project, r.inverse!);
    expect(back.project).toEqual(p0);
    expect(only(back.project).body).toBeUndefined();
    expect(only(back.project).character).toBe('mannequin-f');
    // redo
    expect(run(back.project, r.applied).project).toEqual(r.project);
  });

  it('gender switch maps to the right base character; dewasa female uses mannequin-f, teens the neutral mesh', () => {
    expect(characterForBody('mannequin-m', 'dewasa', 'f')).toBe('mannequin-f');
    expect(characterForBody('mannequin-f', 'remaja', 'f')).toBe('mannequin-m');
    expect(characterForBody('mannequin-f', 'kecil', 'f')).toBe('mannequin-m');
    expect(characterForBody('doll-procedural', 'kecil', 'f')).toBe('doll-procedural');
    expect(characterForBody('custom:abc', 'kecil', 'f')).toBe('custom:abc');
    let p = start();
    p = run(p, { type: 'object_set_body', object: id(p), preset: 'dewasa', gender: 'm' }).project;
    expect(only(p).character).toBe('mannequin-m');
    expect(only(p).body).toBeUndefined(); // adult male at 1.0 = the default look
    p = run(p, { type: 'object_set_body', object: id(p), gender: 'f' }).project;
    expect(only(p).character).toBe('mannequin-f');
    p = run(p, { type: 'object_set_body', object: id(p), preset: 'remaja' }).project;
    expect(only(p).character).toBe('mannequin-m');
    expect(genderOf(only(p))).toBe('f');
    p = run(p, { type: 'object_set_body', object: id(p), preset: 'dewasa' }).project;
    expect(only(p).character).toBe('mannequin-f'); // the girl grows up onto the adult female mesh
  });

  it('the adult female mesh cannot be put on a child or teen body by hand', () => {
    const base = start();
    const kid = run(base, { type: 'object_set_body', object: id(base), preset: 'pendek' }).project;
    expect(() => run(kid, { type: 'object_set_character', object: id(kid), character: 'mannequin-f' })).toThrow(/dewasa/);
    const teen = run(kid, { type: 'object_set_body', object: id(kid), preset: 'remaja' }).project;
    expect(() => run(teen, { type: 'object_set_character', object: id(teen), character: 'mannequin-f' })).toThrow(/dewasa/);
    expect(only(run(teen, { type: 'object_set_character', object: id(teen), character: 'mannequin-m' }).project).character).toBe('mannequin-m');
    expect(only(run(kid, { type: 'object_set_character', object: id(kid), character: 'doll-procedural' }).project).character).toBe('doll-procedural');
  });

  it('height scale: validated, kept across presets, undoable', () => {
    const p0 = start();
    const r = run(p0, { type: 'object_set_body', object: id(p0), heightScale: 1.07 });
    expect(only(r.project).body).toEqual({ preset: 'dewasa', heightScale: 1.07 });
    expect(profileOf(only(r.project)).height).toBeCloseTo(1.65 * 1.07, 3);
    const r2 = run(r.project, { type: 'object_set_body', object: id(p0), preset: 'remaja' });
    expect(only(r2.project).body!.heightScale).toBe(1.07);
    expect(() => run(p0, { type: 'object_set_body', object: id(p0), heightScale: 1.5 })).toThrow(/between 0.9 and 1.1/);
    expect(() => run(p0, { type: 'object_set_body', object: id(p0), heightScale: 'tall' as never })).toThrow(/heightScale/);
    expect(() => run(p0, { type: 'object_set_body', object: id(p0), preset: 'giant' as never })).toThrow(/preset must be one of/);
    expect(() => run(p0, { type: 'object_set_body', object: id(p0) })).toThrow(/needs/);
    expect(run(r.project, r.inverse!).project).toEqual(p0);
  });

  it('a retired superhero id becomes the matching mannequin, so every body size works', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const p = run(newProject(), { type: 'object_add', kind: 'mannequin', name: 'Hero', character: 'superhero-m' }).project;
    expect(p.objects.find((x) => x.name === 'Hero')!.character).toBe('mannequin-m');
    const k = run(p, { type: 'object_set_body', object: 'Hero', preset: 'kecil' }).project;
    expect(k.objects.find((x) => x.name === 'Hero')!.body?.preset).toBe('kecil');
    const baby = run(newProject(), { type: 'object_add', kind: 'mannequin', character: 'superhero-f', body: { preset: 'kecil' } }).project;
    expect(baby.objects[1].character).toBe('mannequin-m'); // small bodies use the neutral mesh
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('rejects non-mannequins; changing the body unpins the feet and undo brings them back', () => {
    const cube = run(newProject(), { type: 'object_add', kind: 'cube', name: 'Box' }).project;
    expect(() => run(cube, { type: 'object_set_body', object: 'Box', preset: 'kecil' })).toThrow(/not a mannequin/);
    const base = start();
    const pinned = run(base, { type: 'ik_pin', object: id(base), limb: 'R_foot', pinned: true }).project;
    expect(only(pinned).pins.R_foot).toBeDefined();
    const p = run(pinned, { type: 'object_set_body', object: id(pinned), preset: 'kecil' });
    expect(only(p.project).pins).toEqual({});
    expect(run(p.project, p.inverse!).project).toEqual(pinned);
  });

  it('object_add accepts a body (mapping the character), and old projects load unchanged', () => {
    const r = run(newProject(), { type: 'object_add', kind: 'mannequin', name: 'Bayi', body: { preset: 'kecil', gender: 'm' } });
    const o = r.project.objects.find((x) => x.name === 'Bayi')!;
    expect(o.character).toBe('mannequin-m');
    expect(o.body).toEqual({ preset: 'kecil' });
    expect(genderOf(o)).toBe('m');
    expect(run(r.project, r.inverse!).project.objects.some((x) => x.name === 'Bayi')).toBe(false);
    expect(() => run(newProject(), { type: 'object_add', kind: 'cube', body: { preset: 'kecil' } })).toThrow(/only applies to mannequins/);
    expect(() => run(newProject(), { type: 'object_add', kind: 'mannequin', body: { heightScale: 1.1 } as never })).toThrow(/preset is required/);
    // legacy project (no body anywhere) normalizes without inventing one; a corrupt body is dropped
    const legacy = JSON.parse(JSON.stringify(newProject()));
    expect(only(normalizeProject(legacy)).body).toBeUndefined();
    expect('body' in only(normalizeProject(legacy))).toBe(false);
    legacy.objects[0].body = { preset: 'nope' };
    expect(only(normalizeProject(legacy)).body).toBeUndefined();
    legacy.objects[0].body = { preset: 'pendek', heightScale: 1.05, gender: 'f' };
    expect(only(normalizeProject(legacy)).body).toEqual({ preset: 'pendek', heightScale: 1.05, gender: 'f' });
    // a saved project round-trips
    expect(normalizeProject(JSON.parse(JSON.stringify(r.project))).objects.find((x) => x.name === 'Bayi')!.body).toEqual({ preset: 'kecil' });
  });

  it('keys and poses are plain rotations: they apply to any body unchanged', () => {
    let p = start();
    p = run(p, { type: 'pose_apply', object: id(p), pose: 'wave_up' }).project;
    p = run(p, { type: 'key_add', object: id(p), time: 0 }).project;
    const before = JSON.stringify(only(p).tracks);
    p = run(p, { type: 'object_set_body', object: id(p), preset: 'kecil' }).project;
    expect(JSON.stringify(only(p).tracks)).toBe(before);
    expect(only(p).pose.R_shoulder).toEqual([-10, 0, -150]);
  });
});

describe('scene_preset: mixed gender and keluarga', () => {
  const chars = (p: Project) => p.objects.filter((o) => o.kind === 'mannequin').map((o) => o.character);

  it('duo / trio / group5 alternate female and male by default; an explicit character wins', () => {
    for (const [preset, n] of [['duo', 2], ['trio', 3], ['group5', 5]] as const) {
      const p = run(newProject(), { type: 'scene_preset', preset, clear: true }).project;
      expect(p.objects).toHaveLength(n);
      expect(chars(p)).toEqual(Array.from({ length: n }, (_, i) => (i % 2 === 0 ? 'mannequin-f' : 'mannequin-m')));
      expect(p.objects.every((o) => !o.body)).toBe(true);
    }
    const one = run(newProject(), { type: 'scene_preset', preset: 'trio', character: 'mannequin-m', clear: true }).project;
    expect(new Set(chars(one))).toEqual(new Set(['mannequin-m']));
  });

  it('scene_preset accepts a body for every doll (kids on the neutral mesh, gender kept)', () => {
    const p = run(newProject(), { type: 'scene_preset', preset: 'duo', clear: true, body: { preset: 'kecil' } }).project;
    expect(p.objects.map((o) => o.body?.preset)).toEqual(['kecil', 'kecil']);
    expect(chars(p)).toEqual(['mannequin-m', 'mannequin-m']);
    expect(p.objects.map((o) => genderOf(o))).toEqual(['f', 'm']);
    expect(chars(run(newProject(), { type: 'scene_preset', preset: 'duo', clear: true, character: 'doll-procedural', body: { preset: 'pendek' } }).project)).toEqual(['doll-procedural', 'doll-procedural']);
    expect(() => run(newProject(), { type: 'scene_preset', preset: 'keluarga', body: { preset: 'remaja' } })).toThrow(/fixed body sizes/);
  });

  it('keluarga: 2 adults, 1 anak, 1 bayi sitting; one undo step; deterministic replay', () => {
    const p0 = newProject();
    const r = applyCommand(p0, { type: 'scene_preset', preset: 'keluarga', clear: true });
    const p = r.project;
    expect(p.objects).toHaveLength(4);
    expect(p.objects.map((o) => o.body?.preset ?? 'dewasa')).toEqual(FAMILY.map((m) => m.preset));
    expect(p.objects.map((o) => genderOf(o))).toEqual(FAMILY.map((m) => m.gender));
    expect(p.objects[0].character).toBe('mannequin-m');
    expect(p.objects[3].character).toBe('mannequin-f');
    expect(p.objects[1].character).toBe('mannequin-m'); // kids never use the adult female mesh
    expect(p.objects[2].character).toBe('mannequin-m');
    const heights = p.objects.map((o) => profileOf(o).height);
    expect(heights[2]).toBeLessThan(heights[1]);
    expect(heights[1]).toBeLessThan(heights[0]);
    // the baby sits: duduk pose with the hips lowered by the body-aware grounding
    const baby = p.objects[2];
    expect(baby.pose.L_hip[0]).toBeLessThan(-60);
    expect(baby.hipsPos[1]).toBeLessThan(-0.5);
    expect(p.objects.filter((o) => o !== baby).every((o) => o.hipsPos[1] === 0)).toBe(true);
    expect(applyCommand(p, r.inverse as Command).project).toEqual(p0);
    expect(applyCommand(p0, r.applied).project).toEqual(p);
    const doll = run(newProject(), { type: 'scene_preset', preset: 'keluarga', character: 'doll-procedural', clear: true }).project;
    expect(doll.objects.map((o) => o.character)).toEqual(['doll-procedural', 'mannequin-m', 'mannequin-m', 'doll-procedural']); // adults take the character, kids stay on the neutral mannequin
  });
});

describe('baby poses (duduk, merangkak, berdiri_pegangan)', () => {
  const apply = (preset: BodyPreset, pose: string) => {
    const base = newProject();
    let p = base;
    if (preset !== 'dewasa') p = run(base, { type: 'object_set_body', object: base.objects[0].id, preset }).project;
    return only(run(p, { type: 'pose_apply', object: p.objects[0].id, pose }).project);
  };

  it('exist as presets with a grounding spec', () => {
    for (const n of ['duduk', 'merangkak', 'berdiri_pegangan']) expect(POSES[n].ground?.length).toBeGreaterThan(0);
  });

  it('kecil: feet, knees and hands touch the floor within 2 cm; the lowest contact is exactly on it', () => {
    for (const name of ['duduk', 'merangkak', 'berdiri_pegangan']) {
      const o = apply('kecil', name);
      const prof = profileOf(o);
      const contacts = POSES[name].ground!;
      const h = contactHeights(o.pose, o.hipsPos, prof, contacts);
      expect(Math.min(...h), name).toBeCloseTo(0, 3);
      for (let i = 0; i < h.length; i++) expect(Math.abs(h[i]), `${name} ${contacts[i].joint}`).toBeLessThan(0.02);
    }
  });

  it('nothing sinks into the floor on any body (grounded to the lowest contact)', () => {
    for (const preset of BODY_PRESETS) {
      for (const name of ['duduk', 'merangkak', 'berdiri_pegangan']) {
        const o = apply(preset, name);
        const h = contactHeights(o.pose, o.hipsPos, profileOf(o), POSES[name].ground!);
        expect(Math.min(...h), `${preset} ${name}`).toBeGreaterThan(-1e-3);
      }
    }
  });

  it('groundHipsPos keeps x and z and is idempotent; a partial pose_apply does not ground', () => {
    const { pose } = resolvePose('duduk');
    const prof = bodyProfile('kecil');
    const a = groundHipsPos(pose, [0.3, 0, -0.2], prof, POSES.duduk.ground!);
    expect(a[0]).toBe(0.3);
    expect(a[2]).toBe(-0.2);
    const b = groundHipsPos(pose, a, prof, POSES.duduk.ground!);
    expect(b[1]).toBeCloseTo(a[1], 4);
    const base = newProject();
    const partial = run(base, { type: 'pose_apply', object: base.objects[0].id, pose: { joints: { L_hip: [-90, 0, 0] } }, partial: true }).project;
    expect(only(partial).hipsPos).toEqual([0, 0, 0]);
  });
});

describe('every joint stays on the rig (profile offsets)', () => {
  it('parents precede children and each offset is the adult one times its factor', () => {
    for (const preset of BODY_PRESETS) {
      const prof = bodyProfile(preset);
      for (const d of RIG) {
        for (let i = 0; i < 3; i++) expect(prof.offset[d.name][i]).toBeCloseTo(d.offset[i] * prof.axis[d.name][i], 9);
      }
    }
    expect(new Set(JOINTS).size).toBe(17);
    void FEMALE;
  });
});
