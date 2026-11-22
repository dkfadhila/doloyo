import { useEffect } from 'react';
import { stopPreview } from '../anim/apply';
import { AnimLibrary } from './AnimLibrary';
import { Outliner } from './Outliner';
import { useUi } from './uiStore';

/** Left sidebar: Outliner and Animation library tabs. */
export function LeftDock() {
  const tab = useUi((s) => s.leftPanel);
  const set = useUi((s) => s.setLeftPanel);
  const open = useUi((s) => s.leftOpen);
  useEffect(() => {
    if (tab !== 'anims') stopPreview();
  }, [tab]);
  return (
    <aside className={'left-dock' + (open ? ' open' : '')}>
      <div className="tabs">
        <button className={'tab' + (tab === 'outliner' ? ' on' : '')} onClick={() => set('outliner')}>Outliner</button>
        <button className={'tab' + (tab === 'anims' ? ' on' : '')} onClick={() => set('anims')}>Animations</button>
      </div>
      {tab === 'outliner' ? <Outliner /> : <AnimLibrary />}
    </aside>
  );
}
