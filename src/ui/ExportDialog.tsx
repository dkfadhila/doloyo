import { useEffect, useState } from 'react';
import { EXPORT_FORMATS, frameCount, isModelFormat, MAX_DIM, MIN_DIM, RESOLUTIONS, type ExportFormat } from '../render/plan';
import { downloadResult } from '../render/renderer';
import { ExportCancelled, runExport, useRender } from '../render/run';
import { useStore } from '../store';
import { Icon } from './Icons';
import { useUi } from './uiStore';

const FORMAT_LABEL: Record<ExportFormat, string> = {
  png: 'PNG (current frame)',
  png_seq: 'PNG sequence (.zip)',
  webm: 'WebM video',
  mp4: 'MP4 video (H.264)',
  glb: 'GLB animation (Blender, Unity, Unreal)',
  bvh: 'BVH motion (selected or first mannequin)',
  project: 'Project file (.mdoll.json)',
};

const hasWebCodecs = typeof VideoEncoder !== 'undefined' && typeof VideoFrame !== 'undefined';

export function ExportDialog() {
  const open = useUi((s) => s.exportOpen);
  const close = useUi((s) => s.setExportOpen);
  const project = useStore((s) => s.project);
  const busy = useRender((s) => s.busy);
  const done = useRender((s) => s.done);
  const total = useRender((s) => s.total);
  const [format, setFormat] = useState<ExportFormat>('webm');
  const [res, setRes] = useState('1080p');
  const [cw, setCw] = useState(1920);
  const [ch, setCh] = useState(1080);
  const [fps, setFps] = useState(project.fps);
  const [transparent, setTransparent] = useState(false);
  const [selectedOnly, setSelectedOnly] = useState(false);
  const selObj = useStore((s) => s.project.objects.find((o) => o.id === s.selection.object && o.kind !== 'camera'));
  const setAspect = useUi((s) => s.setRenderAspect);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setFps(useStore.getState().project.fps);
      setError(null);
    }
  }, [open]);
  const aspectW = res === 'custom' ? cw : RESOLUTIONS[res]?.[0] ?? 16;
  const aspectH = res === 'custom' ? ch : RESOLUTIONS[res]?.[1] ?? 9;
  useEffect(() => {
    if (aspectW > 0 && aspectH > 0) setAspect(aspectW / aspectH); // drives the camera frustum gizmo and the safe frame
  }, [aspectW, aspectH, setAspect]);
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === 'Escape' && !useRender.getState().busy && close(false);
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, close]);

  if (!open) return null;
  const video = format === 'webm' || format === 'mp4';
  const isProject = format === 'project';
  const model = isModelFormat(format);
  const [w, h] = res === 'custom' ? [cw, ch] : RESOLUTIONS[res];
  const frames = format === 'png' ? 1 : isProject ? 0 : frameCount(project, fps);
  const hasCam = project.objects.some((o) => o.kind === 'camera');
  const pct = total ? Math.round((done / total) * 100) : 0;

  const start = async () => {
    setError(null);
    try {
      const objects = model && selectedOnly && selObj ? [selObj.id] : undefined;
      const r = await runExport({ format, width: w, height: h, fps, objects, transparent: transparent && (format === 'png' || format === 'png_seq') }, `Export ${format}`);
      downloadResult(r);
      close(false);
    } catch (e) {
      if (!(e instanceof ExportCancelled)) setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && !busy && close(false)}>
      <div className="modal" role="dialog" aria-label="Export">
        <div className="drawer-head">
          <span className="panel-title">Export</span>
          <button className="icon-btn" disabled={busy} onClick={() => close(false)} title="Close (Esc)">
            <Icon name="close" />
          </button>
        </div>
        <div className="modal-body">
          <div className="row">
            <span className="muted">Format</span>
            <select value={format} disabled={busy} onChange={(e) => setFormat(e.target.value as ExportFormat)}>
              {EXPORT_FORMATS.map((f) => (
                <option key={f} value={f}>{FORMAT_LABEL[f]}</option>
              ))}
            </select>
          </div>
          {model && (
            <>
              <div className="row">
                <span className="muted">Frame rate</span>
                <input type="number" className="text-input mono fps-in" min={1} max={240} value={fps} disabled={busy} onChange={(e) => setFps(Math.round(+e.target.value))} />
              </div>
              <label className={'row check' + (selObj ? '' : ' off')}>
                <input type="checkbox" checked={selectedOnly && !!selObj} disabled={busy || !selObj} onChange={(e) => setSelectedOnly(e.target.checked)} />
                <span>Selected object only</span>
              </label>
              <div className="muted small">
                {format === 'glb'
                  ? `Baked at ${fps} fps, ${frames} frames. Dolls keep their skin or become joint nodes with meshes; ${hasCam ? 'the render camera is included (its FOV is stored at frame 0: glTF cannot animate it).' : 'add a render camera to include it.'}`
                  : `Baked at ${fps} fps, ${frames} frames, 17 joints, centimeters, Y up.`}
              </div>
            </>
          )}
          {!isProject && !model && (
            <>
              <div className="row">
                <span className="muted">Resolution</span>
                <select value={res} disabled={busy} onChange={(e) => setRes(e.target.value)}>
                  {Object.entries(RESOLUTIONS).map(([k, [rw, rh]]) => (
                    <option key={k} value={k}>{`${k} (${rw}x${rh})`}</option>
                  ))}
                  <option value="custom">Custom</option>
                </select>
              </div>
              {res === 'custom' && (
                <div className="row">
                  <span className="muted">Size</span>
                  <span className="size-in">
                    <input type="number" className="text-input mono" min={MIN_DIM} max={MAX_DIM} value={cw} disabled={busy} onChange={(e) => setCw(Math.round(+e.target.value))} />
                    <span className="muted">x</span>
                    <input type="number" className="text-input mono" min={MIN_DIM} max={MAX_DIM} value={ch} disabled={busy} onChange={(e) => setCh(Math.round(+e.target.value))} />
                  </span>
                </div>
              )}
              {format !== 'png' && (
                <div className="row">
                  <span className="muted">Frame rate</span>
                  <input type="number" className="text-input mono fps-in" min={1} max={240} value={fps} disabled={busy} onChange={(e) => setFps(Math.round(+e.target.value))} />
                </div>
              )}
              <div className="row">
                <span className="muted">Range</span>
                <span className="mono small">{format === 'png' ? `frame ${Math.round(project.time * project.fps)}` : `whole duration, ${project.duration}s, ${frames} frames`}</span>
              </div>
              <label className={'row check' + (format === 'png' || format === 'png_seq' ? '' : ' off')}>
                <input type="checkbox" checked={transparent && (format === 'png' || format === 'png_seq')} disabled={busy || !(format === 'png' || format === 'png_seq')} onChange={(e) => setTransparent(e.target.checked)} />
                <span>Transparent background (PNG only)</span>
              </label>
            </>
          )}
          {video && !hasWebCodecs && <div className="note err">This browser has no WebCodecs, so video export is unavailable. Use PNG sequence and assemble it with ffmpeg.</div>}
          {video && hasWebCodecs && <div className="muted small">Encoded locally with WebCodecs. If your browser lacks the codec you will get a message and can fall back to PNG sequence.</div>}
          {error && <div className="note err">{error}</div>}
          {busy && (
            <div className="progress-wrap">
              <div className="progress"><div className="bar" style={{ width: pct + '%' }} /></div>
              <div className="row"><span className="mono small">{done} / {total || '...'} frames</span><span className="mono small">{pct}%</span></div>
            </div>
          )}
          <div className="btn-row">
            {busy ? (
              <button className="btn" onClick={() => useRender.getState().cancel()}>Cancel</button>
            ) : (
              <button className="btn primary" disabled={video && !hasWebCodecs} onClick={start}>Export</button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
