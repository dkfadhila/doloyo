import { describe, expect, it } from 'vitest';
import { checkSize, evenSize, extFor, frameCount, frameTime, safeName, videoBitrate } from './plan';

describe('render plan', () => {
  it('frame count includes the last frame unless looping', () => {
    expect(frameCount({ fps: 24, duration: 2, loop: false })).toBe(49);
    expect(frameCount({ fps: 24, duration: 2, loop: true })).toBe(48);
    expect(frameCount({ fps: 30, duration: 2, loop: false }, 60)).toBe(121);
    expect(frameCount({ fps: 30, duration: 0.01, loop: true })).toBe(1);
  });
  it('frame time is i/fps clamped to the duration', () => {
    expect(frameTime(12, 24, 2)).toBe(0.5);
    expect(frameTime(100, 24, 2)).toBe(2);
  });
  it('validates and evens sizes', () => {
    expect(() => checkSize(1920, 1080)).not.toThrow();
    expect(() => checkSize(0, 1080)).toThrow();
    expect(() => checkSize(1920.5, 1080)).toThrow();
    expect(() => checkSize(9000, 100)).toThrow();
    expect(evenSize(1281, 721)).toEqual([1280, 720]);
  });
  it('bitrate is about 8 Mbps at 1080p30 and scales', () => {
    expect(videoBitrate(1920, 1080, 30)).toBe(8_000_000);
    expect(videoBitrate(3840, 2160, 30)).toBe(32_000_000);
    expect(videoBitrate(64, 64, 30)).toBe(2_000_000);
  });
  it('names and extensions', () => {
    expect(extFor('png_seq')).toBe('zip');
    expect(safeName('My clip / v2')).toBe('My_clip_v2');
    expect(safeName('')).toBe('motion-doll');
  });
});
