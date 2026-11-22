import { useEffect, useMemo, useRef, useState } from 'react';
import { easingToBezier, isBezier, isRotationChannel, sampleTrack } from '../core/interpolate';
import { isJoint } from '../core/rig';
import type { Easing, Keyframe, Vec3 } from '../core/types';
import { useStore, type KeySel } from '../store';
import { fmtTime } from './fmt';

/** Muted X / Y / Z colors (not neon). */
const COLORS = ['#c4574f', '#5fa86a', '#5b85c9'];
const AXIS = ['X', 'Y', 'Z'];
const RULER = 18;
const BEZ_PRESETS: { label: string; e: Easing }[] = [
  { label: 'Linear', e: 'linear' },
  { label: 'In', e: 'easeIn' },
  { label: 'Out', e: 'easeOut' },
  { label: 'In-out', e: 'easeInOut' },
  { label: 'Step', e: 'step' },
];

/** True while the pointer is over the graph (F then frames the curves instead of focusing the viewport). */
export const graphState = { hover: false };
export const FRAME_ALL_EVENT = 'mdoll:frame-all';

interface View {
  t0: number;
  t1: number;
  v0: number;
  v1: number;
}

const axesOf = (ch: string) => (ch === 'fov' ? [0] : [0, 1, 2]);
const clamp = (n: number, a: number, b: number) => Math.min(b, Math.max(a, n));
const r3 = (n: number) => Math.round(n * 1000) / 1000;

function niceStep(range: number, lines: number): number {
  const raw = Math.max(range, 1e-9) / Math.max(1, lines);
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const m = raw / p;
  return (m < 1.5 ? 1 : m < 3 ? 2 : m < 7 ? 5 : 10) * p;
}

type Drag =
  | { kind: 'keys'; axis: number; x0: number; y0: number; keys: { ch: string; t: number }[]; dt: number; dv: number }
  | { kind: 'handle'; h: 1 | 2; ch: string; t: number; axis: number; c: [number, number, number, number] }
  | { kind: 'pan'; x: number; y: number }
  | { kind: 'box'; x0: number; y0: number; x1: number; y1: number }
  | { kind: 'seek' };

const same = (a: KeySel, o: string, ch: string, t: number) => a.object === o && (a.target === ch || a.target === 'all') && Math.abs(a.time - t) < 1e-3;

export function CurveEditor() {
  const selId = useStore((s) => s.selection.object);
  const obj = useStore((s) => s.project.objects.find((o) => o.id === selId) ?? s.project.objects.find((o) => Object.keys(o.tracks).length > 0) ?? s.project.objects[0]);
  const joint = useStore((s) => s.selection.joint);
  const keySet = useStore((s) => s.keySet);
  const time = useStore((s) => s.project.time);
  const duration = useStore((s) => s.project.duration);
  const fps = useStore((s) => s.project.fps);
  const wrap = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 600, h: 150 });
  const [view, setView] = useState<View>({ t0: 0, t1: 1, v0: -1, v1: 1 });
  const [manual, setManual] = useState<Record<string, boolean>>({});
  const [drag, setDrag] = useState<Drag | null>(null);
  const [axis, setAxis] = useState(0);
  const dragRef = useRef<Drag | null>(null);
  const setD = (d: Drag | null) => {
    dragRef.current = d;
    setDrag(d);
  };
  const viewRef = useRef(view);
  viewRef.current = view;

  const keyed = useMemo(() => (obj ? Object.keys(obj.tracks).filter((c) => obj.tracks[c].length) : []), [obj]);
  const visible = useMemo(() => {
    if (!obj) return [];
    let auto = new Set(joint && keyed.includes(joint) ? [joint] : keyed.filter((c) => !isJoint(c)));
    if (!auto.size && keyed.length) auto = new Set([keyed[0]]);
    return keyed.filter((c) => manual[c] ?? auto.has(c));
  }, [obj, keyed, joint, manual]);

  useEffect(() => setManual({}), [obj?.id]);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: Math.max(80, el.clientWidth), h: Math.max(60, el.clientHeight) }));
    ro.observe(el);
    setSize({ w: Math.max(80, el.clientWidth), h: Math.max(60, el.clientHeight) });
    return () => ro.disconnect();
  }, []);

  const frameAll = () => {
    if (!obj) return;
    let t0 = Infinity, t1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (const ch of visible) {
      for (const k of obj.tracks[ch]) {
        t0 = Math.min(t0, k.t);
        t1 = Math.max(t1, k.t);
        for (const a of axesOf(ch)) {
          v0 = Math.min(v0, k.value[a]);
          v1 = Math.max(v1, k.value[a]);
        }
      }
    }
    if (!isFinite(t0)) {
      t0 = 0;
      t1 = duration;
      v0 = -1;
      v1 = 1;
    }
    if (t1 - t0 < 0.2) {
      t0 -= 0.5;
      t1 += 0.5;
    }
    if (v1 - v0 < 1e-3) {
      v0 -= 1;
      v1 += 1;
    }
    const pt = (t1 - t0) * 0.06;
    const pv = (v1 - v0) * 0.12;
    setView({ t0: t0 - pt, t1: t1 + pt, v0: v0 - pv, v1: v1 + pv });
  };
  const frameRef = useRef(frameAll);
  frameRef.current = frameAll;
  useEffect(() => {
    frameRef.current();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [obj?.id]);
  useEffect(() => {
    const h = () => frameRef.current();
    window.addEventListener(FRAME_ALL_EVENT, h);
    return () => window.removeEventListener(FRAME_ALL_EVENT, h);
  }, []);

  const W = size.w;
  const PH = Math.max(10, size.h - RULER);
  const tx = (t: number) => ((t - view.t0) / (view.t1 - view.t0)) * W;
  const vy = (v: number) => RULER + PH - ((v - view.v0) / (view.v1 - view.v0)) * PH;
  const xt = (px: number) => view.t0 + (px / W) * (view.t1 - view.t0);
  const yv = (py: number) => view.v0 + ((RULER + PH - py) / PH) * (view.v1 - view.v0);
  const snapT = (t: number) => Math.max(0, Math.round(t * fps) / fps);

  // wheel zoom (native, so it can preventDefault)
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const h = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const px = e.clientX - r.left;
      const py = e.clientY - r.top;
      const f = e.deltaY < 0 ? 1 / 1.18 : 1.18;
      setView((v) => {
        if (e.shiftKey) {
          const ph = Math.max(10, el.clientHeight - RULER);
          const val = v.v0 + ((RULER + ph - py) / ph) * (v.v1 - v.v0);
          return { ...v, v0: val - (val - v.v0) * f, v1: val + (v.v1 - val) * f };
        }
        const t = v.t0 + (px / el.clientWidth) * (v.t1 - v.t0);
        return { ...v, t0: t - (t - v.t0) * f, t1: t + (v.t1 - t) * f };
      });
    };
    el.addEventListener('wheel', h, { passive: false });
    return () => el.removeEventListener('wheel', h);
  }, []);

  // preview of a drag applied to the keys
  const preview = (ch: string, keys: Keyframe[]): Keyframe[] => {
    if (!drag || !obj) return keys;
    if (drag.kind === 'keys') {
      const moved = drag.keys.filter((k) => k.ch === ch);
      if (!moved.length) return keys;
      const out = keys.map((k) => {
        const m = moved.find((x) => Math.abs(x.t - k.t) < 1e-3);
        if (!m) return k;
        const value = [...k.value] as Vec3;
        if (drag.dv) value[drag.axis] += drag.dv;
        return { ...k, t: k.t + drag.dt, value };
      });
      return out.sort((a, b) => a.t - b.t);
    }
    if (drag.kind === 'handle' && drag.ch === ch) return keys.map((k) => (Math.abs(k.t - drag.t) < 1e-3 ? { ...k, easing: { type: 'bezier' as const, c: drag.c } } : k));
    return keys;
  };

  const curves = useMemo(() => {
    if (!obj) return [];
    const n = clamp(Math.floor(W / 3), 40, 420);
    return visible.map((ch) => {
      const keys = preview(ch, obj.tracks[ch]);
      const rot = isRotationChannel(ch);
      const pts: Vec3[] = [];
      for (let i = 0; i <= n; i++) pts.push(sampleTrack(keys, view.t0 + ((view.t1 - view.t0) * i) / n, rot) ?? [0, 0, 0]);
      const paths = axesOf(ch).map((a) => ({ a, d: pts.map((p, i) => `${i ? 'L' : 'M'}${((i / n) * W).toFixed(1)} ${vy(p[a]).toFixed(1)}`).join('') }));
      return { ch, keys, paths };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [obj, visible, view, size, drag]);

  if (!obj) return <div className="empty">No objects.</div>;

  // segment handles: one selected key with a following key in the same channel
  const sel1 = keySet.length === 1 ? keySet[0] : null;
  const hCh = sel1 && sel1.object === obj.id && sel1.target !== 'all' && visible.includes(sel1.target) ? sel1.target : null;
  let handle: null | { ch: string; ka: Keyframe; kb: Keyframe; a: number; c: [number, number, number, number]; easing: Easing } = null;
  if (hCh && sel1) {
    const keys = curves.find((c) => c.ch === hCh)?.keys ?? [];
    const i = keys.findIndex((k) => Math.abs(k.t - sel1.time) < 1e-3);
    if (i >= 0 && i < keys.length - 1) {
      const ka = keys[i], kb = keys[i + 1];
      let a = axesOf(hCh).includes(axis) ? axis : 0;
      if (Math.abs(kb.value[a] - ka.value[a]) < 1e-6) {
        const best = axesOf(hCh).reduce((m, x) => (Math.abs(kb.value[x] - ka.value[x]) > Math.abs(kb.value[m] - ka.value[m]) ? x : m), a);
        a = best;
      }
      const c = easingToBezier(ka.easing);
      if (c && Math.abs(kb.value[a] - ka.value[a]) > 1e-6) handle = { ch: hCh, ka, kb, a, c, easing: ka.easing };
    }
  }

  const local = (e: React.PointerEvent | PointerEvent) => {
    const r = wrap.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const onDown = (e: React.PointerEvent) => {
    const el = e.target as SVGElement;
    const kind = el.getAttribute('data-kind');
    const p = local(e);
    wrap.current?.setPointerCapture(e.pointerId);
    const st = useStore.getState();
    if (e.button === 1) {
      e.preventDefault();
      return setD({ kind: 'pan', x: p.x, y: p.y });
    }
    if (e.button !== 0) return;
    if (p.y < RULER) {
      st.pause();
      st.dispatch({ type: 'playhead_seek', time: xt(p.x) });
      return setD({ kind: 'seek' });
    }
    if (kind === 'key') {
      const ch = el.getAttribute('data-ch')!;
      const t = parseFloat(el.getAttribute('data-t')!);
      const a = parseInt(el.getAttribute('data-axis')!, 10);
      const me: KeySel = { object: obj.id, target: ch, time: t };
      st.pause();
      setAxis(a);
      if (e.shiftKey) {
        const has = st.keySet.some((k) => same(k, obj.id, ch, t));
        st.selectKeys(has ? st.keySet.filter((k) => !same(k, obj.id, ch, t)) : [...st.keySet, me]);
        return setD(null);
      }
      if (!st.keySet.some((k) => same(k, obj.id, ch, t))) st.selectKey(me);
      const cur = useStore.getState().keySet;
      const keys = cur
        .flatMap((k) => (k.target === 'all' ? visible.filter((c) => obj.tracks[c].some((x) => Math.abs(x.t - k.time) < 1e-3)).map((c) => ({ ch: c, t: k.time })) : [{ ch: k.target, t: k.time }]))
        .filter((k) => k.ch && visible.includes(k.ch) && obj.id === cur.find((x) => same(x, obj.id, k.ch, k.t))?.object);
      if (!keys.some((k) => k.ch === ch && Math.abs(k.t - t) < 1e-3)) keys.push({ ch, t });
      return setD({ kind: 'keys', axis: a, x0: p.x, y0: p.y, keys, dt: 0, dv: 0 });
    }
    if (kind === 'handle') {
      if (!handle) return;
      return setD({ kind: 'handle', h: parseInt(el.getAttribute('data-h')!, 10) as 1 | 2, ch: handle.ch, t: handle.ka.t, axis: handle.a, c: [...handle.c] });
    }
    setD({ kind: 'box', x0: p.x, y0: p.y, x1: p.x, y1: p.y });
  };

  const onMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    const p = local(e);
    if (!d) return;
    if (d.kind === 'seek') return void useStore.getState().dispatch({ type: 'playhead_seek', time: xt(p.x) });
    if (d.kind === 'pan') {
      const dt = ((p.x - d.x) / W) * (view.t1 - view.t0);
      const dv = ((p.y - d.y) / PH) * (view.v1 - view.v0);
      setView({ t0: view.t0 - dt, t1: view.t1 - dt, v0: view.v0 + dv, v1: view.v1 + dv });
      return setD({ ...d, x: p.x, y: p.y });
    }
    if (d.kind === 'box') return setD({ ...d, x1: p.x, y1: p.y });
    if (d.kind === 'keys') {
      let dt = snapT(xt(p.x)) - snapT(xt(d.x0));
      let dv = yv(p.y) - yv(d.y0);
      if (e.shiftKey) {
        if (Math.abs(p.x - d.x0) > Math.abs(p.y - d.y0)) dv = 0;
        else dt = 0;
      }
      const minT = Math.min(...d.keys.map((k) => k.t));
      dt = Math.max(dt, -minT);
      return setD({ ...d, dt, dv });
    }
    if (d.kind === 'handle' && handle) {
      const dtSeg = handle.kb.t - handle.ka.t;
      const dvSeg = handle.kb.value[d.axis] - handle.ka.value[d.axis];
      const fx = clamp((xt(p.x) - handle.ka.t) / dtSeg, 0, 1);
      const fy = clamp((yv(p.y) - handle.ka.value[d.axis]) / dvSeg, -2, 3);
      const c = [...d.c] as [number, number, number, number];
      if (d.h === 1) [c[0], c[1]] = [r3(fx), r3(fy)];
      else [c[2], c[3]] = [r3(fx), r3(fy)];
      return setD({ ...d, c });
    }
  };

  const onUp = (e: React.PointerEvent) => {
    const d = dragRef.current;
    setD(null);
    if (!d) return;
    const st = useStore.getState();
    if (d.kind === 'box') {
      const [l, r] = [Math.min(d.x0, d.x1), Math.max(d.x0, d.x1)];
      const [t, b] = [Math.min(d.y0, d.y1), Math.max(d.y0, d.y1)];
      if (r - l < 4 && b - t < 4) {
        if (!e.shiftKey) st.selectKeys([]);
        return;
      }
      const hits: KeySel[] = [];
      for (const c of curves) {
        for (const k of c.keys) {
          const inside = axesOf(c.ch).some((a) => {
            const x = tx(k.t), y = vy(k.value[a]);
            return x >= l && x <= r && y >= t && y <= b;
          });
          if (inside) hits.push({ object: obj.id, target: c.ch, time: k.t });
        }
      }
      st.selectKeys(e.shiftKey ? [...st.keySet, ...hits.filter((h) => !st.keySet.some((k) => same(k, h.object, h.target, h.time)))] : hits);
      return;
    }
    if (d.kind === 'keys') {
      if (Math.abs(d.dt) < 1e-9 && Math.abs(d.dv) < 1e-9) {
        const k = d.keys[0];
        if (k && d.keys.length === 1) st.dispatch({ type: 'playhead_seek', time: k.t });
        return;
      }
      const edits = d.keys.map((k) => {
        const kf = obj.tracks[k.ch].find((x) => Math.abs(x.t - k.t) < 1e-3)!;
        const value = [...kf.value] as Vec3;
        if (d.dv) value[d.axis] = k.ch === 'fov' ? clamp(value[0] + d.dv, 1, 170) : value[d.axis] + d.dv;
        return { object: obj.id, target: k.ch, time: k.t, ...(Math.abs(d.dt) > 1e-9 ? { to: k.t + d.dt } : {}), ...(d.dv ? { value: value.map(r3) as Vec3 } : {}) };
      });
      const r = st.dispatch({ type: 'keys_edit', edits });
      if (r.ok && Math.abs(d.dt) > 1e-9) {
        st.selectKeys(d.keys.map((k) => ({ object: obj.id, target: k.ch, time: Math.round((k.t + d.dt) * 1000) / 1000 })));
      }
      return;
    }
    if (d.kind === 'handle') {
      st.dispatch({ type: 'key_set_easing', object: obj.id, target: d.ch, time: d.t, easing: { type: 'bezier', c: d.c } });
    }
  };

  // grid
  const vStep = niceStep(view.v1 - view.v0, Math.floor(PH / 34));
  const tStep = niceStep(view.t1 - view.t0, Math.floor(W / 70));
  const vLines: number[] = [];
  for (let v = Math.ceil(view.v0 / vStep) * vStep; v <= view.v1; v += vStep) vLines.push(Math.round(v / vStep) * vStep);
  const tLines: number[] = [];
  for (let t = Math.ceil(view.t0 / tStep) * tStep; t <= view.t1; t += tStep) tLines.push(Math.round(t / tStep) * tStep);

  const boxRect = drag?.kind === 'box' ? { x: Math.min(drag.x0, drag.x1), y: Math.min(drag.y0, drag.y1), w: Math.abs(drag.x1 - drag.x0), h: Math.abs(drag.y1 - drag.y0) } : null;
  const c = handle ? (drag?.kind === 'handle' ? drag.c : handle.c) : null;
  const seg = handle && c ? { ka: handle.ka, kb: handle.kb, a: handle.a } : null;
  const hp = (i: 1 | 2): [number, number] | null => {
    if (!seg || !c) return null;
    const dt = seg.kb.t - seg.ka.t;
    const dv = seg.kb.value[seg.a] - seg.ka.value[seg.a];
    return i === 1 ? [tx(seg.ka.t + c[0] * dt), vy(seg.ka.value[seg.a] + c[1] * dv)] : [tx(seg.ka.t + c[2] * dt), vy(seg.ka.value[seg.a] + c[3] * dv)];
  };
  const h1 = hp(1), h2 = hp(2);

  return (
    <div className="curves">
      <div className="curve-list">
        <div className="curve-legend mono">
          {AXIS.map((a, i) => (
            <span key={a} style={{ color: COLORS[i] }}>{a}</span>
          ))}
          <button className="btn" title="Frame all keys of the shown channels (F)" onClick={frameAll}>Frame</button>
        </div>
        <div className="curve-chans">
          {keyed.map((ch) => (
            <label key={ch} className="row check" title={visible.includes(ch) ? 'Hide curves' : 'Show curves'}>
              <input type="checkbox" checked={visible.includes(ch)} onChange={(e) => setManual((m) => ({ ...m, [ch]: e.target.checked }))} />
              <span className="ellipsis">{ch}</span>
            </label>
          ))}
          {!keyed.length && <div className="muted small curve-empty">{obj.name} has no keys. Press K to set one.</div>}
        </div>
      </div>
      <div className="curve-main">
        <div className="curve-head small">
          <span className="muted ellipsis">{obj.name} - wheel: zoom, Shift+wheel: zoom value, middle-drag: pan, drag empty: box select, F: frame</span>
          <span className="spacer" />
          {handle && c && (
            <>
              <span className="mono muted">cubic-bezier({c.map((n) => r3(n)).join(', ')})</span>
              {BEZ_PRESETS.map((p) => (
                <button
                  key={p.label}
                  className="btn"
                  title={'Set easing of the segment leaving the selected key: ' + p.label}
                  onClick={() => useStore.getState().dispatch({ type: 'key_set_easing', object: obj.id, target: handle!.ch, time: handle!.ka.t, easing: p.e })}
                >
                  {p.label}
                </button>
              ))}
            </>
          )}
        </div>
        <div
          className="curve-graph"
          ref={wrap}
          tabIndex={0}
          onPointerEnter={() => (graphState.hover = true)}
          onPointerLeave={() => (graphState.hover = false)}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
          onKeyDown={(e) => e.key.toLowerCase() === 'f' && frameAll()}
        >
          <svg width={W} height={size.h} className="curve-svg">
            <rect x={0} y={RULER} width={W} height={PH} fill="transparent" data-kind="bg" />
            {vLines.map((v) => (
              <g key={'v' + v}>
                <line x1={0} x2={W} y1={vy(v)} y2={vy(v)} stroke={Math.abs(v) < 1e-9 ? '#34383e' : '#202328'} />
                <text x={4} y={vy(v) - 2} className="curve-label mono">{r3(v)}</text>
              </g>
            ))}
            {tLines.map((t) => (
              <g key={'t' + t}>
                <line x1={tx(t)} x2={tx(t)} y1={RULER} y2={RULER + PH} stroke="#202328" />
                <text x={tx(t) + 3} y={12} className="curve-label mono">{r3(t)}s</text>
              </g>
            ))}
            <line x1={0} x2={W} y1={RULER} y2={RULER} stroke="#25282d" />
            {duration >= view.t0 && duration <= view.t1 && <line x1={tx(duration)} x2={tx(duration)} y1={RULER} y2={RULER + PH} stroke="#3a3e45" strokeDasharray="3 3" />}
            {curves.map((cv) =>
              cv.paths.map((p) => (
                <path key={cv.ch + p.a} d={p.d} fill="none" stroke={COLORS[p.a]} strokeWidth={1.4} opacity={0.9} pointerEvents="none" />
              )),
            )}
            <line x1={tx(time)} x2={tx(time)} y1={0} y2={RULER + PH} stroke="#3b6fe0" pointerEvents="none" />
            {seg && h1 && h2 && c && (
              <g>
                <line x1={tx(seg.ka.t)} y1={vy(seg.ka.value[seg.a])} x2={h1[0]} y2={h1[1]} stroke="#8a8f98" />
                <line x1={tx(seg.kb.t)} y1={vy(seg.kb.value[seg.a])} x2={h2[0]} y2={h2[1]} stroke="#8a8f98" />
              </g>
            )}
            {curves.map((cv) =>
              cv.keys.flatMap((k) =>
                axesOf(cv.ch).map((a) => {
                  const orig = drag?.kind === 'keys' && drag.keys.some((x) => x.ch === cv.ch && Math.abs(x.t + drag.dt - k.t) < 1e-3) ? k.t - drag.dt : k.t;
                  const selected = keySet.some((s) => same(s, obj.id, cv.ch, orig));
                  return (
                    <circle
                      key={cv.ch + a + k.t}
                      data-kind="key"
                      data-ch={cv.ch}
                      data-axis={a}
                      data-t={orig}
                      cx={tx(k.t)}
                      cy={vy(k.value[a])}
                      r={selected ? 4.5 : 3.5}
                      fill={selected ? COLORS[a] : '#16181b'}
                      stroke={selected ? '#e6e7e9' : COLORS[a]}
                      strokeWidth={1.5}
                      style={{ cursor: 'grab' }}
                    >
                      <title>{`${cv.ch} ${AXIS[a]}  t=${fmtTime(k.t)}  ${r3(k.value[a])}`}</title>
                    </circle>
                  );
                }),
              ),
            )}
            {h1 && h2 && (
              <g>
                <rect data-kind="handle" data-h={1} x={h1[0] - 4} y={h1[1] - 4} width={8} height={8} fill="#16181b" stroke="#e6e7e9" strokeWidth={1.5} style={{ cursor: 'move' }} />
                <rect data-kind="handle" data-h={2} x={h2[0] - 4} y={h2[1] - 4} width={8} height={8} fill="#16181b" stroke="#e6e7e9" strokeWidth={1.5} style={{ cursor: 'move' }} />
              </g>
            )}
            {boxRect && <rect x={boxRect.x} y={boxRect.y} width={boxRect.w} height={boxRect.h} className="marquee-svg" pointerEvents="none" />}
          </svg>
        </div>
      </div>
    </div>
  );
}

