import { useCallback, useEffect, useRef, useState } from 'react';
import { Scene } from './three/Scene';
import { ExportDialog } from './ui/ExportDialog';
import { GuideDrawer } from './ui/GuideDrawer';
import { AboutModal, ShortcutsModal } from './ui/HelpModals';
import { Tour } from './ui/Tour';
import { usePlayback, useShortcuts } from './ui/hooks';
import { Inspector } from './ui/Inspector';
import { LeftDock } from './ui/LeftDock';
import { ImportDialog } from './ui/ImportDialog';
import { CopyDance } from './ui/CopyDance';
import { Toast } from './ui/Toast';
import { useUi } from './ui/uiStore';
import { Timeline } from './ui/Timeline';
import { TopBar } from './ui/TopBar';
import { useStore, type Mode } from './store';

const MODES: { id: Mode; label: string; hint: string }[] = [
  { id: 'rotate', label: 'Rotate', hint: 'R' },
  { id: 'translate', label: 'Move', hint: 'G' },
  { id: 'scale', label: 'Scale', hint: 'S' },
];

function ModeBar() {
  const mode = useStore((s) => s.mode);
  const setMode = useStore((s) => s.setMode);
  const ikOn = useStore((s) => s.ikOn);
  const through = useStore((s) => s.lookThrough);
  const hasCam = useStore((s) => s.project.objects.some((o) => o.kind === 'camera'));
  return (
    <div className="modebar">
      {MODES.map((m) => (
        <button key={m.id} className={'btn' + (mode === m.id ? ' on' : '')} title={`${m.label} (${m.hint})`} onClick={() => setMode(m.id)}>
          {m.label} <span className="muted mono">{m.hint}</span>
        </button>
      ))}
      <button className={'btn' + (ikOn ? ' on' : '')} title="IK handles on the wrists and ankles of the selected mannequin: drag a handle to pose the limb (I)" onClick={() => useStore.getState().setIkOn(!ikOn)}>
        IK <span className="muted mono">I</span>
      </button>
      <button
        className={'btn' + (through ? ' on' : '')}
        title={hasCam ? 'Look through the render camera (C)' : 'Add a render camera first (Outliner +)'}
        onClick={() => (hasCam ? useStore.getState().setLookThrough(!through) : useUi.getState().notify('No render camera yet. Add one from the outliner (+ > Render Camera).'))}
      >
        Cam <span className="muted mono">C</span>
      </button>
    </div>
  );
}

/** Dimmed outside + inner action-safe rectangle while looking through the render camera (export aspect). */
function SafeFrame() {
  const through = useStore((s) => s.lookThrough && s.project.objects.some((o) => o.kind === 'camera'));
  const aspect = useUi((s) => s.renderAspect);
  const ref = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current?.parentElement;
    if (!el) return;
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setBox({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);
  const view = box.w / Math.max(1, box.h);
  const fw = view >= aspect ? box.h * aspect : box.w;
  const fh = view >= aspect ? box.h : box.w / aspect;
  return (
    <div ref={ref} className="safe-wrap" style={{ display: through ? 'flex' : 'none' }}>
      <div className="safe-frame" style={{ width: fw, height: fh }}>
        <div className="safe-inner" />
        <span className="safe-label mono small">Render camera {aspect.toFixed(2)}:1</span>
      </div>
    </div>
  );
}

export default function App() {
  const [guide, setGuide] = useState(false);
  const toggleGuide = useCallback((v?: boolean) => setGuide((g) => (v === undefined ? !g : v)), []);
  const leftOpen = useUi((s) => s.leftOpen);
  const rightOpen = useUi((s) => s.rightOpen);
  const curves = useUi((s) => s.timelineView === 'curves');
  usePlayback();
  useShortcuts(toggleGuide);

  return (
    <div className={'app' + (curves ? ' curves-view' : '')}>
      <TopBar onGuide={() => toggleGuide()} />
      <LeftDock />
      <div className={'scrim' + (leftOpen || rightOpen ? ' on' : '')} onClick={() => { useUi.getState().setLeftOpen(false); useUi.getState().setRightOpen(false); }} />
      <main className="viewport" data-tour="viewport">
        <Scene />
        <SafeFrame />
        <ModeBar />
      </main>
      <Inspector open={rightOpen} />
      <Timeline />
      <ExportDialog />
      <ImportDialog />
      <CopyDance />
      <ShortcutsModal />
      <AboutModal />
      <Tour />
      <Toast />
      <GuideDrawer open={guide} onClose={() => toggleGuide(false)} />
    </div>
  );
}
