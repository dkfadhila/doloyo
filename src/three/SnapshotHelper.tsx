import { useThree } from '@react-three/fiber';
import { useEffect } from 'react';
import { PerspectiveCamera, Vector2, type Object3D } from 'three';
import { useStore } from '../store';
import { applyAll, live, registerRenderContext, registerSnapshot, type SnapshotOptions } from './shared';

/** Registers the render context (for the exporter) and a PNG capture that re-renders the live scene at the requested size. */
export function SnapshotHelper() {
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const camera = useThree((s) => s.camera);

  useEffect(() => {
    registerRenderContext({ gl, scene, camera: camera as PerspectiveCamera });
    registerSnapshot((o: SnapshotOptions) => {
      const cam = camera as PerspectiveCamera;
      const prevSize = gl.getSize(new Vector2());
      const prevRatio = gl.getPixelRatio();
      const prevAspect = cam.aspect;
      const prevBg = scene.background;
      const prevAlpha = gl.getClearAlpha();
      const hidden: Object3D[] = [];
      scene.traverse((obj) => {
        if (obj.visible && (obj.userData.noSnap || (obj as unknown as { isTransformControls?: boolean }).isTransformControls)) {
          obj.visible = false;
          hidden.push(obj);
        }
      });
      try {
        // neutral colors: no selection tint in the picture
        live.override = { project: useStore.getState().project, selected: null, joint: null };
        applyAll(live.override);
        gl.setPixelRatio(1);
        gl.setSize(o.width, o.height, false);
        cam.aspect = o.width / o.height;
        cam.updateProjectionMatrix();
        if (o.transparent) {
          scene.background = null;
          gl.setClearAlpha(0);
        }
        gl.render(scene, cam);
        return gl.domElement.toDataURL('image/png');
      } finally {
        live.override = null;
        applyAll();
        hidden.forEach((h) => (h.visible = true));
        scene.background = prevBg;
        gl.setClearAlpha(prevAlpha);
        gl.setPixelRatio(prevRatio);
        gl.setSize(prevSize.x, prevSize.y, false);
        cam.aspect = prevAspect;
        cam.updateProjectionMatrix();
      }
    });
    return () => {
      registerSnapshot(null);
      registerRenderContext(null);
    };
  }, [gl, scene, camera]);

  return null;
}
