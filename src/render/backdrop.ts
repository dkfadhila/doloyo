import type { ImageBackdrop, ImageFit, Project } from '../core/types';
import { getCachedImage } from '../images/store';

/** Colour behind the scene in the editor and in non-transparent renders. */
export const BG_COLOR = '#1A1C1F';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Where a picture of iw x ih lands inside a W x H frame: fit = whole picture, fill = covers the frame, center = original pixels. */
export function fitRect(iw: number, ih: number, W: number, H: number, fit: ImageFit): Rect {
  let s: number;
  if (fit === 'fill') s = Math.max(W / iw, H / ih);
  else if (fit === 'fit') s = Math.min(W / iw, H / ih);
  else s = 1;
  const w = iw * s;
  const h = ih * s;
  return { x: (W - w) / 2, y: (H - h) / 2, w, h };
}

/**
 * Backgrounds that belong in a picture of the scene (snapshot or export), back to front.
 * The camera background only exists for a project with a render camera, and is drawn when `camera` is true
 * (exports, or looking through the render camera).
 */
export function renderBackdrops(p: Pick<Project, 'objects' | 'background' | 'cameraBackground'>, camera: boolean): ImageBackdrop[] {
  const out: ImageBackdrop[] = [];
  if (p.background?.visible && p.background.inRender) out.push(p.background);
  if (camera && p.cameraBackground?.visible && p.cameraBackground.inRender && p.objects.some((o) => o.kind === 'camera')) out.push(p.cameraBackground);
  return out;
}

/**
 * Compose one frame: background colour (unless transparent), backgrounds, then the 3D pixels (rendered with a transparent clear).
 * Returns `out` (reused between calls). Images that are not loaded yet are skipped.
 */
export function composeFrame(
  scene3d: CanvasImageSource,
  out: HTMLCanvasElement,
  backdrops: ImageBackdrop[],
  transparent: boolean,
): HTMLCanvasElement {
  const ctx = out.getContext('2d')!;
  const { width: W, height: H } = out;
  ctx.globalAlpha = 1;
  ctx.clearRect(0, 0, W, H);
  if (!transparent) {
    ctx.fillStyle = BG_COLOR;
    ctx.fillRect(0, 0, W, H);
  }
  for (const b of backdrops) {
    const img = getCachedImage(b.imageId);
    if (!img) continue;
    const iw = img.naturalWidth || img.width;
    const ih = img.naturalHeight || img.height;
    if (!iw || !ih) continue;
    const r = fitRect(iw, ih, W, H, b.fit);
    ctx.globalAlpha = b.opacity;
    ctx.drawImage(img, r.x, r.y, r.w, r.h);
  }
  ctx.globalAlpha = 1;
  ctx.drawImage(scene3d, 0, 0, W, H);
  return out;
}
