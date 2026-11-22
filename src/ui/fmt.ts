export function fmtTime(t: number): string {
  const total = Math.max(0, t);
  const m = Math.floor(total / 60);
  const s = Math.floor(total % 60);
  const cs = Math.floor((total - Math.floor(total)) * 100 + 1e-6);
  const p = (n: number, l = 2) => String(n).padStart(l, '0');
  return `${p(m)}:${p(s)}.${p(cs)}`;
}
