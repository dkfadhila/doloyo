import { useMemo } from 'react';
import guide from '../../docs/GUIDE.md?raw';
import { Icon } from './Icons';
import { renderMarkdown } from './markdown';

export function GuideDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const html = useMemo(() => renderMarkdown(guide), []);
  if (!open) return null;
  return (
    <aside className="drawer" aria-label="Guide">
      <div className="drawer-head">
        <span className="panel-title">Guide</span>
        <button className="icon-btn" onClick={onClose} title="Close (Esc)">
          <Icon name="close" />
        </button>
      </div>
      <div className="md" dangerouslySetInnerHTML={{ __html: html }} />
    </aside>
  );
}
