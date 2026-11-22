import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { placeCard, readTourState, shouldAutoStart, TOUR_STEPS, writeTourState, type Box, type CardPlacement } from './tourState';
import { useUi } from './uiStore';

const CARD_W = 300;

/** First-run guided tour: dimmed backdrop with a spotlight on one element and a small card. Esc skips, arrows navigate. */
export function Tour() {
  const open = useUi((s) => s.tourOpen);
  const setOpen = useUi((s) => s.setTourOpen);
  const [step, setStep] = useState(0);
  const [place, setPlace] = useState<CardPlacement | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);

  // first run: open once, shortly after the app is on screen
  useEffect(() => {
    if (!shouldAutoStart()) return;
    const t = window.setTimeout(() => setOpen(true), 600);
    return () => window.clearTimeout(t);
  }, [setOpen]);

  useEffect(() => {
    if (open) setStep(0);
  }, [open]);

  const finish = useCallback(
    (state: 'done' | 'skipped') => {
      // keep an earlier "done" when the tour is reopened and skipped
      if (!(state === 'skipped' && readTourState() === 'done')) writeTourState(state);
      setOpen(false);
    },
    [setOpen],
  );

  const s = TOUR_STEPS[Math.min(step, TOUR_STEPS.length - 1)];
  const last = step >= TOUR_STEPS.length - 1;
  const next = useCallback(() => (step >= TOUR_STEPS.length - 1 ? finish('done') : setStep(step + 1)), [step, finish]);
  const back = useCallback(() => setStep((v) => Math.max(0, v - 1)), []);

  const measure = useCallback(() => {
    const el = document.querySelector(s.anchor);
    let box: Box | null = null;
    if (el) {
      const r = el.getBoundingClientRect();
      box = { left: r.left, top: r.top, width: r.width, height: r.height };
    }
    const h = cardRef.current?.offsetHeight ?? 150;
    const cw = Math.min(CARD_W, window.innerWidth - 16);
    setPlace(placeCard(box, cw, h, window.innerWidth, window.innerHeight));
  }, [s.anchor]);

  useLayoutEffect(() => {
    if (!open) return;
    measure();
    window.addEventListener('resize', measure);
    const t = window.setTimeout(measure, 60); // after fonts/layout settle
    return () => {
      window.removeEventListener('resize', measure);
      window.clearTimeout(t);
    };
  }, [open, measure, step]);

  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') finish('skipped');
      else if (e.key === 'ArrowRight' || e.key === 'Enter') next();
      else if (e.key === 'ArrowLeft') back();
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener('keydown', h, true);
    return () => window.removeEventListener('keydown', h, true);
  }, [open, finish, next, back]);

  if (!open) return null;
  const spot = place?.spot;
  return (
    <div className="tour" role="dialog" aria-label="Tour">
      {spot ? <div className="tour-spot" style={{ left: spot.left, top: spot.top, width: spot.width, height: spot.height }} /> : <div className="tour-dim" />}
      <div
        ref={cardRef}
        className="tour-card"
        style={{ left: place?.left ?? 8, top: place?.top ?? 8, width: Math.min(CARD_W, (typeof window === 'undefined' ? CARD_W : window.innerWidth) - 16), visibility: place ? 'visible' : 'hidden' }}
      >
        <div className="tour-title">
          <span>{s.title}</span>
          <span className="muted mono small">{step + 1}/{TOUR_STEPS.length}</span>
        </div>
        <div className="tour-body">{s.body}</div>
        <div className="tour-actions">
          <button className="btn" onClick={() => finish('skipped')} title="Skip (Esc)">Skip</button>
          <span className="spacer" />
          <button className="btn" disabled={step === 0} onClick={back}>Back</button>
          <button className="btn primary" onClick={next}>{last ? 'Done' : 'Next'}</button>
        </div>
      </div>
    </div>
  );
}
