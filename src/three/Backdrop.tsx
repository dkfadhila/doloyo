import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { ImageBackdrop } from '../core/types';
import { getCachedImageUrl, ensureImage, imagesVersion, onImagesChange } from '../images/store';
import { useStore } from '../store';
import { useUi } from '../ui/uiStore';

const SIZE = { fit: 'contain', fill: 'cover', center: 'auto' } as const;

function Layer({ b }: { b: ImageBackdrop }) {
  useSyncExternalStore(onImagesChange, imagesVersion);
  useEffect(() => void ensureImage(b.imageId), [b.imageId]);
  const url = getCachedImageUrl(b.imageId);
  if (!url) return null;
  return <div className="backdrop-img" style={{ backgroundImage: `url("${url}")`, backgroundSize: SIZE[b.fit], opacity: b.opacity }} />;
}

/** True while a reference image is drawn behind the (then transparent) 3D scene. */
export function useBackdropActive(): boolean {
  return useStore((s) => !!(s.project.background?.visible || (s.lookThrough && s.project.cameraBackground?.visible && s.project.objects.some((o) => o.kind === 'camera'))));
}

/**
 * DOM layers behind the transparent canvas: the viewport background (screen space) and, while looking through the
 * render camera, the camera background locked to the render frame (the same rectangle as the safe frame).
 */
export function Backdrop() {
  const bg = useStore((s) => s.project.background);
  const cam = useStore((s) => s.project.cameraBackground);
  const through = useStore((s) => s.lookThrough && s.project.objects.some((o) => o.kind === 'camera'));
  const aspect = useUi((s) => s.renderAspect);
  const ref = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setBox({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);
  const view = box.w / Math.max(1, box.h);
  const fw = view >= aspect ? box.h * aspect : box.w;
  const fh = view >= aspect ? box.h : box.w / aspect;
  return (
    <div ref={ref} className="backdrop" aria-hidden="true">
      {bg?.visible && <Layer b={bg} />}
      {through && cam?.visible && (
        <div className="backdrop-frame" style={{ width: fw, height: fh }}>
          <Layer b={cam} />
        </div>
      )}
    </div>
  );
}
