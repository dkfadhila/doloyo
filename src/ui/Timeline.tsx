import { useEffect, useMemo, useRef, useState } from 'react';
import { create } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import { isBezier } from '../core/interpolate';
import { JOINTS } from '../core/rig';
import { EASINGS, type Easing, type JointName, type NamedEasing, type Tracks } from '../core/types';
import { useStore, type KeySel } from '../store';
import { CurveEditor } from './CurveEditor';
import { Icon } from './Icons';
import { fmtTime } from './fmt';
import { copySelectedKeys, pasteKeys } from './keyActions';
import { NumberField } from './NumberField';
import { clampWindow, MAX_ZOOM, panBy, useTlView, useViewWindow, zoomAt } from './timelineView';
import { useUi } from './uiStore';

export { fmtTime };

const EASING_LABEL: Record<NamedEasing, string> = {
  linear: 'Linear',
  easeIn: 'Ease in',
  easeOut: 'Ease out',
  easeInOut: 'Ease in-out',
  step: 'Step',
};

function Readout() {
  const time = useStore((s) => s.project.time);
  const duration = useStore((s) => s.project.duration);
  const fps = useStore((s) => s.project.fps);
  return (
    <div className="readout mono" title="Current time / duration (frame)">
      <span className="cur">{fmtTime(time)}</span>
      <span className="muted"> / {fmtTime(duration)}</span>
      <span className="muted small"> f{Math.round(time * fps)}</span>
    </div>
  );
}

/** Easing of the primary selected key (null when there is none). */
function useSelectedEasing(): Easing | null {
  const json = useStore((s) => {
    const k = s.selection.key;
    if (!k) return '';
    const o = s.project.objects.find((x) => x.id === k.object);
    if (!o) return '';
    const chans = k.target === 'all' ? Object.keys(o.tracks) : [k.target];
    for (const ch of chans) {
      const kf = o.tracks[ch]?.find((x) => Math.abs(x.t - k.time) < 1e-3);
      if (kf) return JSON.stringify(kf.easing);
    }
    return '';
  });
  return json ? (JSON.parse(json) as Easing) : null;
}

function ZoomControl() {
  const zoom = useTlView((s) => s.zoom);
  return (
    <span className="zoom-ctl" title="Timeline zoom (Ctrl+wheel; middle-drag or Shift+wheel to pan)">
      <Icon name="zoom" size={14} />
      <input
        type="range"
        min={0}
        max={100}
        value={Math.round((Math.log(zoom) / Math.log(MAX_ZOOM)) * 100)}
        onChange={(e) => {
          const z = Math.pow(MAX_ZOOM, +e.target.value / 100);
          const st = useStore.getState().project;
          const v = useTlView.getState();
          const cur = clampWindow(v.zoom, v.start, st.duration);
          const mid = cur.start + cur.span / 2;
          const span = st.duration / z;
          const w = clampWindow(z, mid - span / 2, st.duration);
          v.set(z, w.start);
        }}
      />
      <button className="btn" onClick={() => useTlView.getState().set(1, 0)} disabled={zoom === 1} title="Fit the whole duration">Fit</button>
    </span>
  );
}

function Transport() {
  const playing = useStore((s) => s.playing);
  const fps = useStore((s) => s.project.fps);
  const duration = useStore((s) => s.project.duration);
  const loop = useStore((s) => s.project.loop);
  const autoKey = useStore((s) => s.autoKey);
  const keySel = useStore((s) => s.selection.key);
  const nKeys = useStore((s) => s.keySet.length);
  const hasClip = useStore((s) => !!s.clipboard);
  const onion = useStore((s) => s.onion);
  const view = useUi((s) => s.timelineView);
  const easing = useSelectedEasing();
  const selObj = useStore((s) => s.selection.object);
  const st = useStore.getState;

  const setEasing = (e: NamedEasing) => {
    const s = st();
    const refs = s.keySet.length ? s.keySet : s.selection.key ? [s.selection.key] : [];
    if (!refs.length) return;
    s.dispatch({ type: 'batch', commands: refs.map((k) => ({ type: 'key_set_easing', object: k.object, target: k.target, time: k.time, easing: e })) });
  };
  const removeKeys = () => {
    const s = st();
    const refs = s.keySet.length ? s.keySet : s.selection.key ? [s.selection.key] : [];
    if (refs.length) s.dispatch({ type: 'keys_remove', keys: refs.map((k) => ({ object: k.object, target: k.target, time: k.time })) });
  };

  return (
    <div className="transport">
      <button className="icon-btn" title={playing ? 'Pause (Space)' : 'Play (Space)'} onClick={() => st().togglePlay()}>
        <Icon name={playing ? 'pause' : 'play'} />
      </button>
      <button className="icon-btn" title="Stop and rewind" onClick={() => st().stop()}>
        <Icon name="stop" />
      </button>
      <Readout />
      <span className="seg" title="Timeline view">
        <button className={'btn' + (view === 'keys' ? ' on' : '')} onClick={() => useUi.getState().setTimelineView('keys')}>Keys</button>
        <button className={'btn' + (view === 'curves' ? ' on' : '')} onClick={() => useUi.getState().setTimelineView('curves')}>Curves</button>
      </span>
      <div className="sep" />
      <select title="Frames per second" value={fps} onChange={(e) => st().dispatch({ type: 'timeline_set', fps: Number(e.target.value) })}>
        {[24, 30, 60].map((f) => (
          <option key={f} value={f}>{f} fps</option>
        ))}
      </select>
      <div className="dur">
        <NumberField label="Dur" value={duration} step={0.1} min={0.1} max={600} decimals={2} title="Duration in seconds" onCommit={(v, g) => st().dispatch({ type: 'timeline_set', duration: v }, { group: g })} />
      </div>
      <button className={'btn' + (loop ? ' on' : '')} title="Loop playback" onClick={() => st().dispatch({ type: 'timeline_set', loop: !loop })}>
        <Icon name="loop" size={14} />
        <span>Loop</span>
      </button>
      <div className="sep" />
      <button className="btn" title="Set key for selected object (K)" disabled={!selObj} onClick={() => selObj && st().dispatch({ type: 'key_add', object: selObj })}>
        <Icon name="key" size={14} />
        <span>Set key</span>
      </button>
      <button className={'btn' + (autoKey ? ' on' : '')} title="Auto-key: pose edits also set a key at the playhead" onClick={() => st().toggleAutoKey()}>
        <span className={'dot' + (autoKey ? ' rec' : '')} />
        <span>Auto-key</span>
      </button>
      <div className="sep" />
      <button className={'btn' + (onion.on ? ' on' : '')} title="Onion skin: ghosts of the selected mannequin at the previous (blue) and next (orange) key (O)" onClick={() => st().setOnion({ on: !onion.on })}>
        <Icon name="onion" size={14} />
        <span>Onion</span>
      </button>
      <select title="Onion skin distance" value={onion.frames} onChange={(e) => st().setOnion({ frames: +e.target.value })}>
        <option value={0}>Keys</option>
        {[1, 2, 3, 5, 10].map((n) => (
          <option key={n} value={n}>{'+-' + n + ' fr'}</option>
        ))}
      </select>
      <div className="sep" />
      <select
        title="Easing of the segment that starts at the selected key(s)"
        disabled={!keySel || !easing}
        value={easing ? (isBezier(easing) ? 'bezier' : easing) : ''}
        onChange={(e) => setEasing(e.target.value as NamedEasing)}
      >
        {!easing && <option value="">Easing</option>}
        {easing && isBezier(easing) && <option value="bezier" disabled>Custom curve</option>}
        {EASINGS.map((e) => (
          <option key={e} value={e}>{EASING_LABEL[e]}</option>
        ))}
      </select>
      <button className="btn" title="Copy selected keys (Ctrl+C)" disabled={!keySel} onClick={() => copySelectedKeys()}>Copy</button>
      <button className="btn" title="Paste keys at the playhead onto the selected object (Ctrl+V)" disabled={!hasClip || !selObj} onClick={() => pasteKeys()}>Paste</button>
      <button className="icon-btn" title={nKeys > 1 ? `Delete ${nKeys} selected keys (Delete)` : 'Delete selected key (Delete)'} disabled={!keySel} onClick={removeKeys}>
        <Icon name="trash" />
      </button>
      {view === 'keys' && (
        <>
          <div className="sep" />
          <ZoomControl />
        </>
      )}
    </div>
  );
}

function keyTimes(tracks: Tracks, target: string): number[] {
  const set = new Map<number, number>();
  const chans = target === 'all' ? Object.keys(tracks) : [target];
  for (const ch of chans) for (const k of tracks[ch] ?? []) set.set(Math.round(k.t * 1000), k.t);
  return [...set.values()].sort((a, b) => a - b);
}

/** Live preview of a multi-key drag (shared by every row). */
const useKeyDrag = create<{ keys: KeySel[]; delta: number }>(() => ({ keys: [], delta: 0 }));

const same = (a: KeySel, b: KeySel) => a.object === b.object && a.target === b.target && Math.abs(a.time - b.time) < 1e-3;

function Playhead() {
  const t = useStore((s) => s.project.time);
  const w = useViewWindow();
  const p = (t - w.start) / w.span;
  return <div className="playhead" style={{ ['--p' as string]: Math.min(1, Math.max(0, p)), display: p < -1e-6 || p > 1 + 1e-6 ? 'none' : undefined }} />;
}

/** Client rect of the time axis (the ruler's inner box). */
const axisRect = () => document.querySelector('.ruler .tl-inner')?.getBoundingClientRect() ?? null;

function timeAt(clientX: number): number {
  const r = axisRect();
  const { zoom, start } = useTlView.getState();
  const dur = useStore.getState().project.duration;
  const w = clampWindow(zoom, start, dur);
  if (!r || r.width <= 0) return 0;
  const u = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
  return w.start + u * w.span;
}

function Ruler() {
  const w = useViewWindow();
  const inner = useRef<HTMLDivElement>(null);
  const [px, setPx] = useState(600);
  const pan = useRef<{ x: number; start: number } | null>(null);
  useEffect(() => {
    const el = inner.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setPx(el.clientWidth));
    ro.observe(el);
    setPx(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  const seek = (e: React.PointerEvent) => {
    useStore.getState().dispatch({ type: 'playhead_seek', time: timeAt(e.clientX) });
  };
  const steps = [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 30, 60];
  const pxPerSec = px / w.span;
  const step = steps.find((s) => s * pxPerSec >= 56) ?? 60;
  const ticks: number[] = [];
  for (let t = Math.ceil(w.start / step - 1e-9) * step; t <= w.start + w.span + 1e-9; t += step) ticks.push(Math.round(t * 1000) / 1000);
  return (
    <div className="tl-row ruler-row">
      <div className="tl-label" />
      <div
        className="tl-track ruler"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          if (e.button === 1) {
            e.preventDefault();
            pan.current = { x: e.clientX, start: w.start };
            return;
          }
          useStore.getState().pause();
          seek(e);
        }}
        onPointerMove={(e) => {
          if (pan.current) {
            panBy(((pan.current.x - e.clientX) / px) * w.span);
            pan.current.x = e.clientX;
          } else if (e.buttons & 1) seek(e);
        }}
        onPointerUp={() => (pan.current = null)}
        title="Click or drag to move the playhead (, and . step one frame). Ctrl+wheel zooms."
      >
        <div className="tl-inner" ref={inner}>
          {ticks.map((t) => (
            <span key={t} className="tick mono" style={{ left: ((t - w.start) / w.span) * 100 + '%' }}>{step < 1 ? t.toFixed(2) : t}s</span>
          ))}
        </div>
      </div>
    </div>
  );
}

interface RowProps {
  objId: string;
  tracks: Tracks;
  target: string; // 'all' or joint name
  label: string;
  depth: number;
  kind: 'object' | 'joint';
  expandable?: boolean;
}

function Row({ objId, tracks, target, label, depth, kind, expandable }: RowProps) {
  const fps = useStore((s) => s.project.fps);
  const keySet = useStore((s) => s.keySet);
  const selected = useStore((s) => s.selection.object === objId && (kind === 'object' ? s.selection.joint === null : s.selection.joint === target));
  const open = useStore((s) => s.collapse['tl:' + objId] !== true);
  const times = useMemo(() => keyTimes(tracks, target), [tracks, target]);
  const dragKeys = useKeyDrag((s) => s.keys);
  const delta = useKeyDrag((s) => s.delta);
  const w = useViewWindow();
  const start = useRef<{ t: number; sel: KeySel[]; moved: boolean } | null>(null);

  const snapT = (t: number) => Math.round(t * fps) / fps;
  const pos = (t: number) => ((t - w.start) / w.span) * 100;

  const onDown = (e: React.PointerEvent, t: number) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const st = useStore.getState();
    st.pause();
    const me: KeySel = { object: objId, target, time: t };
    let sel: KeySel[];
    if (e.shiftKey || e.ctrlKey || e.metaKey) {
      const has = st.keySet.some((k) => same(k, me));
      sel = has ? st.keySet.filter((k) => !same(k, me)) : [...st.keySet, me];
      st.selectKeys(sel);
      start.current = null;
      return;
    }
    if (st.keySet.some((k) => same(k, me))) {
      sel = st.keySet;
      st.selectKeys([...sel.filter((k) => !same(k, me)), me]); // me becomes primary
    } else {
      sel = [me];
      if (target === 'all') {
        if (st.selection.object !== objId) st.select(objId, null);
      } else st.select(objId, target as JointName);
      st.selectKey(me);
    }
    st.dispatch({ type: 'playhead_seek', time: t });
    start.current = { t, sel: useStore.getState().keySet, moved: false };
    useKeyDrag.setState({ keys: start.current.sel, delta: 0 });
  };
  const onMove = (e: React.PointerEvent) => {
    const s = start.current;
    if (!s) return;
    let d = snapT(timeAt(e.clientX)) - s.t;
    const minT = Math.min(...s.sel.map((k) => k.time));
    d = Math.max(d, -minT);
    s.moved = s.moved || Math.abs(d) > 1e-6;
    useKeyDrag.setState({ delta: d });
  };
  const onUp = () => {
    const s = start.current;
    start.current = null;
    const d = useKeyDrag.getState().delta;
    useKeyDrag.setState({ keys: [], delta: 0 });
    if (!s || Math.abs(d) < 1e-6) return;
    const st = useStore.getState();
    const r = st.dispatch({ type: 'keys_edit', edits: s.sel.map((k) => ({ object: k.object, target: k.target, time: k.time, to: k.time + d })) });
    if (r.ok) {
      st.selectKeys(s.sel.map((k) => ({ ...k, time: Math.round((k.time + d) * 1000) / 1000 })));
      st.dispatch({ type: 'playhead_seek', time: s.t + d });
    }
  };

  const inView = times.filter((t) => pos(t) > -2 && pos(t) < 102);
  return (
    <div className={'tl-row' + (selected ? ' sel' : '') + (kind === 'joint' ? ' sub' : '')}>
      <div
        className="tl-label"
        style={{ paddingLeft: 6 + depth * 12 }}
        onClick={() => useStore.getState().select(objId, kind === 'joint' ? (target as JointName) : null)}
      >
        {expandable ? (
          <button
            className="chev-btn"
            title={open ? 'Collapse joint rows' : 'Expand joint rows'}
            onClick={(e) => {
              e.stopPropagation();
              useStore.getState().toggleCollapse('tl:' + objId);
            }}
          >
            <Icon name={open ? 'down' : 'right'} size={12} />
          </button>
        ) : (
          <span className="chev" />
        )}
        <span className="ellipsis">{label}</span>
      </div>
      <div className="tl-track">
        <div className="tl-inner">
          {times.length > 1 && (
            <div className="span" style={{ left: Math.max(0, pos(times[0])) + '%', width: Math.max(0, Math.min(100, pos(times[times.length - 1])) - Math.max(0, pos(times[0]))) + '%' }} />
          )}
          {inView.map((t) => {
            const me: KeySel = { object: objId, target, time: t };
            const dragging = dragKeys.some((k) => same(k, me));
            const at = dragging ? t + delta : t;
            const isSel = keySet.some((k) => same(k, me));
            return (
              <div
                key={t}
                className={'key' + (isSel ? ' sel' : '')}
                data-obj={objId}
                data-target={target}
                data-t={t}
                style={{ left: pos(at) + '%' }}
                title={`${fmtTime(at)}  (click: select, shift-click: add, drag: move)`}
                onPointerDown={(e) => onDown(e, t)}
                onPointerMove={onMove}
                onPointerUp={onUp}
                onPointerCancel={onUp}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}

interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

function KeysView() {
  const objects = useStore(useShallow((s) => s.project.objects.map((o) => o.tracks)));
  const meta = useStore((s) => s.project.objects.map((o) => o.id + '\u0001' + o.kind + '\u0001' + o.name).join('\u0002'));
  const selObj = useStore((s) => s.selection.object);
  const selJoint = useStore((s) => s.selection.joint);
  const collapse = useStore((s) => s.collapse);
  const items = meta ? meta.split('\u0002').map((m) => m.split('\u0001')) : [];
  const scroll = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<Box | null>(null);
  const pan = useRef<{ x: number; start: number } | null>(null);

  // wheel: Ctrl/Alt = zoom around the cursor, Shift = pan; plain wheel scrolls the rows
  useEffect(() => {
    const el = scroll.current;
    if (!el) return;
    const h = (e: WheelEvent) => {
      const overRuler = !!(e.target as HTMLElement).closest('.ruler');
      if (e.ctrlKey || e.metaKey || e.altKey || overRuler) {
        e.preventDefault();
        zoomAt(e.deltaY < 0 ? 1.2 : 1 / 1.2, timeAt(e.clientX));
      } else if (e.shiftKey) {
        e.preventDefault();
        const w = clampWindow(useTlView.getState().zoom, useTlView.getState().start, useStore.getState().project.duration);
        panBy((Math.sign(e.deltaY || e.deltaX) * w.span) / 12);
      }
    };
    el.addEventListener('wheel', h, { passive: false });
    return () => el.removeEventListener('wheel', h);
  }, []);

  const onDown = (e: React.PointerEvent) => {
    const tgt = e.target as HTMLElement;
    if (!tgt.closest('.tl-track') || tgt.closest('.ruler') || tgt.closest('.key')) return;
    if (e.button === 1) {
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      pan.current = { x: e.clientX, start: useTlView.getState().start };
      return;
    }
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setBox({ x0: e.clientX, y0: e.clientY, x1: e.clientX, y1: e.clientY });
  };
  const onMove = (e: React.PointerEvent) => {
    if (pan.current) {
      const r = axisRect();
      const w = clampWindow(useTlView.getState().zoom, useTlView.getState().start, useStore.getState().project.duration);
      if (r) panBy(((pan.current.x - e.clientX) / r.width) * w.span);
      pan.current.x = e.clientX;
      return;
    }
    if (box) setBox({ ...box, x1: e.clientX, y1: e.clientY });
  };
  const onUp = (e: React.PointerEvent) => {
    pan.current = null;
    if (!box) return;
    const b = { ...box, x1: e.clientX, y1: e.clientY };
    setBox(null);
    const [l, r] = [Math.min(b.x0, b.x1), Math.max(b.x0, b.x1)];
    const [t, bt] = [Math.min(b.y0, b.y1), Math.max(b.y0, b.y1)];
    const st = useStore.getState();
    if (r - l < 4 && bt - t < 4) {
      if (!e.shiftKey) st.selectKeys([]);
      return;
    }
    const hits: KeySel[] = [];
    content.current?.querySelectorAll<HTMLElement>('.key').forEach((el) => {
      const k = el.getBoundingClientRect();
      const cx = k.left + k.width / 2;
      const cy = k.top + k.height / 2;
      if (cx >= l && cx <= r && cy >= t && cy <= bt) hits.push({ object: el.dataset.obj!, target: el.dataset.target!, time: parseFloat(el.dataset.t!) });
    });
    const next = e.shiftKey ? [...st.keySet, ...hits.filter((h) => !st.keySet.some((k) => same(k, h)))] : hits;
    st.selectKeys(next);
  };

  const cr = content.current?.getBoundingClientRect();
  return (
    <div className="tl-scroll" ref={scroll}>
      <div className="tl-content" ref={content} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
        <Ruler />
        {items.map(([id, kind, name], i) => {
          const tracks = objects[i];
          const isDoll = kind === 'mannequin';
          const showJoints = isDoll && id === selObj && collapse['tl:' + id] !== true;
          return (
            <div key={id}>
              <Row objId={id} tracks={tracks} target="all" label={name} depth={0} kind="object" expandable={isDoll && id === selObj} />
              {showJoints &&
                JOINTS.filter((j) => tracks[j]?.length || j === selJoint).map((j) => (
                  <Row key={j} objId={id} tracks={tracks} target={j} label={j} depth={1} kind="joint" />
                ))}
            </div>
          );
        })}
        {!items.length && <div className="empty">No objects.</div>}
        <Playhead />
        {box && cr && (
          <div
            className="marquee"
            style={{ left: Math.min(box.x0, box.x1) - cr.left, top: Math.min(box.y0, box.y1) - cr.top, width: Math.abs(box.x1 - box.x0), height: Math.abs(box.y1 - box.y0) }}
          />
        )}
      </div>
    </div>
  );
}

export function Timeline() {
  const view = useUi((s) => s.timelineView);
  return (
    <section className="timeline" data-tour="timeline">
      <Transport />
      {view === 'keys' ? <KeysView /> : <CurveEditor />}
    </section>
  );
}
