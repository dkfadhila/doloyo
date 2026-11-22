import { copyKeys } from '../core/commands';
import { useStore } from '../store';
import { viewApi } from '../three/shared';
import { useUi } from './uiStore';

const fail = (m: string) => {
  useUi.getState().notify(m);
  return false;
};

/** Ctrl+C: copy the selected keys (all of them when several are selected). */
export function copySelectedKeys(): boolean {
  const st = useStore.getState();
  const refs = st.keySet.length ? st.keySet : st.selection.key ? [st.selection.key] : [];
  if (!refs.length) return fail('Select one or more keys first (click a key, or drag a box around keys).');
  try {
    const c = copyKeys(st.project, refs.map((k) => ({ object: k.object, target: k.target, time: k.time })));
    st.setClipboard(c);
    return true;
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e));
  }
}

/** Ctrl+V: paste the copied keys at the playhead on the selected object (same kind of object as the source). */
export function pasteKeys(): boolean {
  const st = useStore.getState();
  const cb = st.clipboard;
  if (!cb) return fail('Nothing copied. Select keys and press Ctrl+C first.');
  const obj = st.project.objects.find((o) => o.id === st.selection.object);
  if (!obj) return fail('Select the object to paste onto.');
  const res = st.dispatch({ type: 'keys_paste', object: obj.id, time: st.project.time, kind: cb.kind, clip: cb.clip });
  if (!res.ok) return fail(res.error ?? 'Paste failed');
  const p = useStore.getState().project;
  const o = p.objects.find((x) => x.id === obj.id);
  if (o) {
    const sel = cb.clip
      .filter((c) => o.tracks[c.channel])
      .map((c) => ({ object: o.id, target: c.channel, time: Math.round((p.time + c.dt) * p.fps) / p.fps }));
    useStore.getState().selectKeys(sel);
  }
  return true;
}

/** Add the render camera at the current editor view (one undo step). */
export function addCameraFromView(): void {
  const st = useStore.getState();
  if (st.project.objects.some((o) => o.kind === 'camera')) {
    useUi.getState().notify('There is already a render camera.');
    return;
  }
  const v = viewApi.get?.();
  st.dispatch(v ? { type: 'camera_set', position: v.position, target: v.target, fov: v.fov } : { type: 'object_add', kind: 'camera' });
}

/** Copy the current editor view into the render camera (optionally keying it). */
export function setCameraFromView(id: string, key: boolean): void {
  const st = useStore.getState();
  const v = viewApi.get?.();
  if (!v) return void useUi.getState().notify('Viewport not ready');
  const cmd = { type: 'camera_set' as const, object: id, position: v.position, target: v.target, fov: v.fov };
  st.dispatch(key ? { type: 'batch', commands: [cmd, { type: 'key_add', object: id, target: ['position', 'target', 'fov'] }] } : cmd, { noAutoKey: true });
}
