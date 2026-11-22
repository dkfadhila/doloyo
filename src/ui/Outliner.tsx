import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { CHILDREN } from '../core/rig';
import { OBJECT_KINDS, type JointName, type ObjectKind } from '../core/types';
import { KIND_LABEL, SCENE_PRESETS, type ScenePreset } from '../core/commands';
import { listCharacters, onRegistryChange, registryVersion } from '../characters/registry';
import { DEFAULT_CHARACTER } from '../core/types';
import { useStore } from '../store';
import { Icon } from './Icons';
import { addCameraFromView } from './keyActions';
import { Pop } from './Popover';

function PresetMenu() {
  useSyncExternalStore(onRegistryChange, registryVersion);
  const [open, setOpen] = useState(false);
  const [character, setCharacter] = useState(DEFAULT_CHARACTER);
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
                useStore.getState().dispatch({ type: 'scene_preset', preset: p, character, clear: replace });
                setOpen(false);
              }}
            >
              <span>{SCENE_PRESETS[p].label}</span>
              <span className="muted mono">{SCENE_PRESETS[p].count} dolls</span>
            </button>
          ))}
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
  return (
    <>
      <div className={'row-item' + (selected ? ' sel' : '')} onClick={() => select(id, null)}>
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
      </div>
      {isDoll && open && <JointTree id={id} name="hips" depth={1} />}
    </>
  );
}

export function Outliner() {
  const sig = useStore((s) => s.project.objects.map((o) => [o.id, o.kind, o.name].join('\u0001')).join('\u0002'));
  const selectedId = useStore((s) => s.selection.object);
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
              {OBJECT_KINDS.map((k) => (
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
            </div>
          )}
        </div>
        <button
          className="icon-btn"
          title="Delete selected object (Delete)"
          disabled={!selectedId}
          onClick={() => selectedId && dispatch({ type: 'object_remove', object: selectedId })}
        >
          <Icon name="trash" />
        </button>
      </div>
      <div className="panel-body">
        {items.map(([id, kind, name]) => (
          <ObjectItem key={id} id={id} kind={kind as ObjectKind} name={name} />
        ))}
        {!items.length && <div className="empty">Scene is empty. Use + to add an object.</div>}
      </div>
    </div>
  );
}
