import { describe, expect, it } from 'vitest';
import { getCompat } from './legacy';

const mem = (init: Record<string, string> = {}) => {
  const m = new Map(Object.entries(init));
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
};

describe('storage keys of the former name', () => {
  it('reads the new key first', () => {
    const s = mem({ 'doloyo.agent.mode': 'render', 'motion-doll.agent.mode': 'read' });
    expect(getCompat(s, 'doloyo.agent.mode', 'motion-doll.agent.mode')).toBe('render');
  });
  it('falls back to the old key and copies it to the new one', () => {
    const s = mem({ 'motion-doll.agent.mode': 'read' });
    expect(getCompat(s, 'doloyo.agent.mode', 'motion-doll.agent.mode')).toBe('read');
    expect(s.m.get('doloyo.agent.mode')).toBe('read');
    expect(s.m.get('motion-doll.agent.mode')).toBe('read'); // never deleted
  });
  it('is null when neither exists or storage is unavailable', () => {
    expect(getCompat(mem(), 'a', 'b')).toBeNull();
    expect(getCompat(null, 'a', 'b')).toBeNull();
    expect(getCompat({ getItem: () => { throw new Error('blocked'); }, setItem: () => {} }, 'a', 'b')).toBeNull();
  });
});
