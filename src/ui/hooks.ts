import { useEffect } from 'react';
import { LIMB_JOINTS } from '../core/ik';
import { LIMBS } from '../core/types';
import { requestSave } from './ImageUi';
import { selectedObject, useStore } from '../store';
import { FRAME_ALL_EVENT, graphState } from './CurveEditor';
import { copySelectedKeys, pasteKeys } from './keyActions';
import { useUi } from './uiStore';

/** rAF driver for playback. */
export function usePlayback() {
  const playing = useStore((s) => s.playing);
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    const loop = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      useStore.getState().tick(dt);
      if (useStore.getState().playing) raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [playing]);
}

export function useShortcuts(toggleGuide: (v?: boolean) => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && t.closest('input, textarea, select, [contenteditable="true"]')) return;
      const st = useStore.getState();
      const ctrl = e.ctrlKey || e.metaKey;
      const key = e.key.toLowerCase();

      if (ctrl) {
        if (key === 'z') {
          e.preventDefault();
          if (e.shiftKey) st.redo();
          else st.undo();
        } else if (key === 'y') {
          e.preventDefault();
          st.redo();
        } else if (key === 's') {
          e.preventDefault();
          requestSave();
        } else if (key === 'c' && (st.keySet.length || st.selection.key)) {
          e.preventDefault();
          copySelectedKeys();
        } else if (key === 'v' && st.clipboard) {
          e.preventDefault();
          pasteKeys();
        }
        return;
      }
      if (e.altKey) return;
      if (t && t.tagName === 'BUTTON') t.blur();

      const fps = st.project.fps;
      const obj = selectedObject(st);
      switch (e.key === '?' ? '?' : key) {
        case ' ':
          e.preventDefault();
          st.togglePlay();
          break;
        case 'k':
          if (obj) st.dispatch({ type: 'key_add', object: obj.id });
          break;
        case 'r':
          st.setMode('rotate');
          break;
        case 'g':
          st.setMode('translate');
          break;
        case 's':
          st.setMode('scale');
          break;
        case 'm':
          if (obj?.kind === 'mannequin') st.dispatch({ type: 'pose_mirror', object: obj.id, from: e.shiftKey ? 'R' : 'L' });
          break;
        case ',':
          st.pause();
          st.dispatch({ type: 'playhead_seek', time: st.project.time - 1 / fps });
          break;
        case '.':
          st.pause();
          st.dispatch({ type: 'playhead_seek', time: st.project.time + 1 / fps });
          break;
        case 'o':
          st.setOnion({ on: !st.onion.on });
          break;
        case 'f':
          if (graphState.hover && useUi.getState().timelineView === 'curves') window.dispatchEvent(new Event(FRAME_ALL_EVENT));
          else st.requestFocus();
          break;
        case 'i': {
          const on = !st.ikOn;
          st.setIkOn(on);
          const j = st.selection.joint;
          if (on && obj?.kind === 'mannequin' && j) {
            const limb = LIMBS.find((l) => LIMB_JOINTS[l].includes(j));
            if (limb) st.setIkLimb(limb);
          }
          break;
        }
        case 'c':
          if (st.project.objects.some((o) => o.kind === 'camera')) st.setLookThrough(!st.lookThrough);
          else useUi.getState().notify('No render camera yet. Add one from the outliner (+ > Render Camera).');
          break;
        case 'delete':
        case 'backspace': {
          const k = st.selection.key;
          if (st.keySet.length > 1) st.dispatch({ type: 'keys_remove', keys: st.keySet.map((x) => ({ object: x.object, target: x.target, time: x.time })) });
          else if (k) st.dispatch({ type: 'key_remove', object: k.object, target: k.target, time: k.time });
          else if (obj && !st.selection.joint) st.dispatch({ type: 'object_remove', object: obj.id });
          st.selectKey(null);
          break;
        }
        case 'escape':
          toggleGuide(false);
          st.selectKey(null);
          st.select(null);
          break;
        case '?':
          toggleGuide();
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggleGuide]);
}
