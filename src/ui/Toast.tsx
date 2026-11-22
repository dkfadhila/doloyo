import { useEffect } from 'react';
import { Icon } from './Icons';
import { useUi } from './uiStore';

export function Toast() {
  const msg = useUi((s) => s.notice);
  const notify = useUi((s) => s.notify);
  useEffect(() => {
    if (!msg) return;
    const t = window.setTimeout(() => notify(null), 9000);
    return () => window.clearTimeout(t);
  }, [msg, notify]);
  if (!msg) return null;
  return (
    <div className="toast" role="status">
      <span>{msg}</span>
      <button className="icon-btn" title="Dismiss" onClick={() => notify(null)}>
        <Icon name="close" />
      </button>
    </div>
  );
}
