import { useEffect, useRef, useState } from 'react';

interface Props {
  label: string;
  value: number;
  /** group is set while scrubbing so the store can merge the drag into one undo step */
  onCommit: (v: number, group?: string) => void;
  step?: number;
  min?: number;
  max?: number;
  decimals?: number;
  disabled?: boolean;
  title?: string;
}

const fmt = (v: number, d: number) => (Math.round(v * 10 ** d) / 10 ** d).toFixed(d);

export function NumberField({ label, value, onCommit, step = 1, min = -Infinity, max = Infinity, decimals = 1, disabled, title }: Props) {
  const [text, setText] = useState(fmt(value, decimals));
  const editing = useRef(false);
  const scrub = useRef<{ x: number; v: number; group: string } | null>(null);

  useEffect(() => {
    if (!editing.current) setText(fmt(value, decimals));
  }, [value, decimals]);

  const clamp = (v: number) => Math.min(max, Math.max(min, v));
  const commitText = () => {
    editing.current = false;
    const v = parseFloat(text.replace(',', '.'));
    if (!isFinite(v)) return setText(fmt(value, decimals));
    const c = clamp(v);
    setText(fmt(c, decimals));
    if (Math.abs(c - value) > 1e-9) onCommit(c);
  };

  const onDown = (e: React.PointerEvent<HTMLSpanElement>) => {
    if (disabled) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    scrub.current = { x: e.clientX, v: value, group: 'scrub-' + Date.now() + Math.random() };
  };
  const onMove = (e: React.PointerEvent<HTMLSpanElement>) => {
    const s = scrub.current;
    if (!s) return;
    const speed = e.shiftKey ? 0.1 : e.altKey ? 5 : 1;
    const v = clamp(s.v + (e.clientX - s.x) * step * 0.5 * speed);
    const r = Math.round(v * 10 ** (decimals + 1)) / 10 ** (decimals + 1);
    setText(fmt(r, decimals));
    onCommit(r, s.group);
  };
  const onUp = () => {
    scrub.current = null;
  };

  return (
    <label className={'nf' + (disabled ? ' disabled' : '')} title={title ?? 'Drag the label to scrub, or type a value'}>
      <span className="nf-label" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
        {label}
      </span>
      <input
        className="mono"
        value={text}
        disabled={disabled}
        inputMode="decimal"
        onFocus={(e) => {
          editing.current = true;
          e.currentTarget.select();
        }}
        onChange={(e) => setText(e.target.value)}
        onBlur={commitText}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') {
            editing.current = false;
            setText(fmt(value, decimals));
            (e.target as HTMLInputElement).blur();
          }
        }}
      />
    </label>
  );
}
