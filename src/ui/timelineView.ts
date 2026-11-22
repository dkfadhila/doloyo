import { create } from 'zustand';
import { useStore } from '../store';

export const MAX_ZOOM = 60;

interface TlView {
  zoom: number;
  start: number;
  set: (zoom: number, start: number) => void;
}
export const useTlView = create<TlView>((set) => ({ zoom: 1, start: 0, set: (zoom, start) => set({ zoom, start }) }));

export interface ViewWindow {
  start: number;
  span: number;
  duration: number;
}

/** Visible time window of the keys timeline (zoom 1 = whole duration). */
export function useViewWindow(): ViewWindow {
  const duration = useStore((s) => s.project.duration);
  const zoom = useTlView((s) => s.zoom);
  const start = useTlView((s) => s.start);
  return clampWindow(zoom, start, duration);
}

export function clampWindow(zoom: number, start: number, duration: number): ViewWindow {
  const z = Math.min(MAX_ZOOM, Math.max(1, zoom));
  const span = duration / z;
  return { start: Math.min(Math.max(0, duration - span), Math.max(0, start)), span, duration };
}

/** Zoom around a time (keeps the time under the cursor in place). */
export function zoomAt(factor: number, t: number): void {
  const duration = useStore.getState().project.duration;
  const v = useTlView.getState();
  const cur = clampWindow(v.zoom, v.start, duration);
  const z = Math.min(MAX_ZOOM, Math.max(1, v.zoom * factor));
  const span = duration / z;
  const u = cur.span > 0 ? (t - cur.start) / cur.span : 0;
  const w = clampWindow(z, t - u * span, duration);
  v.set(z, w.start);
}

export function panBy(dt: number): void {
  const duration = useStore.getState().project.duration;
  const v = useTlView.getState();
  const w = clampWindow(v.zoom, v.start + dt, duration);
  v.set(v.zoom, w.start);
}
