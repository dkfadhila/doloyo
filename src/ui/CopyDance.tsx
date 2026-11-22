import { useEffect, useRef, useState } from 'react';
import { AnalyzeCancelled, analyzeVideo, MissingModelError, POSE_CONNECTIONS, resolveModelSource, type ModelSource, type VideoAnalysis } from '../mocap/analyze';
import { DEFAULT_CONVERT } from '../mocap/convert';
import { applyTracks, defaultAssignments } from '../mocap/job';
import { useStore } from '../store';
import { Icon } from './Icons';
import { useUi } from './uiStore';

function Slider({ label, value, min, max, step, onChange, title }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; title?: string }) {
  return (
    <label className="row slider" title={title}>
      <span className="muted">{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
      <span className="mono small val">{value}</span>
    </label>
  );
}

/** Copy Dance: video -> MediaPipe pose tracks -> keys on one or more dolls. Everything stays on this machine. */
export function CopyDance() {
  const open = useUi((s) => s.danceOpen);
  const close = useUi((s) => s.setDanceOpen);
  const projectFps = useStore((s) => s.project.fps);
  const dolls = useStore((s) => s.project.objects.filter((o) => o.kind === 'mannequin').map((o) => ({ id: o.id, name: o.name })));

  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [maxPeople, setMaxPeople] = useState(1);
  const [fps, setFps] = useState(projectFps);
  const [minCutoff, setMinCutoff] = useState(DEFAULT_CONVERT.minCutoff);
  const [beta, setBeta] = useState(DEFAULT_CONVERT.beta);
  const [footLock, setFootLock] = useState(true);
  const [inPlace, setInPlace] = useState(false);
  const [mirror, setMirror] = useState(false);
  const [every, setEvery] = useState(1);
  const [atPlayhead, setAtPlayhead] = useState(true);
  const [heavy, setHeavy] = useState(false);
  const [source, setSource] = useState<ModelSource | null>(null);

  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0, delegate: '' });
  const [analysis, setAnalysis] = useState<VideoAnalysis | null>(null);
  const [assign, setAssign] = useState<Record<number, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const abort = useRef<AbortController | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) setFps(useStore.getState().project.fps);
  }, [open]);
  useEffect(() => {
    if (!open) return;
    let live = true;
    resolveModelSource(heavy ? 'heavy' : 'full').then((r) => live && setSource(r.source));
    return () => {
      live = false;
    };
  }, [open, heavy]);
  useEffect(() => {
    if (!file) return setUrl(null);
    const u = URL.createObjectURL(file);
    setUrl(u);
    setAnalysis(null);
    setResult(null);
    setError(null);
    return () => URL.revokeObjectURL(u);
  }, [file]);
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === 'Escape' && !running && close(false);
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, running, close]);

  /** Draw the skeleton of every track for the frame under the playhead of the video. */
  const draw = () => {
    const v = videoRef.current;
    const c = canvasRef.current;
    if (!v || !c) return;
    c.width = v.videoWidth || 1;
    c.height = v.videoHeight || 1;
    const g = c.getContext('2d')!;
    g.clearRect(0, 0, c.width, c.height);
    if (!analysis) return;
    const frame = Math.round(v.currentTime * analysis.video.fps);
    const lw = Math.max(2, c.width / 300);
    for (const t of analysis.tracks) {
      const det = t.frames.get(frame) ?? t.frames.get(frame - 1) ?? t.frames.get(frame + 1);
      if (!det) continue;
      g.strokeStyle = t.color;
      g.fillStyle = t.color;
      g.lineWidth = lw;
      for (const { start, end } of POSE_CONNECTIONS) {
        const a = det.image[start], b = det.image[end];
        if (!a || !b || (a.visibility ?? 1) < 0.3 || (b.visibility ?? 1) < 0.3) continue;
        g.beginPath();
        g.moveTo(a.x * c.width, a.y * c.height);
        g.lineTo(b.x * c.width, b.y * c.height);
        g.stroke();
      }
      for (const p of det.image) {
        g.beginPath();
        g.arc(p.x * c.width, p.y * c.height, lw * 1.2, 0, Math.PI * 2);
        g.fill();
      }
    }
  };
  useEffect(draw, [analysis]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!open) return null;

  const analyze = async () => {
    const v = videoRef.current;
    if (!v || !file) return;
    setError(null);
    setResult(null);
    setAnalysis(null);
    setRunning(true);
    v.pause();
    const ctl = new AbortController();
    abort.current = ctl;
    try {
      const a = await analyzeVideo(v, {
        maxPeople,
        fps,
        model: heavy ? 'heavy' : 'full',
        signal: ctl.signal,
        onProgress: (done, total, delegate) => setProgress({ done, total, delegate }),
      });
      setAnalysis(a);
      const defaults = defaultAssignments(a, maxPeople);
      setAssign(Object.fromEntries(a.tracks.map((t) => [t.id, defaults.find((d) => d.track === t.id)?.object ?? 'none'])));
      if (!a.tracks.length) setError('No person was detected. Use a steady camera, the whole body in frame, bright light and clothes that contrast with the background.');
      v.currentTime = 0;
    } catch (e) {
      if (!(e instanceof AnalyzeCancelled)) setError(e instanceof Error ? e.message : String(e));
      if (e instanceof MissingModelError) setError(e.message);
    } finally {
      setRunning(false);
      abort.current = null;
    }
  };

  const apply = () => {
    if (!analysis) return;
    setError(null);
    try {
      const list = analysis.tracks.filter((t) => assign[t.id] && assign[t.id] !== 'none').map((t) => ({ track: t.id, object: assign[t.id] }));
      const start = atPlayhead ? useStore.getState().project.time : 0;
      const r = applyTracks(analysis, list, { minCutoff, beta, footLock, inPlace, mirror, keyEvery: every, start, extend: true });
      setResult(`Added ${r.assigned.map((a) => `${a.keysPerChannel} keys to ${a.object}${a.created ? ' (new)' : ''}`).join(', ')}. Ctrl+Z undoes it in one step.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const pct = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;
  const assigned = analysis ? analysis.tracks.filter((t) => assign[t.id] && assign[t.id] !== 'none').length : 0;

  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && !running && close(false)}>
      <div className="modal wide" role="dialog" aria-label="Copy Dance">
        <div className="drawer-head">
          <span className="panel-title">Copy Dance</span>
          <button className="icon-btn" disabled={running} onClick={() => close(false)} title="Close (Esc)">
            <Icon name="close" />
          </button>
        </div>
        <div className="dance-body">
          <div className="dance-video">
            {url ? (
              <div className="video-wrap">
                <video ref={videoRef} src={url} controls muted playsInline preload="auto" onSeeked={draw} onLoadedMetadata={draw} onTimeUpdate={draw} />
                <canvas ref={canvasRef} className="video-overlay" />
              </div>
            ) : (
              <div className="empty video-empty">
                <button className="btn" onClick={() => fileRef.current?.click()}>
                  <Icon name="upload" />
                  <span>Choose video...</span>
                </button>
                <div className="muted small">mp4 or webm. The video stays on this computer and is never uploaded.</div>
              </div>
            )}
            <input ref={fileRef} type="file" accept="video/*" hidden onChange={(e) => { setFile(e.target.files?.[0] ?? null); e.target.value = ''; }} />
            {url && !running && (
              <button className="btn" onClick={() => fileRef.current?.click()}>Change video</button>
            )}
            {running && (
              <div className="progress-wrap">
                <div className="progress"><div className="bar" style={{ width: pct + '%' }} /></div>
                <div className="row small muted">
                  <span className="mono">{progress.done}/{progress.total} frames ({progress.delegate || '...'})</span>
                  <button className="btn" onClick={() => abort.current?.abort()}>Cancel</button>
                </div>
              </div>
            )}
          </div>

          <div className="dance-side">
            <div className="section-title sm">Capture</div>
            <div className="row">
              <span className="muted">People (max)</span>
              <select value={maxPeople} disabled={running} onChange={(e) => setMaxPeople(Number(e.target.value))}>
                {[1, 2, 3, 4].map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
            <div className="row">
              <span className="muted">Sample fps</span>
              <input className="text-input fps-in" type="number" min={5} max={60} value={fps} disabled={running} onChange={(e) => setFps(Math.max(5, Math.min(60, Math.round(Number(e.target.value) || projectFps))))} />
            </div>
            <label className="row check" title="Larger model: slower, steadier on fast or partly hidden moves (download pose_landmarker_heavy.task via npm run fetch-models -- --heavy)">
              <input type="checkbox" checked={heavy} disabled={running} onChange={(e) => setHeavy(e.target.checked)} /><span>Heavy model</span>
            </label>
            <div className="section-title sm">Clean-up</div>
            <Slider label="Smoothing cutoff" value={minCutoff} min={0.1} max={5} step={0.1} onChange={setMinCutoff} title="One-Euro min cutoff (Hz): lower = smoother, laggier when still" />
            <Slider label="Speed response" value={beta} min={0} max={5} step={0.1} onChange={setBeta} title="One-Euro beta: higher = follows fast moves with less lag" />
            <label className="row check"><input type="checkbox" checked={footLock} onChange={(e) => setFootLock(e.target.checked)} /><span>Foot lock (lowest foot on the floor)</span></label>
            <label className="row check"><input type="checkbox" checked={inPlace} onChange={(e) => setInPlace(e.target.checked)} /><span>In place (no travel)</span></label>
            <label className="row check" title="Selfie videos are mirrored: swap left and right"><input type="checkbox" checked={mirror} onChange={(e) => setMirror(e.target.checked)} /><span>Mirror (selfie video)</span></label>
            <div className="row">
              <span className="muted">Key every</span>
              <select value={every} onChange={(e) => setEvery(Number(e.target.value))}>
                {[1, 2, 3, 5].map((n) => <option key={n} value={n}>{n} frame{n > 1 ? 's' : ''}</option>)}
              </select>
            </div>
            <label className="row check"><input type="checkbox" checked={atPlayhead} onChange={(e) => setAtPlayhead(e.target.checked)} /><span>Start at playhead</span></label>
            <button className="btn primary wide" disabled={!file || running} onClick={analyze}>{running ? 'Analyzing...' : analysis ? 'Analyze again' : 'Analyze'}</button>
          </div>
        </div>

        {(analysis || error || result) && (
          <div className="dance-result">
            {error && <div className="note err">{error}</div>}
            {analysis && analysis.tracks.length > 0 && (
              <>
                <div className="section-title sm">People found ({analysis.tracks.length}) - choose a doll for each</div>
                {analysis.tracks.map((t) => (
                  <div key={t.id} className="row">
                    <span className="chip"><i style={{ background: t.color }} />Person {t.id}<span className="muted small mono">{(t.first / analysis.video.fps).toFixed(1)}s-{(t.last / analysis.video.fps).toFixed(1)}s</span></span>
                    <select value={assign[t.id] ?? 'none'} onChange={(e) => setAssign({ ...assign, [t.id]: e.target.value })}>
                      <option value="none">Skip</option>
                      {dolls.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                      <option value="new">Create new doll</option>
                    </select>
                  </div>
                ))}
                <div className="btn-row">
                  <button className="btn primary" disabled={!assigned} onClick={apply}>Apply as keys</button>
                </div>
              </>
            )}
            {result && <div className="note">{result}</div>}
          </div>
        )}
        {source === 'cdn' && <div className="note small dance-foot">Model loaded from CDN (jsDelivr + Google storage, pinned version) because public/mediapipe was not found. Only the model files are downloaded; your video never leaves this computer.</div>}
        <div className="muted small dance-foot">Tips: steady camera, whole body visible, bright light, clothes that contrast with the background. Pose model: MediaPipe (Apache-2.0), running locally.</div>
      </div>
    </div>
  );
}
