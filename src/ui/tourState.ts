// First-run tour: step data, persisted state and layout math. Pure (no React) so it can be unit tested.

export const TOUR_KEY = 'mds.tour.v1';
export type TourState = 'done' | 'skipped';

export interface TourStep {
  id: string;
  title: string;
  body: string;
  /** CSS selector of the element to highlight; when it is missing or hidden (narrow overlay panels) the card is centered. */
  anchor: string;
}

export const TOUR_STEPS: TourStep[] = [
  { id: 'viewport', title: 'Viewport', anchor: '[data-tour="viewport"]', body: 'Click a joint to select it, then drag the ring to rotate it (R). Right-drag orbits, middle-drag pans, scroll zooms. G moves, I toggles IK handles on wrists and ankles.' },
  { id: 'inspector', title: 'Inspector', anchor: '[data-tour="inspector"]', body: 'Exact joint angles, hips offset, character and material, IK pole angle and the pose library for the selected object. On a narrow window it opens from the top bar.' },
  { id: 'timeline', title: 'Timeline and keys', anchor: '[data-tour="timeline"]', body: 'Move the playhead, pose the doll, press K to set a key. Space plays. Drag keys to retime them, pick an easing per key, or switch to Curves for bezier handles.' },
  { id: 'library', title: 'Animations and Copy Dance', anchor: '[data-tour="dance"]', body: 'The Animations tab (left) holds 86 ready clips you can apply in one undo step. Copy Dance turns a video of a person into keys using a pose model that runs locally.' },
  { id: 'export', title: 'Export and agent', anchor: '[data-tour="export"]', body: 'Export PNG, PNG sequence, WebM, MP4, GLB or BVH. The Agent pill connects Claude or another MCP client to this tab. Reopen this tour any time from Help > Tour.' },
];

type Store = Pick<Storage, 'getItem' | 'setItem'>;
const defaultStore = (): Store | null => {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null; // storage blocked (private mode, sandboxed iframe)
  }
};

export function readTourState(store: Store | null = defaultStore()): TourState | null {
  try {
    const v = store?.getItem(TOUR_KEY);
    return v === 'done' || v === 'skipped' ? v : null;
  } catch {
    return null;
  }
}

export function writeTourState(state: TourState, store: Store | null = defaultStore()): boolean {
  try {
    if (!store) return false;
    store.setItem(TOUR_KEY, state);
    return true;
  } catch {
    return false;
  }
}

/** The tour opens by itself only until it was finished or skipped once. */
export const shouldAutoStart = (store: Store | null = defaultStore()) => readTourState(store) === null;

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** An anchor counts as visible when it has area and intersects the window (off-canvas overlay panels do not). */
export function isVisibleBox(b: Box | null, vw: number, vh: number): boolean {
  if (!b || b.width < 4 || b.height < 4) return false;
  return b.left + b.width > 0 && b.top + b.height > 0 && b.left < vw && b.top < vh;
}

export interface CardPlacement {
  left: number;
  top: number;
  centered: boolean;
  /** Spotlight rectangle (clipped to the window) or null when the card is centered. */
  spot: Box | null;
}

/** Place a card of size (cw, ch) next to the anchor: below, above, right, left, else inside the anchor's corner. */
export function placeCard(anchor: Box | null, cw: number, ch: number, vw: number, vh: number, gap = 10, margin = 8): CardPlacement {
  const clampX = (x: number) => Math.max(margin, Math.min(vw - cw - margin, x));
  const clampY = (y: number) => Math.max(margin, Math.min(vh - ch - margin, y));
  if (!isVisibleBox(anchor, vw, vh)) return { left: clampX((vw - cw) / 2), top: clampY((vh - ch) / 2), centered: true, spot: null };
  const a = anchor as Box;
  const x0 = Math.max(0, a.left), y0 = Math.max(0, a.top);
  const spot: Box = { left: x0, top: y0, width: Math.min(vw, a.left + a.width) - x0, height: Math.min(vh, a.top + a.height) - y0 };
  const cx = a.left + a.width / 2 - cw / 2;
  const cy = a.top + a.height / 2 - ch / 2;
  if (spot.top + spot.height + gap + ch + margin <= vh) return { left: clampX(cx), top: spot.top + spot.height + gap, centered: false, spot };
  if (spot.top - gap - ch >= margin) return { left: clampX(cx), top: spot.top - gap - ch, centered: false, spot };
  if (spot.left + spot.width + gap + cw + margin <= vw) return { left: spot.left + spot.width + gap, top: clampY(cy), centered: false, spot };
  if (spot.left - gap - cw >= margin) return { left: spot.left - gap - cw, top: clampY(cy), centered: false, spot };
  // anchor fills the window (e.g. the viewport): card sits in its bottom-left corner
  return { left: clampX(spot.left + 12), top: clampY(spot.top + spot.height - ch - 12), centered: false, spot };
}
