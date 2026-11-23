import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { getCharacter, listCharacters, onRegistryChange, registryVersion } from '../characters/registry';
import { BODY_HINT, BODY_SHORT, genderOf, HEIGHT_SCALE_MAX, HEIGHT_SCALE_MIN, isChildPreset, isSuperhero, profileOf } from '../core/body';
import { endWorld, hasPins, poleAngleOf } from '../core/ik';
import { POSE_NAMES } from '../core/poses';
import { RIG_BY_NAME } from '../core/rig';
import { BODY_PRESETS, LIMBS, type BodyPreset, type Limb, type MaterialMode, type SceneObject, type Vec3 } from '../core/types';
import { selectedObject, useStore } from '../store';
import { Icon } from './Icons';
import { setCameraFromView } from './keyActions';
import { NumberField } from './NumberField';

const AXES = ['X', 'Y', 'Z'] as const;

function VecRow({
  title,
  value,
  step,
  decimals,
  min,
  max,
  onCommit,
}: {
  title: string;
  value: Vec3;
  step: number;
  decimals: number;
  min?: Vec3;
  max?: Vec3;
  onCommit: (v: Vec3, group?: string) => void;
}) {
  return (
    <div className="vec">
      <div className="vec-title">{title}</div>
      <div className="vec-fields">
        {AXES.map((a, i) => (
          <NumberField
            key={a}
            label={a}
            value={value[i]}
            step={step}
            decimals={decimals}
            min={min?.[i]}
            max={max?.[i]}
            disabled={min && max ? min[i] === max[i] : false}
            title={min && max && min[i] === max[i] ? 'Locked by joint limits' : undefined}
            onCommit={(v, g) => {
              const n = [...value] as Vec3;
              n[i] = v;
              onCommit(n, g);
            }}
          />
        ))}
      </div>
    </div>
  );
}

function NameField({ id, name }: { id: string; name: string }) {
  const [text, setText] = useState(name);
  useEffect(() => setText(name), [name, id]);
  const dispatch = useStore((s) => s.dispatch);
  const commit = () => {
    const t = text.trim();
    if (!t) return setText(name);
    if (t !== name) dispatch({ type: 'object_transform', object: id, name: t });
  };
  return (
    <input
      className="text-input"
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
    />
  );
}

function PoseLibrary({ id }: { id: string }) {
  const custom = useStore(useShallow((s) => Object.keys(s.project.customPoses)));
  const dispatch = useStore((s) => s.dispatch);
  const [name, setName] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const save = () => {
    const n = name.trim();
    if (!n) return;
    const r = dispatch({ type: 'pose_save', object: id, name: n });
    if (r.ok) {
      setName('');
      setErr(null);
    } else setErr(r.error ?? 'Could not save pose');
  };
  return (
    <>
      <div className="section-title sm">Pose library</div>
      <div className="row">
        <input
          className="text-input"
          placeholder="Pose name"
          maxLength={40}
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setErr(null);
          }}
          onKeyDown={(e) => e.key === 'Enter' && save()}
        />
        <button className="btn" disabled={!name.trim()} title="Save the current pose to the library" onClick={save}>Save pose</button>
      </div>
      {err && <div className="note err">{err}</div>}
      {!custom.length && <div className="muted small">No saved poses yet. Saved poses live in the project file.</div>}
      {custom.map((p) => (
        <div key={p} className="row pose-row">
          <span className="ellipsis" title={p}>{p}</span>
          <span className="pose-actions">
            <button className="btn" onClick={() => dispatch({ type: 'pose_apply', object: id, pose: p })}>Apply</button>
            <button className="icon-btn" title="Delete pose" onClick={() => dispatch({ type: 'pose_delete', name: p })}>
              <Icon name="trash" />
            </button>
          </span>
        </div>
      ))}
    </>
  );
}

function CharacterSection({ obj }: { obj: SceneObject }) {
  useSyncExternalStore(onRegistryChange, registryVersion);
  const dispatch = useStore((s) => s.dispatch);
  const list = listCharacters();
  const def = getCharacter(obj.character);
  const [err, setErr] = useState<string | null>(null);
  const mats: { id: MaterialMode; label: string; hint: string }[] = [
    { id: 'doll', label: 'Doll', hint: 'Matte grey art-doll material' },
    { id: 'original', label: 'Original', hint: "The character file's own textures" },
  ];
  return (
    <section>
      <div className="section-title">Character</div>
      <div className="row">
        <span className="muted">Model</span>
        <select
          value={def ? obj.character : ''}
          onChange={(e) => {
            const d = getCharacter(e.target.value);
            if (!d) return;
            const r = dispatch({ type: 'object_set_character', object: obj.id, character: d.id, material: d.defaultMaterial });
            setErr(r.ok ? null : r.error ?? 'Could not change the character');
          }}
        >
          {!def && <option value="">Missing: {obj.character}</option>}
          {list.map((c) => (
            <option key={c.id} value={c.id}>{c.label}{c.custom ? ' (imported)' : ''}</option>
          ))}
        </select>
      </div>
      <div className="row">
        <span className="muted">Material</span>
        <span className="seg">
          {mats.map((m) => (
            <button
              key={m.id}
              className={'btn' + (obj.material === m.id ? ' on' : '')}
              title={m.hint}
              disabled={def?.kind === 'procedural' && m.id === 'original'}
              onClick={() => dispatch({ type: 'object_set_character', object: obj.id, character: obj.character, material: m.id })}
            >
              {m.label}
            </button>
          ))}
        </span>
      </div>
      {err && <div className="note err">{err}</div>}
      {!def && <div className="note err">This character is not available in this browser (imported files are stored locally). The procedural doll is shown instead.</div>}
      {def?.custom && <div className="note">Imported characters live only in this browser; the project file just references them.</div>}
    </section>
  );
}

function BodySection({ obj }: { obj: SceneObject }) {
  const dispatch = useStore((s) => s.dispatch);
  const prof = profileOf(obj);
  const gender = genderOf(obj);
  const hero = isSuperhero(obj.character);
  const group = useRef('');
  const [err, setErr] = useState<string | null>(null);
  const run = (c: { preset?: BodyPreset; heightScale?: number; gender?: 'm' | 'f' }, g?: string) => {
    const r = dispatch({ type: 'object_set_body', object: obj.id, ...c }, g ? { group: g } : undefined);
    setErr(r.ok ? null : r.error ?? 'Could not change the body');
  };
  return (
    <section>
      <div className="section-title">Body</div>
      <div className="row">
        <span className="seg body-seg">
          {BODY_PRESETS.map((p) => {
            const blocked = hero && isChildPreset(p);
            return (
              <button
                key={p}
                className={'btn' + (prof.preset === p ? ' on' : '')}
                disabled={blocked}
                title={blocked ? 'Superhero characters only support Remaja and Dewasa' : BODY_HINT[p]}
                onClick={() => run({ preset: p })}
              >
                {BODY_SHORT[p]}
              </button>
            );
          })}
        </span>
      </div>
      <div className="row body-height">
        <span className="muted">Height</span>
        <input
          type="range"
          className="slider"
          min={HEIGHT_SCALE_MIN}
          max={HEIGHT_SCALE_MAX}
          step={0.01}
          value={prof.heightScale}
          title="Fine-tune the height of this preset (+/- 10%)"
          onPointerDown={() => (group.current = 'body-' + Date.now() + Math.random())}
          onChange={(e) => run({ heightScale: parseFloat(e.target.value) }, group.current || undefined)}
        />
        <span className="mono body-m" title="Nominal height">{prof.height.toFixed(2)} m</span>
        <span className="seg" title="Gender: only a subtle proportion difference and the base character (the adult female uses Mannequin F)">
          {(['m', 'f'] as const).map((g) => (
            <button key={g} className={'btn' + (gender === g ? ' on' : '')} onClick={() => run({ gender: g })}>{g.toUpperCase()}</button>
          ))}
        </span>
      </div>
      {err && <div className="note err">{err}</div>}
      {prof.heightScale !== 1 && (
        <div className="btn-row">
          <button className="btn" onClick={() => run({ heightScale: 1 })}>Reset height</button>
        </div>
      )}
      <div className="note">Bayi and Anak use the neutral mannequin. Changing the body unpins the feet.</div>
    </section>
  );
}

const LIMB_LABEL: Record<Limb, string> = { L_arm: 'Left arm', R_arm: 'Right arm', L_leg: 'Left leg', R_leg: 'Right leg' };

function IkSection({ obj }: { obj: SceneObject }) {
  const dispatch = useStore((s) => s.dispatch);
  const ikOn = useStore((s) => s.ikOn);
  const pinned = hasPins(obj);
  return (
    <section>
      <div className="section-title">IK</div>
      <label className="row check" title="Show IK handles on the wrists and ankles (I). Drag a handle to pose the limb; one undo step per drag.">
        <input type="checkbox" checked={ikOn} onChange={(e) => useStore.getState().setIkOn(e.target.checked)} />
        <span>IK handles</span>
      </label>
      <div className="vec-title">Pole angle (deg): swivel of elbow / knee around the limb</div>
      {LIMBS.map((l) => (
        <div key={l} className="limb-row">
          <span className="muted small">{LIMB_LABEL[l]}</span>
          <NumberField
            label="P"
            value={poleAngleOf(obj.pose, obj.hipsPos, l, profileOf(obj))}
            step={1}
            decimals={1}
            min={-180}
            max={180}
            title="Keeps the hand / foot where it is and swivels the elbow / knee"
            onCommit={(v, group) => dispatch({ type: 'ik_reach', object: obj.id, limb: l, target: endWorld(obj, l), poleAngle: v }, { group })}
          />
        </div>
      ))}
      <div className="vec-title">Foot pin (stays at its world position when the body moves)</div>
      <label className="row check">
        <input type="checkbox" checked={!!obj.pins.L_foot} onChange={(e) => dispatch({ type: 'ik_pin', object: obj.id, limb: 'L_foot', pinned: e.target.checked })} />
        <span>Pin left foot</span>
      </label>
      <label className="row check">
        <input type="checkbox" checked={!!obj.pins.R_foot} onChange={(e) => dispatch({ type: 'ik_pin', object: obj.id, limb: 'R_foot', pinned: e.target.checked })} />
        <span>Pin right foot</span>
      </label>
      <div className="btn-row">
        <button className="btn" disabled={!pinned} title="Key the pinned legs on every frame of the animation and remove the pins, so the result stays without them" onClick={() => dispatch({ type: 'ik_bake', object: obj.id })}>
          Bake pins
        </button>
      </div>
      {pinned && <div className="note">Pinned legs are solved by IK; editing their joints by hand is overridden. Use Bake pins to turn them into plain keys.</div>}
    </section>
  );
}

function CameraSection({ obj }: { obj: SceneObject }) {
  const dispatch = useStore((s) => s.dispatch);
  const through = useStore((s) => s.lookThrough);
  const [key, setKey] = useState(false);
  return (
    <section>
      <div className="section-title">Render camera</div>
      <VecRow title="Target (m)" value={obj.target} step={0.01} decimals={3} onCommit={(v, group) => dispatch({ type: 'camera_set', object: obj.id, target: v }, { group })} />
      <div className="vec-fields">
        <NumberField label="FOV" value={obj.fov} step={0.5} decimals={1} min={1} max={170} title="Vertical field of view (degrees)" onCommit={(v, group) => dispatch({ type: 'camera_set', object: obj.id, fov: v }, { group })} />
      </div>
      <div className="btn-row">
        <button className={'btn' + (through ? ' on' : '')} title="Look through the render camera (C)" onClick={() => useStore.getState().setLookThrough(!through)}>Look through (C)</button>
      </div>
      <div className="btn-row">
        <button className="btn" title="Copy the current editor view (orbit position, target, FOV) into this camera" onClick={() => setCameraFromView(obj.id, key)}>Set from view</button>
      </div>
      <label className="row check">
        <input type="checkbox" checked={key} onChange={(e) => setKey(e.target.checked)} />
        <span>Also set a key at the playhead</span>
      </label>
      <div className="note">Keys on position, target and fov (K or Auto-key) animate the camera. Exports use this camera when it exists.</div>
    </section>
  );
}

export function Inspector({ open }: { open?: boolean }) {
  const obj = useStore(selectedObject);
  const joint = useStore((s) => s.selection.joint);
  const autoKey = useStore((s) => s.autoKey);
  const dispatch = useStore((s) => s.dispatch);

  if (!obj) {
    return (
      <aside className={'panel inspector' + (open ? ' open' : '')} data-tour="inspector">
        <div className="panel-head"><span className="panel-title">Inspector</span></div>
        <div className="panel-body"><div className="empty">Nothing selected. Click an object in the viewport or outliner.</div></div>
      </aside>
    );
  }
  const isDoll = obj.kind === 'mannequin';
  const isCam = obj.kind === 'camera';
  const animated = Object.keys(obj.tracks).length > 0;
  const def = joint && isDoll ? RIG_BY_NAME[joint] : null;

  return (
    <aside className={'panel inspector' + (open ? ' open' : '')} data-tour="inspector">
      <div className="panel-head"><span className="panel-title">Inspector</span></div>
      <div className="panel-body">
        <section>
          <NameField id={obj.id} name={obj.name} />
          <div className="muted small">{obj.kind}{animated ? ' - animated' : ''}</div>
          {animated && !autoKey && (
            <div className="note">This object has keys. Edits show until the playhead moves; press K (or enable Auto-key) to keep them.</div>
          )}
        </section>

        {def && joint && (
          <section>
            <div className="section-title">Joint: {joint}</div>
            <VecRow
              title="Rotation (deg)"
              value={obj.pose[joint]}
              step={1}
              decimals={1}
              min={def.min}
              max={def.max}
              onCommit={(v, group) => dispatch({ type: 'joint_set', object: obj.id, joint, rotation: v }, { group })}
            />
            {joint === 'hips' && (
              <VecRow
                title="Hips offset (m, adult units; scaled to the body)"
                value={obj.hipsPos}
                step={0.01}
                decimals={3}
                onCommit={(v, group) => dispatch({ type: 'joint_set', object: obj.id, joint, position: v }, { group })}
              />
            )}
            <div className="btn-row">
              <button className="btn" onClick={() => dispatch({ type: 'joint_reset', object: obj.id, joint })}>Reset joint</button>
            </div>
          </section>
        )}

        <section>
          <div className="section-title">Transform</div>
          <VecRow title="Position (m)" value={obj.position} step={0.01} decimals={3} onCommit={(v, group) => dispatch({ type: 'object_transform', object: obj.id, position: v }, { group })} />
          {!isCam && <VecRow title="Rotation (deg)" value={obj.rotation} step={1} decimals={1} onCommit={(v, group) => dispatch({ type: 'object_transform', object: obj.id, rotation: v }, { group })} />}
          {!isCam && <VecRow title="Scale" value={obj.scale} step={0.01} decimals={3} onCommit={(v, group) => dispatch({ type: 'object_transform', object: obj.id, scale: v }, { group })} />}
        </section>

        {isDoll && <BodySection obj={obj} />}
        {isCam && <CameraSection obj={obj} />}
        {isDoll && <IkSection obj={obj} />}

        {isDoll && <CharacterSection obj={obj} />}

        {isDoll && (
          <section>
            <div className="section-title">Pose</div>
            <div className="row">
              <span className="muted">Preset</span>
              <select
                value=""
                onChange={(e) => {
                  if (e.target.value) dispatch({ type: 'pose_apply', object: obj.id, pose: e.target.value });
                }}
              >
                <option value="">Choose...</option>
                {POSE_NAMES.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </div>
            <div className="btn-row">
              <button className="btn" onClick={() => dispatch({ type: 'joint_reset', object: obj.id })}>Reset pose</button>
            </div>
            <div className="btn-row">
              <button className="btn" title="Copy left side to right (M)" onClick={() => dispatch({ type: 'pose_mirror', object: obj.id, from: 'L' })}>Mirror L to R</button>
              <button className="btn" title="Copy right side to left (Shift+M)" onClick={() => dispatch({ type: 'pose_mirror', object: obj.id, from: 'R' })}>Mirror R to L</button>
            </div>
            <PoseLibrary id={obj.id} />
          </section>
        )}
      </div>
    </aside>
  );
}
