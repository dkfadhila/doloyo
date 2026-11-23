/** Pure helpers for the exporter (no DOM / three imports so they are unit-testable). */

export type ExportFormat = 'png' | 'png_seq' | 'webm' | 'mp4' | 'glb' | 'bvh' | 'project';
export const EXPORT_FORMATS: ExportFormat[] = ['png', 'png_seq', 'webm', 'mp4', 'glb', 'bvh', 'project'];
/** Formats that are not rendered pixels (no resolution / WebGL needed). */
export const isModelFormat = (f: ExportFormat) => f === 'glb' || f === 'bvh';

export const RESOLUTIONS: Record<string, [number, number]> = { '720p': [1280, 720], '1080p': [1920, 1080], '4K': [3840, 2160] };
export const MAX_DIM = 7680;
export const MIN_DIM = 16;

export interface FrameSpec {
  fps: number;
  duration: number;
  loop: boolean;
}

/** Number of frames for the whole duration. Non-looping clips include the final frame so the last key is visible. */
export function frameCount(p: FrameSpec, fps: number = p.fps): number {
  const n = Math.round(p.duration * fps);
  return Math.max(1, p.loop ? n : n + 1);
}

/** Time in seconds of frame i (deterministic: i / fps), clamped to the duration. */
export function frameTime(i: number, fps: number, duration: number): number {
  return Math.min(duration, i / fps);
}

export function checkSize(w: number, h: number): void {
  for (const n of [w, h]) {
    if (!Number.isInteger(n) || n < MIN_DIM || n > MAX_DIM) throw new Error(`Size must be integers between ${MIN_DIM} and ${MAX_DIM} (got ${w}x${h})`);
  }
}

/** Video codecs need even dimensions. */
export function evenSize(w: number, h: number): [number, number] {
  return [w - (w % 2), h - (h % 2)];
}

/** About 8 Mbps at 1080p30, scaled by pixel count and fps, clamped. */
export function videoBitrate(w: number, h: number, fps: number): number {
  const base = 8_000_000 * ((w * h) / (1920 * 1080)) * Math.max(0.5, Math.min(2, fps / 30));
  return Math.round(Math.max(2_000_000, Math.min(60_000_000, base)));
}

export function extFor(format: ExportFormat): string {
  return { png: 'png', png_seq: 'zip', webm: 'webm', mp4: 'mp4', glb: 'glb', bvh: 'bvh', project: 'mdoll.json' }[format];
}
export function mimeFor(format: ExportFormat): string {
  return { png: 'image/png', png_seq: 'application/zip', webm: 'video/webm', mp4: 'video/mp4', glb: 'model/gltf-binary', bvh: 'text/plain', project: 'application/json' }[format];
}

export function safeName(name: string): string {
  return (name || 'doloyo').replace(/[^\w\-]+/g, '_').replace(/^_+|_+$/g, '') || 'doloyo';
}
