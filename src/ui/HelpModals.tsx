import { useEffect } from 'react';
import { version } from '../../package.json';
import { publicUrl } from '../publicUrl';
import { Icon } from './Icons';
import { SHORTCUTS } from './shortcuts';
import { useUi } from './uiStore';

function Modal({ title, open, onClose, children }: { title: string; open: boolean; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal help-modal" role="dialog" aria-label={title}>
        <div className="drawer-head">
          <span className="panel-title">{title}</span>
          <button className="icon-btn" onClick={onClose} title="Close (Esc)">
            <Icon name="close" />
          </button>
        </div>
        <div className="modal-body help-body">{children}</div>
      </div>
    </div>
  );
}

export function ShortcutsModal() {
  const open = useUi((s) => s.shortcutsOpen);
  const set = useUi((s) => s.setShortcutsOpen);
  return (
    <Modal title="Keyboard shortcuts" open={open} onClose={() => set(false)}>
      <table className="kbd-table">
        <tbody>
          {SHORTCUTS.map((r) => (
            <tr key={r.keys}>
              <td className="mono">{r.keys}</td>
              <td>{r.action}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="muted small">Shortcuts are off while you type in a number or text field.</div>
    </Modal>
  );
}

const LICENSES: [string, string][] = [
  ['Doloyo', 'MIT'],
  ['Quaternius characters and animations', 'CC0 1.0'],
  ['MediaPipe Pose Landmarker', 'Apache-2.0'],
  ['three.js, React Three Fiber, drei, three-vrm', 'MIT'],
];

export function AboutModal() {
  const open = useUi((s) => s.aboutOpen);
  const set = useUi((s) => s.setAboutOpen);
  return (
    <Modal title="About" open={open} onClose={() => set(false)}>
      <div className="about-name">Doloyo <span className="mono muted">v{version}</span></div>
      <div>Your floppy little motion studio.</div>
      <div className="muted">Browser 3D pose and keyframe animation. Everything runs on your machine; projects, images and videos are not uploaded.</div>
      <div className="small">
        <a href="https://doloyo.vercel.app" target="_blank" rel="noreferrer">doloyo.vercel.app</a> | <a href="https://github.com/dkfadhila/doloyo" target="_blank" rel="noreferrer">github.com/dkfadhila/doloyo</a>
      </div>
      <table className="kbd-table">
        <tbody>
          {LICENSES.map(([n, l]) => (
            <tr key={n}>
              <td>{n}</td>
              <td className="mono">{l}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="small">
        Full list: <a href={publicUrl('assets/CREDITS.md')} target="_blank" rel="noreferrer">assets credits</a> (also THIRD_PARTY_NOTICES.md in the repository).
      </div>
    </Modal>
  );
}
