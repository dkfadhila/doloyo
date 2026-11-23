import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { BODY_LABEL } from '../core/body';
import { CHILDREN } from '../core/rig';
import { OBJECT_KINDS, type BackdropSlot, type BodyPreset, type Gender, type JointName, type ObjectKind } from '../core/types';
import { KIND_LABEL, SCENE_PRESETS, type ScenePreset } from '../core/commands';
import { listCharacters, onRegistryChange, registryVersion } from '../characters/registry';
import { useStore } from '../store';
import { Icon } from './Icons';
import { addCameraFromView } from './keyActions';
import { openImagePicker } from './ImageUi';
import { Pop } from './Popover';
import { useUi } from './uiStore';

/** Quick add of a body size x gender. Labels are Indonesian. */
const QUICK_ADD: { label: string; preset: BodyPreset; gender: Gender }[] = [
  { label: 'Baby boy', preset: 'kecil', gender: 'm' },
  { label: 'Baby girl', preset: 'kecil', gender: 'f' },
  { label: 'Boy (child)', preset: 'pendek', gender: 'm' },
  { label: 'Girl (child)', preset: 'pendek', gender: 'f' },
  { label: 'Teen boy', preset: 'remaja', gender: 'm' },
  { label: 'Teen girl', preset: 'remaja', gender: 'f' },
  { label: 'Man', preset: 'dewasa', gender: 'm' },
  { label: 'Woman', preset: 'dewasa', gender: 'f' },
];

function PresetMenu() {
  useSyncExternalStore(onRegistryChange, registryVersion);
  const [open, setOpen] = useState(false);
  const [character, setCharacter] = useState('');
  const [replace, setReplace] = useState(true);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', h);
    return () => document.removeEventListener('pointerdown', h);
  }, [open]);
  return (
    <div className="menu" ref={ref}>
      <button className={'icon-btn' + (open ? ' on' : '')} title="Scene presets: duo, trio, group of 5 in an arc" onClick={() => setOpen(!open)}>
        <Icon name="users" />
      </button>
      {open && (
        <Pop className="menu-pop right preset-pop">
          <div className="row">
            <span className="muted">Character</span>
            <select value={character} onChange={(e) => setCharacter(e.target.value)}>
              <option value="">Mixed F / M</option>
              {listCharacters().map((c) => (
                <option key={c.id} value={c.id}>{c.label}</option>
              ))}
            </select>
          </div>
          <label className="row check">
            <input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} />
            <span>Replace existing mannequins</span>
          </label>
          {(Object.keys(SCENE_PRESETS) as ScenePreset[]).map((p) => (
            <button
              key={p}
              className="menu-item"
              onClick={() => {
                useStore.getState().dispatch({ type: 'scene_preset', preset: p, ...(character ? { character } : {}), clear: replace });
                setOpen(false);
              }}
            >
              <span>{SCENE_PRESETS[p].label}</span>
              <span className="muted mono">{SCENE_PRESETS[p].count} dolls</span>
            </button>
          ))}
          <div className="muted small preset-note">Mixed F/M. Family: 2 adults, 1 child, 1 baby.</div>
        </Pop>
      )}
    </div>
  );
}

function JointTree({ id, name, depth }: { id: string; name: JointName; depth: number }) {
  const selected = useStore((s) => s.selection.object === id && s.selection.joint === name);
  const select = useStore((s) => s.select);
  return (
    <>
      <div className={'row-item' + (selected ? ' sel' : '')} style={{ paddingLeft: 8 + depth * 12 }} onClick={() => select(id, name)}>
        <span className="chev" />
        <Icon name="joint" size={12} />
        <span className="ellipsis">{name}</span>
      </div>
      {(CHILDREN[name] ?? []).map((c) => (
        <JointTree key={c} id={id} name={c} depth={depth + 1} />
      ))}
    </>
  );
}

function ObjectItem({ id, kind, name }: { id: string; kind: ObjectKind; name: string }) {
  const selected = useStore((s) => s.selection.object === id);
  const open = useStore((s) => s.collapse['ol:' + id] === true);
  const select = useStore((s) => s.select);
  const toggle = useStore((s) => s.toggleCollapse);
  const isDoll = kind === 'mannequin';
  const locked = useStore((s) => !!s.project.objects.find((o) => o.id === id)?.image?.locked);
  return (
    <>
      <div className={'row-item' + (selected ? ' sel' : '')} onClick={() => { useUi.getState().setBgSelected(null); select(id, null); }}>
        {isDoll ? (
          <button
            className="chev-btn"
            title={open ? 'Collapse joints' : 'Expand joints'}
            onClick={(e) => {
              e.stopPropagation();
              toggle('ol:' + id);
            }}
          >
            <Icon name={open ? 'down' : 'right'} size={12} />
          </button>
        ) : (
          <span className="chev" />
        )}
        <Icon name={kind} size={14} />
        <span className="ellipsis">{name}</span>
        {locked && <span className="muted small">locked</span>}
      </div>
      {isDoll && open && <JointTree id={id} name="hips" depth={1} />}
    </>
  );
}

const BG_LABEL: Record<BackdropSlot, string> = { viewport: 'Viewport background', camera: 'Camera background' };

/** Row of a background image (they are not scene objects: screen-space or locked to the render camera). */
function BackdropRow({ slot }: { slot: BackdropSlot }) {
  const b = useStore((s) => (slot === 'camera' ? s.project.cameraBackground : s.project.background));
  const slotSel = useUi((s) => s.bgSelected === slot);
  const noObject = useStore((s) => !s.selection.object);
  const selected = slotSel && noObject;
  if (!b) return null;
  return (
    <div
      className={'row-item' + (selected ? ' sel' : '')}
      title={`${BG_LABEL[slot]}: ${b.name}`}
      onClick={() => {
        useStore.getState().select(null);
        useUi.getState().setBgSelected(slot);
      }}
    >
      <span className="chev" />
      <Icon name="image" size={14} />
      <span className="ellipsis">{BG_LABEL[slot]}: {b.name}</span>
      {!b.visible && <span className="muted small">hidden</span>}
    </div>
  );
}

export function Outliner() {
  const sig = useStore((s) => s.project.objects.map((o) => [o.id, o.kind, o.name].join('\u0001')).join('\u0002'));
  const selectedId = useStore((s) => s.selection.object);
  const bgSel = useUi((s) => s.bgSelected);
  const hasBg = useStore((s) => (bgSel === 'camera' ? !!s.project.cameraBackground : bgSel === 'viewport' ? !!s.project.background : false));
  const anyBg = useStore((s) => !!(s.project.background || s.project.cameraBackground));
  const dispatch = useStore((s) => s.dispatch);
  const [menu, setMenu] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    const h = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setMenu(false);
    };
    document.addEventListener('pointerdown', h);
    return () => document.removeEventListener('pointerdown', h);
  }, [menu]);

  const items = sig ? sig.split('\u0002').map((x) => x.split('\u0001')) : [];

  return (
    <div className="panel outliner">
      <div className="panel-head">
        <span className="panel-title">Outliner</span>
        <div className="spacer" />
        <PresetMenu />
        <div className="menu" ref={ref}>
          <button className="icon-btn" title="Add object" onClick={() => setMenu(!menu)}>
            <Icon name="plus" />
          </button>
          {menu && (
            <div className="menu-pop right">
              {OBJECT_KINDS.filter((k) => k !== 'image').map((k) => (
                <button
                  key={k}
                  className="menu-item"
                  onClick={() => {
                    setMenu(false);
                    if (k === 'camera') addCameraFromView();
                    else dispatch({ type: 'object_add', kind: k });
                  }}
                >
                  <span className="with-icon">
                    <Icon name={k} size={14} />
                    {KIND_LABEL[k]}
                  </span>
                </button>
              ))}
              <button
                className="menu-item"
                title="Viewport background, image plane or camera background"
                onClick={() => {
                  setMenu(false);
                  openImagePicker();
                }}
              >
                <span className="with-icon">
                  <Icon name="image" size={14} />
                  Reference image...
                </span>
              </button>
              <div className="menu-sep" />
              <div className="menu-label muted small">Ukuran tubuh</div>
              {QUICK_ADD.map((q) => (
                <button
                  key={q.label}
                  className="menu-item"
                  title={BODY_LABEL[q.preset]}
                  onClick={() => {
                    setMenu(false);
                    dispatch({ type: 'object_add', kind: 'mannequin', name: q.label, character: q.gender === 'f' ? 'mannequin-f' : 'mannequin-m', body: { preset: q.preset, gender: q.gender } });
                  }}
                >
                  <span className="with-icon">
                    <Icon name="mannequin" size={14} />
                    {q.label}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
        <button
          className="icon-btn"
          title="Delete selected object (Delete)"
          disabled={!selectedId && !(bgSel && hasBg)}
          onClick={() => {
            if (selectedId) dispatch({ type: 'object_remove', object: selectedId });
            else if (bgSel && hasBg) dispatch({ type: 'image_remove', background: bgSel });
          }}
        >
          <Icon name="trash" />
        </button>
      </div>
      <div className="panel-body">
        {items.map(([id, kind, name]) => (
          <ObjectItem key={id} id={id} kind={kind as ObjectKind} name={name} />
        ))}
        {anyBg && <div className="outliner-sep muted small">Reference images</div>}
        <BackdropRow slot="viewport" />
        <BackdropRow slot="camera" />
        {!items.length && !anyBg && <div className="empty">Scene is empty. Use + to add an object.</div>}
      </div>
    </div>
  );
}
