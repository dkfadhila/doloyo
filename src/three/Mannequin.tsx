import { useFrame } from '@react-three/fiber';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Color, Group, MeshBasicMaterial, MeshStandardMaterial, Quaternion, Vector3, type Material } from 'three';
import { getCharacter, onRegistryChange, registryVersion } from '../characters/registry';
import { applyPins, hasPins, LIMB_JOINTS } from '../core/ik';
import { evaluateObject } from '../core/interpolate';
import { CHILDREN, JOINTS, RIG_BY_NAME, type Seg } from '../core/rig';
import { PROCEDURAL_CHARACTER, type JointName, type MaterialMode, type Pose, type SceneObject, type Vec3 } from '../core/types';
import { useStore } from '../store';
import { useUi } from '../ui/uiStore';
import { ballGeometry, BALL_JOINTS, dollParts } from './dollGeometry';
import { ACCENT, BODY, D2R, drag, getLive, live, OBJECT_TINT, preview, registerApplier, type LiveState } from './shared';
import { createSkinned, type SkinnedInstance } from './skinned';

const R2D = 180 / Math.PI;

interface SegData {
  pos: Vec3;
  quat: [number, number, number, number];
  scale: Vec3;
  args: [number, number, number, number];
}

const Y = new Vector3(0, 1, 0);
function buildSeg(s: Seg): SegData {
  const a = new Vector3(...(s.from ?? [0, 0, 0]));
  const b = new Vector3(...s.to);
  const dir = b.clone().sub(a);
  const len = dir.length();
  const q = new Quaternion().setFromUnitVectors(Y, dir.normalize());
  const mid = a.add(b).multiplyScalar(0.5);
  return { pos: [mid.x, mid.y, mid.z], quat: [q.x, q.y, q.z, q.w], scale: [s.sx ?? 1, 1, s.sz ?? 1], args: [s.radius, len, 4, 12] };
}
/** Capsule volumes of the rig: used as invisible click targets when a skinned character is shown. */
const SEGS = Object.fromEntries(JOINTS.map((j) => [j, RIG_BY_NAME[j].segs.map(buildSeg)])) as Record<JointName, SegData[]>;

type Reg = (name: JointName, g: Group | null) => void;
type Ghost = 'prev' | 'next';
/** art = procedural art doll, proxy = invisible pick volumes (a skinned character is drawn separately), none = bare joint groups (ghost of a skinned character). */
type View = 'art' | 'proxy' | 'none';
const noRaycast = () => null;

const perJoint = (f: () => Material) => Object.fromEntries(JOINTS.map((j) => [j, f()])) as unknown as Record<JointName, Material>;

interface Mats {
  body: Record<JointName, Material>;
  ball: Record<JointName, Material>;
}

function JointNode({ id, name, mats, reg, ghost, view }: { id: string; name: JointName; mats: Mats; reg: Reg; ghost: boolean; view: View }) {
  const def = RIG_BY_NAME[name];
  const mat = mats.body[name];
  const click = ghost
    ? undefined
    : (e: { stopPropagation: () => void }) => {
        e.stopPropagation();
        useStore.getState().select(id, name);
      };
  const shadow = !ghost && view === 'art';
  const rc = ghost ? noRaycast : undefined;
  const showBall = view !== 'none' && (view === 'proxy' || BALL_JOINTS.has(name));
  return (
    <group name={`${id}:${name}`} ref={(g) => reg(name, g)} position={def.offset}>
      {showBall && (
        <mesh castShadow={shadow} receiveShadow={shadow} material={view === 'proxy' ? mats.ball[name] : mat} geometry={ballGeometry(def.ball)} onClick={click} raycast={rc} renderOrder={view === 'proxy' ? 10 : 0} />
      )}
      {view === 'none' ? null : view === 'art'
        ? dollParts()[name].map((p, i) => (
            <mesh key={i} castShadow={shadow} receiveShadow={shadow} material={mat} geometry={p.geo} position={p.pos} quaternion={p.quat} scale={p.scale} onClick={click} raycast={rc} />
          ))
        : (
          <>
            {SEGS[name].map((s, i) => (
              <mesh key={i} material={mat} position={s.pos} quaternion={s.quat} scale={s.scale} onClick={click} raycast={rc}>
                <capsuleGeometry args={s.args} />
              </mesh>
            ))}
            {def.ovoid && (
              <mesh material={mat} position={def.ovoid.center} scale={def.ovoid.radii} onClick={click} raycast={rc}>
                <sphereGeometry args={[1, 16, 12]} />
              </mesh>
            )}
          </>
        )}
      {(CHILDREN[name] ?? []).map((c) => (
        <JointNode key={c} id={id} name={c} mats={mats} reg={reg} ghost={ghost} view={view} />
      ))}
    </group>
  );
}

const GHOST_COLOR: Record<Ghost, Color> = { prev: new Color('#6f9cff'), next: new Color('#ffa24d') };
const GHOST_OPACITY = 0.22;

/** Time of the onion ghost for an object, or null if there is nothing to show. */
function ghostTime(o: SceneObject, kind: Ghost, time: number, fps: number, frames: number): number | null {
  if (frames > 0) {
    const t = time + (kind === 'prev' ? -frames : frames) / fps;
    return t < 0 ? null : t;
  }
  let best: number | null = null;
  for (const keys of Object.values(o.tracks)) {
    for (const k of keys) {
      if (kind === 'prev') {
        if (k.t < time - 1e-3 && (best === null || k.t > best)) best = k.t;
      } else if (k.t > time + 1e-3 && (best === null || k.t < best)) best = k.t;
    }
  }
  return best;
}

function applyPose(r: Group, groups: Partial<Record<JointName, Group>>, o: SceneObject) {
  r.position.set(...o.position);
  r.rotation.set(o.rotation[0] * D2R, o.rotation[1] * D2R, o.rotation[2] * D2R);
  r.scale.set(...o.scale);
  for (const j of JOINTS) {
    const g = groups[j];
    if (!g) continue;
    const p = o.pose[j];
    g.rotation.set(p[0] * D2R, p[1] * D2R, p[2] * D2R);
    if (j === 'hips') {
      const off = RIG_BY_NAME.hips.offset;
      g.position.set(off[0] + o.hipsPos[0], off[1] + o.hipsPos[1], off[2] + o.hipsPos[2]);
    }
  }
}

/** Pose as currently shown by the joint groups (the gizmo edits them directly while dragging). */
function poseFromGroups(groups: Partial<Record<JointName, Group>>): { pose: Pose; hipsPos: Vec3 } {
  const pose = {} as Pose;
  for (const j of JOINTS) {
    const g = groups[j];
    pose[j] = g ? [g.rotation.x * R2D, g.rotation.y * R2D, g.rotation.z * R2D] : [0, 0, 0];
  }
  const off = RIG_BY_NAME.hips.offset;
  const h = groups.hips;
  return { pose, hipsPos: h ? [h.position.x - off[0], h.position.y - off[1], h.position.z - off[2]] : [0, 0, 0] };
}

type Load = { state: 'procedural' } | { state: 'loading' } | { state: 'ready'; inst: SkinnedInstance } | { state: 'error'; message: string };

export function Mannequin({ id, ghost }: { id: string; ghost?: Ghost }) {
  const root = useRef<Group>(null);
  const groups = useRef<Partial<Record<JointName, Group>>>({});
  const character = useStore((s) => s.project.objects.find((o) => o.id === id)?.character ?? PROCEDURAL_CHARACTER);
  const material = useStore((s) => s.project.objects.find((o) => o.id === id)?.material ?? 'doll') as MaterialMode;
  useSyncExternalStore(onRegistryChange, registryVersion); // imported characters register asynchronously
  const def = getCharacter(character);
  const wantsSkin = !!def && def.kind !== 'procedural';

  const [load, setLoad] = useState<Load>({ state: wantsSkin ? 'loading' : 'procedural' });
  const instRef = useRef<SkinnedInstance | null>(null);

  useEffect(() => {
    if (!wantsSkin || !def) {
      setLoad({ state: 'procedural' });
      return;
    }
    let dead = false;
    let made: SkinnedInstance | null = null;
    setLoad({ state: 'loading' });
    createSkinned(def.id)
      .then((inst) => {
        if (dead) return inst.dispose();
        made = inst;
        instRef.current = inst;
        if (ghost) inst.setGhost(GHOST_COLOR[ghost], GHOST_OPACITY);
        setLoad({ state: 'ready', inst });
      })
      .catch((e) => {
        if (dead) return;
        const message = e instanceof Error ? e.message : String(e);
        console.warn('[character] load failed', def.id, e);
        useUi.getState().notify(`Could not load character "${def.label}": ${message}. Showing the procedural doll.`);
        setLoad({ state: 'error', message });
      });
    return () => {
      dead = true;
      if (made) {
        made.dispose();
        if (instRef.current === made) instRef.current = null;
      }
    };
  }, [wantsSkin, def?.id, def?.bones]); // eslint-disable-line react-hooks/exhaustive-deps

  const skinned = load.state !== 'procedural' && load.state !== 'error';
  // a ghost shows the same character (translucent clone) once loaded; until then the procedural silhouette
  const view: View = ghost ? (load.state === 'ready' ? 'none' : 'art') : skinned ? 'proxy' : 'art';

  const mats = useMemo<Mats>(() => {
    const none = {} as Record<JointName, Material>;
    if (ghost) {
      const m = new MeshBasicMaterial({ color: GHOST_COLOR[ghost], transparent: true, opacity: GHOST_OPACITY, depthWrite: false });
      return { body: perJoint(() => m), ball: none };
    }
    if (view === 'proxy') {
      // invisible but still hit-testable; the selected joint's ball is drawn as an accent marker
      const invisible = () => new MeshBasicMaterial({ colorWrite: false, depthWrite: false, transparent: true, opacity: 0 });
      const one = invisible();
      return {
        body: perJoint(() => one),
        ball: perJoint(() => invisible()),
      };
    }
    return {
      body: perJoint(() => new MeshStandardMaterial({ color: BODY, roughness: 0.85, metalness: 0 })),
      ball: none,
    };
  }, [ghost, view]);
  useEffect(
    () => () => {
      new Set([...Object.values(mats.body), ...Object.values(mats.ball)]).forEach((m) => m.dispose());
    },
    [mats],
  );
  const reg: Reg = (name, g) => {
    if (g) groups.current[name] = g;
    else delete groups.current[name];
  };

  const apply = useCallback(
    (l: LiveState) => {
      const r = root.current;
      const o = l.project.objects.find((x) => x.id === id);
      if (!r || !o) return;
      if (ghost) {
        const on = useStore.getState().onion;
        const t = ghostTime(o, ghost, l.project.time, l.project.fps, on.frames);
        r.visible = t !== null;
        if (t !== null) {
          const ev = evaluateObject(o, t);
          applyPose(r, groups.current, ev);
          instRef.current?.apply(ev.pose, ev.hipsPos);
        }
        return;
      }
      const pv = live.override ? null : preview.current;
      const shown = pv && pv.object === id ? { ...o, pose: pv.pose, hipsPos: pv.hipsPos } : o;
      applyPose(r, groups.current, shown);
      const selected = l.selected === id;
      if (view === 'art') {
        for (const j of JOINTS) {
          (mats.body[j] as MeshStandardMaterial).color.copy(selected ? (l.joint === j ? ACCENT : OBJECT_TINT) : BODY);
        }
      } else {
        for (const j of JOINTS) {
          const m = mats.ball[j] as MeshBasicMaterial;
          const on = selected && l.joint === j;
          m.colorWrite = on;
          m.depthTest = !on;
          m.opacity = on ? 0.85 : 0;
          if (on) m.color.copy(ACCENT);
        }
      }
      const inst = instRef.current;
      if (inst) {
        inst.setLook(o.material, selected);
        const live = drag.active ? poseFromGroups(groups.current) : { pose: shown.pose, hipsPos: shown.hipsPos };
        inst.apply(live.pose, live.hipsPos);
      }
    },
    [id, ghost, mats, view],
  );
  useEffect(() => (ghost ? undefined : registerApplier(apply)), [apply, ghost]);
  useEffect(() => {
    if (!ghost) apply(getLive());
  }, [apply, ghost, load, material]);
  useFrame(() => {
    if (drag.active) {
      if (!ghost) {
        // dragging the hips of a mannequin with pinned feet: keep the pinned ankles in place live
        const l = getLive();
        const o = l.project.objects.find((x) => x.id === id);
        if (o && hasPins(o) && l.selected === id && l.joint === 'hips') {
          const lv = poseFromGroups(groups.current);
          const pinned = applyPins({ ...o, pose: lv.pose, hipsPos: lv.hipsPos });
          for (const limb of ['L_leg', 'R_leg'] as const) {
            for (const j of LIMB_JOINTS[limb]) {
              const g = groups.current[j];
              const p = pinned.pose[j];
              if (g) g.rotation.set(p[0] * D2R, p[1] * D2R, p[2] * D2R);
            }
          }
        }
      }
      // keep the skinned character glued to the gizmo while dragging
      const inst = instRef.current;
      if (inst && !ghost) {
        const live = poseFromGroups(groups.current);
        inst.apply(live.pose, live.hipsPos);
      }
      return;
    }
    apply(getLive());
  });

  const nameId = ghost ? `ghost-${ghost}-${id}` : id;
  return (
    <group ref={root} name={ghost ? nameId : `obj:${id}`} userData={ghost ? { noSnap: true } : undefined} visible={!ghost}>
      <JointNode id={nameId} name="hips" mats={mats} reg={reg} ghost={!!ghost} view={view} />
      {load.state === 'ready' && <primitive object={load.inst.root} />}
    </group>
  );
}

/** Translucent previous/next ghosts of the selected mannequin (the same character as a translucent clone, or the procedural silhouette; at most 2 ghosts). */
export function OnionSkin() {
  const on = useStore((s) => s.onion.on);
  const id = useStore((s) => {
    const o = s.project.objects.find((x) => x.id === s.selection.object);
    return o?.kind === 'mannequin' ? o.id : null;
  });
  if (!on || !id) return null;
  return (
    <>
      <Mannequin key={'p' + id} id={id} ghost="prev" />
      <Mannequin key={'n' + id} id={id} ghost="next" />
    </>
  );
}
