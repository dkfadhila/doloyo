import { useEffect, useMemo, useRef, useState } from 'react';
import { applyClip, startPreview, stopPreview, useAnim } from '../anim/apply';
import { listClips, searchClips, type ClipInfo } from '../anim/library';
import { useStore } from '../store';

const pretty = (n: string) => n.replace(/_/g, ' ');

/** Library of the 86 Quaternius clips: search, hover/click preview on the selected character, Apply as keys. */
export function AnimLibrary() {
  const [clips, setClips] = useState<ClipInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [target, setTarget] = useState<'selected' | 'all'>('selected');
  const [atPlayhead, setAtPlayhead] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [loops, setLoops] = useState(1);
  const [every, setEvery] = useState(1);
  const [mirror, setMirror] = useState(false);
  const [inPlace, setInPlace] = useState(false);
  const [extend, setExtend] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [pinned, setPinned] = useState<string | null>(null);
  const previewing = useAnim((s) => s.previewing);
  const loading = useAnim((s) => s.loading);
  const hover = useRef<number | undefined>(undefined);
  const dollCount = useStore((s) => s.project.objects.filter((o) => o.kind === 'mannequin').length);

  useEffect(() => {
    let dead = false;
    listClips()
      .then((c) => !dead && setClips(c))
      .catch((e) => !dead && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      dead = true;
      window.clearTimeout(hover.current);
      stopPreview();
    };
  }, []);

  const shown = useMemo(() => (clips ? searchClips(clips, q) : []), [clips, q]);

  const previewTarget = () => {
    const s = useStore.getState();
    const dolls = s.project.objects.filter((o) => o.kind === 'mannequin');
    return dolls.find((o) => o.id === s.selection.object) ?? dolls[0];
  };
  const preview = (c: ClipInfo) => {
    const t = previewTarget();
    if (!t) return setMsg('Add a mannequin first.');
    setMsg(null);
    startPreview(c, t.id, { speed, mirror, inPlace }).catch((e) => setMsg(e instanceof Error ? e.message : String(e)));
  };
  const apply = async (c: ClipInfo) => {
    setBusy(c.id);
    setMsg(null);
    try {
      const st = useStore.getState();
      const r = await applyClip(
        { clip: c.id, objects: target, start: atPlayhead ? st.project.time : 0, speed, loops, keyEvery: every, mirror, inPlace, extend },
        'ui',
      );
      setPinned(null);
      setMsg(`Applied ${pretty(c.name)} to ${r.objects.map((o) => o.name).join(', ')}: ${r.keysPerChannel} keys per channel${r.extended ? `, timeline extended to ${r.duration}s` : ''}. Ctrl+Z undoes it.`);
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="panel anim-lib">
      <div className="panel-head">
        <input className="text-input" placeholder="Search clips (walk, sword, dance...)" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="panel-body" onMouseLeave={() => !pinned && stopPreview()}>
        {error && <div className="note err" style={{ margin: 8 }}>{error}</div>}
        {!clips && !error && <div className="empty">Loading the animation list...</div>}
        {clips && !shown.length && <div className="empty">No clips match "{q}".</div>}
        {shown.map((c) => {
          const on = previewing === c.id || loading === c.id;
          return (
            <div
              key={c.id}
              className={'row-item clip' + (on ? ' sel' : '')}
              title={`${c.id} - ${c.duration.toFixed(2)}s. Hover to preview, click to keep previewing.`}
              onMouseEnter={() => {
                if (pinned) return;
                window.clearTimeout(hover.current);
                hover.current = window.setTimeout(() => preview(c), 220);
              }}
              onMouseLeave={() => {
                window.clearTimeout(hover.current);
              }}
              onClick={() => {
                window.clearTimeout(hover.current);
                if (pinned === c.id) {
                  setPinned(null);
                  stopPreview();
                } else {
                  setPinned(c.id);
                  preview(c);
                }
              }}
            >
              <span className="ellipsis clip-name">{pretty(c.name)}</span>
              <span className="mono muted small">{c.duration.toFixed(1)}s</span>
              <button
                className="btn apply"
                disabled={!!busy || !dollCount}
                onClick={(e) => {
                  e.stopPropagation();
                  apply(c);
                }}
              >
                {busy === c.id ? '...' : 'Apply'}
              </button>
            </div>
          );
        })}
      </div>
      <div className="anim-opts">
        {msg && <div className="note">{msg}</div>}
        <details>
          <summary className="small muted">Apply options: {target === 'all' ? 'all mannequins' : 'selected'}, x{speed}, {loops} loop{loops > 1 ? 's' : ''}, key every {every}f</summary>
        <div className="row">
          <span className="muted">Target</span>
          <select value={target} onChange={(e) => setTarget(e.target.value as 'selected' | 'all')}>
            <option value="selected">Selected mannequin</option>
            <option value="all">All mannequins</option>
          </select>
        </div>
        <div className="opt-grid">
          <label className="small muted">Speed
            <input className="text-input" type="number" min={0.1} max={10} step={0.1} value={speed} onChange={(e) => setSpeed(Math.max(0.1, Number(e.target.value) || 1))} />
          </label>
          <label className="small muted">Loops
            <input className="text-input" type="number" min={1} max={20} step={1} value={loops} onChange={(e) => setLoops(Math.max(1, Math.round(Number(e.target.value) || 1)))} />
          </label>
          <label className="small muted">Key every
            <select value={every} onChange={(e) => setEvery(Number(e.target.value))}>
              {[1, 2, 3, 5].map((n) => (
                <option key={n} value={n}>{n} frame{n > 1 ? 's' : ''}</option>
              ))}
            </select>
          </label>
        </div>
        <label className="row check"><input type="checkbox" checked={atPlayhead} onChange={(e) => setAtPlayhead(e.target.checked)} /><span>Start at playhead</span></label>
        <label className="row check"><input type="checkbox" checked={mirror} onChange={(e) => setMirror(e.target.checked)} /><span>Mirror left/right</span></label>
        <label className="row check"><input type="checkbox" checked={inPlace} onChange={(e) => setInPlace(e.target.checked)} /><span>In place (drop hips travel)</span></label>
        <label className="row check"><input type="checkbox" checked={extend} onChange={(e) => setExtend(e.target.checked)} /><span>Extend timeline if needed</span></label>
        </details>
        <div className="muted small">Animations: Quaternius, CC0.</div>
      </div>
    </div>
  );
}
