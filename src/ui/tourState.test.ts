import { describe, expect, it } from 'vitest';
import { isVisibleBox, placeCard, readTourState, shouldAutoStart, TOUR_KEY, TOUR_STEPS, writeTourState } from './tourState';

const memory = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
};

describe('tour state', () => {
  it('auto-starts once, then remembers done or skipped', () => {
    const s = memory();
    expect(shouldAutoStart(s)).toBe(true);
    expect(writeTourState('skipped', s)).toBe(true);
    expect(s.m.get(TOUR_KEY)).toBe('skipped');
    expect(readTourState(s)).toBe('skipped');
    expect(shouldAutoStart(s)).toBe(false);
    writeTourState('done', s);
    expect(readTourState(s)).toBe('done');
  });

  it('ignores junk values', () => {
    const s = memory();
    s.setItem(TOUR_KEY, 'maybe');
    expect(readTourState(s)).toBeNull();
    expect(shouldAutoStart(s)).toBe(true);
  });

  it('survives blocked storage (throws, or no storage at all)', () => {
    const boom = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
    };
    expect(readTourState(boom)).toBeNull();
    expect(writeTourState('done', boom)).toBe(false);
    expect(shouldAutoStart(boom)).toBe(true);
    expect(writeTourState('done', null)).toBe(false);
    expect(readTourState(null)).toBeNull();
  });
});

describe('tour steps', () => {
  it('has the 5 expected steps with unique ids and anchors', () => {
    expect(TOUR_STEPS).toHaveLength(5);
    expect(new Set(TOUR_STEPS.map((s) => s.id)).size).toBe(5);
    for (const s of TOUR_STEPS) {
      expect(s.title).toBeTruthy();
      expect(s.body.length).toBeGreaterThan(20);
      expect(s.anchor).toMatch(/^\[data-tour="[a-z]+"\]$/);
    }
  });
});

describe('tour layout', () => {
  const vw = 1200;
  const vh = 800;

  it('visibility: hidden, zero-size and off-canvas anchors do not count', () => {
    expect(isVisibleBox(null, vw, vh)).toBe(false);
    expect(isVisibleBox({ left: 10, top: 10, width: 0, height: 50 }, vw, vh)).toBe(false);
    expect(isVisibleBox({ left: -310, top: 40, width: 300, height: 500 }, vw, vh)).toBe(false); // narrow overlay panel off to the left
    expect(isVisibleBox({ left: 1210, top: 40, width: 300, height: 500 }, vw, vh)).toBe(false);
    expect(isVisibleBox({ left: 100, top: 100, width: 200, height: 100 }, vw, vh)).toBe(true);
  });

  it('centers the card when the anchor is hidden', () => {
    const p = placeCard({ left: 620, top: 40, width: 300, height: 500 }, 300, 150, 620, 800);
    expect(p.centered).toBe(true);
    expect(p.spot).toBeNull();
    expect(p.left).toBeCloseTo((620 - 300) / 2);
  });

  it('places the card below the anchor when it fits, otherwise above, and keeps it inside the window', () => {
    const below = placeCard({ left: 500, top: 10, width: 100, height: 30 }, 300, 150, vw, vh);
    expect(below.centered).toBe(false);
    expect(below.top).toBeGreaterThan(40);
    const above = placeCard({ left: 400, top: 700, width: 400, height: 90 }, 300, 150, vw, vh);
    expect(above.top + 150).toBeLessThanOrEqual(700);
    for (const p of [below, above, placeCard({ left: 1150, top: 10, width: 50, height: 30 }, 300, 150, vw, vh)]) {
      expect(p.left).toBeGreaterThanOrEqual(8);
      expect(p.left + 300).toBeLessThanOrEqual(vw - 8);
      expect(p.top).toBeGreaterThanOrEqual(8);
      expect(p.top + 150).toBeLessThanOrEqual(vh - 8);
    }
  });

  it('a full-window anchor (viewport) puts the card inside its corner and clips the spotlight', () => {
    const p = placeCard({ left: 0, top: 40, width: vw, height: 600 }, 300, 150, vw, 700);
    expect(p.centered).toBe(false);
    expect(p.spot).toEqual({ left: 0, top: 40, width: vw, height: 600 });
    expect(p.top).toBeLessThan(640);
  });
});
