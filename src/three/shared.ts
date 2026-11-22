import { Color, type PerspectiveCamera, type Scene, type WebGLRenderer } from 'three';
import type { JointName, Pose, Project, Vec3 } from '../core/types';
import { useStore } from '../store';

/** Mutable interaction flags shared between gizmo and object views (no React state needed). */
export const drag: { active: boolean; lastEnd: number; controls: { axis: string | null } | null } = {
  active: false,
  lastEnd: 0,
  controls: null,
};

export const BODY = new Color('#CFCFD2');
export const ACCENT = new Color('#3B6FE0');
export const OBJECT_TINT = new Color('#CFCFD2').lerp(new Color('#3B6FE0'), 0.4);
export const D2R = Math.PI / 180;

export interface SnapshotOptions {
  width: number;
  height: number;
  transparent: boolean;
}
let impl: ((o: SnapshotOptions) => string) | null = null;
export function registerSnapshot(fn: ((o: SnapshotOptions) => string) | null) {
  impl = fn;
}
export function takeSnapshot(o: SnapshotOptions): string {
  if (!impl) throw new Error('Viewport not ready');
  return impl(o);
}

// ---- live scene state (lets the renderer drive the scene deterministically) ----

export interface LiveState {
  project: Project;
  selected: string | null;
  joint: JointName | null;
}
/** While set, every object view shows this state instead of the store (used by export). */
export const live: { override: LiveState | null } = { override: null };

export function getLive(): LiveState {
  if (live.override) return live.override;
  const s = useStore.getState();
  return { project: s.project, selected: s.selection.object, joint: s.selection.joint };
}

const appliers = new Set<(l: LiveState) => void>();
export function registerApplier(fn: (l: LiveState) => void): () => void {
  appliers.add(fn);
  return () => {
    appliers.delete(fn);
  };
}
/** Synchronously push a live state into all object views. */
export function applyAll(l: LiveState = getLive()): void {
  appliers.forEach((f) => f(l));
}

// ---- render context (registered by the viewport) ----

export interface RenderContext {
  gl: WebGLRenderer;
  scene: Scene;
  camera: PerspectiveCamera;
}
let ctx: RenderContext | null = null;
export function registerRenderContext(c: RenderContext | null) {
  ctx = c;
}
export function getRenderContext(): RenderContext {
  if (!ctx) throw new Error('Viewport not ready');
  return ctx;
}

// ---- animation preview (hover/click in the library plays a clip on one object without committing) ----

export interface PreviewPose {
  object: string;
  pose: Pose;
  hipsPos: Vec3;
}
export const preview: { current: PreviewPose | null } = { current: null };

// ---- editor view (registered by the viewport; used by "Set camera from view") ----

export interface ViewState {
  position: Vec3;
  target: Vec3;
  fov: number;
}
export const viewApi: { get: (() => ViewState) | null } = { get: null };
