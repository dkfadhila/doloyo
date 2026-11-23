import { OrbitControls } from '@react-three/drei';
import { Canvas, useThree } from '@react-three/fiber';
import { useEffect } from 'react';
import { MOUSE } from 'three';
import { profileOf } from '../core/body';
import { useStore } from '../store';
import { useBackdropActive } from './Backdrop';
import { CameraObject, ViewCamera } from './CameraObject';
import { Floor } from './Floor';
import { Gizmo } from './Gizmo';
import { ImagePlane } from './ImagePlane';
import { IkHandles } from './IkHandles';
import { Lights } from './Lights';
import { Mannequin, OnionSkin } from './Mannequin';
import { drag } from './shared';
import { Shape } from './Shape';
import { SnapshotHelper } from './SnapshotHelper';

function Objects() {
  const sig = useStore((s) => s.project.objects.map((o) => o.id + ':' + o.kind).join('|'));
  return (
    <>
      {sig
        .split('|')
        .filter(Boolean)
        .map((e) => {
          const [id, kind] = e.split(':');
          if (kind === 'camera') return <CameraObject key={id} id={id} />;
          if (kind === 'image') return <ImagePlane key={id} id={id} />;
          return kind === 'mannequin' ? <Mannequin key={id} id={id} /> : <Shape key={id} id={id} kind={kind as 'cube'} />;
        })}
    </>
  );
}

type OrbitLike = { target: { set: (x: number, y: number, z: number) => void }; update: () => void };

function FocusRig() {
  const controls = useThree((s) => s.controls) as unknown as OrbitLike | null;
  const tick = useStore((s) => s.focusTick);
  useEffect(() => {
    if (!tick || !controls) return;
    const s = useStore.getState();
    const o = s.project.objects.find((x) => x.id === s.selection.object);
    if (o) controls.target.set(o.position[0], o.position[1] + (o.kind === 'mannequin' ? profileOf(o).hipsY : 0), o.position[2]);
    else controls.target.set(0, 0.9, 0);
    controls.update();
  }, [tick, controls]);
  return null;
}

/** Dark scene colour; dropped while a reference image shows through from behind the canvas. */
function SceneBackground() {
  const behind = useBackdropActive();
  return behind ? null : <color attach="background" args={['#1A1C1F']} />;
}

export function Scene() {
  return (
    <Canvas
      shadows="soft"
      camera={{ position: [2.8, 1.8, 3.8], fov: 40, near: 0.05, far: 200 }}
      gl={{ antialias: true, alpha: true, preserveDrawingBuffer: true }}
      onContextMenu={(e) => e.preventDefault()}
      onPointerMissed={(e) => {
        if (e.button !== 0) return;
        if (drag.controls?.axis != null || performance.now() - drag.lastEnd < 250) return;
        useStore.getState().select(null);
      }}
    >
      <SceneBackground />
      <Lights />
      <Floor />
      <Objects />
      <OnionSkin />
      <Gizmo />
      <IkHandles />
      <OrbitControls makeDefault target={[0, 0.9, 0]} mouseButtons={{ MIDDLE: MOUSE.PAN, RIGHT: MOUSE.ROTATE }} />
      <FocusRig />
      <ViewCamera />
      <SnapshotHelper />
    </Canvas>
  );
}
