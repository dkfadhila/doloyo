import { useEffect, useRef, useState } from 'react';
import { newProject } from '../core/commands';
import { EXAMPLES, fetchExample } from '../examples';
import { missingCharactersNotice } from '../characters/store';
import { downloadDataUrl, exportProject, importProjectFile } from '../persist';
import { useStore } from '../store';
import { takeSnapshot } from '../three/shared';
import { useRender } from '../render/run';
import { AgentPill } from './AgentPanel';
import { Icon } from './Icons';
import { Pop } from './Popover';
import { useUi } from './uiStore';

interface Item {
  label: string;
  hint?: string;
  onClick?: () => void;
  disabled?: boolean;
  sep?: boolean;
}

function Menu({ label, items }: { label: string; items: Item[] }) {
  const [open, setOpen] = useState(false);
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
      <button className={'menu-btn' + (open ? ' on' : '')} onClick={() => setOpen(!open)}>
        {label}
      </button>
      {open && (
        <Pop className="menu-pop">
          {items.map((it, i) =>
            it.sep ? (
              <div key={i} className="menu-sep" />
            ) : (
              <button
                key={i}
                className="menu-item"
                disabled={it.disabled}
                onClick={() => {
                  setOpen(false);
                  it.onClick?.();
                }}
              >
                <span>{it.label}</span>
                <span className="muted mono">{it.hint}</span>
              </button>
            ),
          )}
        </Pop>
      )}
    </div>
  );
}

const SIZES: Record<string, [number, number]> = { '720p': [1280, 720], '1080p': [1920, 1080], '4K': [3840, 2160] };

function RenderProgress() {
  const busy = useRender((s) => s.busy);
  const exportOpen = useUi((s) => s.exportOpen);
  const done = useRender((s) => s.done);
  const total = useRender((s) => s.total);
  const label = useRender((s) => s.label);
  if (!busy || exportOpen) return null;
  return (
    <span className="render-prog mono small" title={label}>
      <span className="ellipsis">{label}</span>
      <span>{done}/{total || '...'}</span>
      <button className="btn" onClick={() => useRender.getState().cancel()}>Cancel</button>
    </span>
  );
}

export function TopBar({ onGuide }: { onGuide: () => void }) {
  const undoCount = useStore((s) => s.undoStack.length);
  const redoCount = useStore((s) => s.redoStack.length);
  const [snapOpen, setSnapOpen] = useState(false);
  const [size, setSize] = useState('1080p');
  const [transparent, setTransparent] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const charRef = useRef<HTMLInputElement>(null);
  const snapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!snapOpen) return;
    const h = (e: PointerEvent) => {
      if (!snapRef.current?.contains(e.target as Node)) setSnapOpen(false);
    };
    document.addEventListener('pointerdown', h);
    return () => document.removeEventListener('pointerdown', h);
  }, [snapOpen]);

  const st = useStore;
  const doNew = () => {
    if (window.confirm('Start a new project? The current one is replaced (autosave keeps only the latest).')) st.getState().setProject(newProject());
  };
  const loadExample = async (id: string) => {
    if (!window.confirm('Load this example? The current project is replaced (autosave keeps only the latest).')) return;
    try {
      st.getState().setProject(await fetchExample(id));
    } catch (e) {
      useUi.getState().notify('Could not load the example: ' + (e instanceof Error ? e.message : String(e)));
    }
  };
  const doSave = () => exportProject(st.getState().project);
  const onOpen = async (f: File | undefined) => {
    if (!f) return;
    try {
      const p = await importProjectFile(f);
      st.getState().setProject(p);
      useUi.getState().notify(missingCharactersNotice(p.objects));
    } catch (e) {
      window.alert('Could not open file: ' + (e instanceof Error ? e.message : String(e)));
    }
  };
  const doSnapshot = () => {
    try {
      const [w, h] = SIZES[size];
      const p = st.getState().project;
      const url = takeSnapshot({ width: w, height: h, transparent });
      downloadDataUrl(url, `${p.name || 'snapshot'}_f${Math.round(p.time * p.fps)}_${size}.png`.replace(/\s+/g, '_'));
      setSnapOpen(false);
    } catch (e) {
      window.alert('Snapshot failed: ' + (e instanceof Error ? e.message : String(e)));
    }
  };

  return (
    <header className="topbar">
      <button className="icon-btn narrow-only" title="Outliner and animations" onClick={() => useUi.getState().setLeftOpen(!useUi.getState().leftOpen)}>
        <Icon name="sidebar" />
      </button>
      <div className="brand">
        <Icon name="logo" size={18} />
        <span className="label">Motion Doll</span>
      </div>
      <Menu
        label="File"
        items={[
          { label: 'New', onClick: doNew },
          { label: 'Open .mdoll.json...', onClick: () => fileRef.current?.click() },
          { label: 'Save .mdoll.json', hint: 'Ctrl+S', onClick: doSave },
          { label: '', sep: true },
          { label: 'Import character...', hint: '.glb .vrm', onClick: () => charRef.current?.click() },
          { label: 'Copy Dance (video to animation)...', onClick: () => useUi.getState().setDanceOpen(true) },
          { label: '', sep: true },
          { label: 'Snapshot PNG...', onClick: () => setSnapOpen(true) },
          { label: 'Export...', onClick: () => useUi.getState().setExportOpen(true) },
        ]}
      />
      <Menu
        label="Edit"
        items={[
          { label: 'Undo', hint: 'Ctrl+Z', disabled: !undoCount, onClick: () => st.getState().undo() },
          { label: 'Redo', hint: 'Ctrl+Shift+Z', disabled: !redoCount, onClick: () => st.getState().redo() },
        ]}
      />
      <Menu
        label="Help"
        items={[
          { label: 'Guide', hint: '?', onClick: onGuide },
          { label: 'Tour', onClick: () => useUi.getState().setTourOpen(true) },
          { label: 'Keyboard shortcuts', onClick: () => useUi.getState().setShortcutsOpen(true) },
          { label: '', sep: true },
          ...EXAMPLES.map((ex) => ({ label: 'Example: ' + ex.name, onClick: () => loadExample(ex.id) })),
          { label: '', sep: true },
          { label: 'About', onClick: () => useUi.getState().setAboutOpen(true) },
        ]}
      />
      <input ref={charRef} type="file" accept=".glb,.gltf,.vrm" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) useUi.getState().setImportFile(f); e.target.value = ''; }} />
      <input ref={fileRef} type="file" accept=".json,.mdoll.json,application/json" hidden onChange={(e) => { onOpen(e.target.files?.[0]); e.target.value = ''; }} />

      <div className="spacer" />

      <button className="icon-btn" title="Undo (Ctrl+Z)" disabled={!undoCount} onClick={() => st.getState().undo()}>
        <Icon name="undo" />
      </button>
      <button className="icon-btn" title="Redo (Ctrl+Shift+Z)" disabled={!redoCount} onClick={() => st.getState().redo()}>
        <Icon name="redo" />
      </button>
      <RenderProgress />
      <div className="snap" ref={snapRef}>
        <button className={'btn' + (snapOpen ? ' on' : '')} title="Snapshot PNG" onClick={() => setSnapOpen(!snapOpen)}>
          <Icon name="camera" />
          <span className="label">Snapshot</span>
        </button>
        {snapOpen && (
          <Pop className="pop">
            <div className="row">
              <span className="muted">Size</span>
              <select value={size} onChange={(e) => setSize(e.target.value)}>
                {Object.entries(SIZES).map(([k, [w, h]]) => (
                  <option key={k} value={k}>{`${k} (${w}x${h})`}</option>
                ))}
              </select>
            </div>
            <label className="row check">
              <input type="checkbox" checked={transparent} onChange={(e) => setTransparent(e.target.checked)} />
              <span>Transparent background</span>
            </label>
            <button className="btn primary wide" onClick={doSnapshot}>Download PNG</button>
          </Pop>
        )}
      </div>
      <button className="btn" data-tour="export" title="Export video, PNG sequence or project" onClick={() => useUi.getState().setExportOpen(true)}>
        <Icon name="film" />
        <span className="label">Export</span>
      </button>
      <button className="btn" data-tour="dance" title="Copy Dance: video to animation" onClick={() => useUi.getState().setDanceOpen(true)}>
        <Icon name="dance" />
        <span className="label">Copy Dance</span>
      </button>
      <button className="icon-btn" title="Guide (?)" onClick={onGuide}>
        <Icon name="help" />
      </button>
      <AgentPill />
      <button className="icon-btn narrow-only" title="Inspector" onClick={() => useUi.getState().setRightOpen(!useUi.getState().rightOpen)}>
        <Icon name="sidebarR" />
      </button>
    </header>
  );
}
