import { TransformControls } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useRef } from 'react';
import { Mesh, Object3D, Vector3, type Intersection, type Raycaster } from 'three';
import { LIMB_JOINTS, reachWorld } from '../core/ik';
import { LIMBS, type Limb, type Vec3 } from '../core/types';
import { useStore } from '../store';
import { ACCENT, D2R, drag } from './shared';

const round = (n: number) => Math.round(n * 1000) / 1000;
const tmp = new Vector3();

/** Handles are always hit before the invisible pick volumes of the character (distance forced to 0). */
function frontRaycast(this: Mesh, raycaster: Raycaster, hits: Intersection[]) {
  const local: Intersection[] = [];
  Mesh.prototype.raycast.call(this, raycaster, local);
  for (const h of local) {
    h.distance = 0;
    hits.push(h);
  }
}

/** Accent diamonds at the wrists and ankles of the selected mannequin; drag one (translate gizmo) to solve IK live, release to commit ik_reach. */
export function IkHandles() {
  const scene = useThree((s) => s.scene);
  const ikOn = useStore((s) => s.ikOn);
  const limb = useStore((s) => s.ikLimb);
  const id = useStore((s) => {
    const o = s.project.objects.find((x) => x.id === s.selection.object);
    return o?.kind === 'mannequin' ? o.id : null;
  });
  const meshes = useRef<Partial<Record<Limb, Mesh | null>>>({});
  const proxy = useRef<Object3D>(null);
  const ctl = useRef<{ axis: string | null } | null>(null);

  const endBone = (l: Limb) => (id ? scene.getObjectByName(`${id}:${LIMB_JOINTS[l][2]}`) : null);

  useFrame(() => {
    if (!id || !ikOn) return;
    for (const l of LIMBS) {
      const m = meshes.current[l];
      const b = endBone(l);
      if (!m || !b) continue;
      b.getWorldPosition(tmp);
      m.position.copy(tmp);
      m.visible = l !== limb;
    }
    const p = proxy.current;
    if (p && limb && !drag.active) {
      const b = endBone(limb);
      if (b) p.position.copy(b.getWorldPosition(tmp));
    }
  });

  useEffect(() => {
    if (!limb) return;
    drag.controls = ctl.current;
    return () => {
      if (drag.controls === ctl.current) drag.controls = null;
    };
  }, [limb]);

  // leaving IK mode or changing the selection drops the active handle
  useEffect(() => {
    if (!ikOn || !id) useStore.getState().setIkLimb(null);
  }, [ikOn, id]);

  if (!ikOn || !id) return null;

  const solveLive = () => {
    const p = proxy.current;
    const st = useStore.getState();
    const o = st.project.objects.find((x) => x.id === id);
    if (!p || !o || !limb) return;
    const r = reachWorld(o, limb, [p.position.x, p.position.y, p.position.z]);
    for (const [j, v] of Object.entries(r.joints)) {
      const g = scene.getObjectByName(`${id}:${j}`);
      if (g) g.rotation.set(v[0] * D2R, v[1] * D2R, v[2] * D2R);
    }
  };
  const commit = () => {
    drag.active = false;
    drag.lastEnd = performance.now();
    const p = proxy.current;
    if (!p || !limb) return;
    const target: Vec3 = [round(p.position.x), round(p.position.y), round(p.position.z)];
    useStore.getState().dispatch({ type: 'ik_reach', object: id, limb, target });
  };

  return (
    <>
      {LIMBS.map((l) => (
        <mesh
          key={l}
          ref={(m) => (meshes.current[l] = m)}
          userData={{ noSnap: true }}
          renderOrder={30}
          raycast={frontRaycast}
          scale={1}
          onClick={(e) => {
            e.stopPropagation();
            useStore.getState().setIkLimb(l);
          }}
          onPointerOver={() => (document.body.style.cursor = 'pointer')}
          onPointerOut={() => (document.body.style.cursor = '')}
        >
          <octahedronGeometry args={[0.045, 0]} />
          <meshBasicMaterial color={ACCENT} depthTest={false} transparent opacity={0.95} />
        </mesh>
      ))}
      <object3D ref={proxy} userData={{ noSnap: true }} />
      {limb && (
        <TransformControls
          key={limb}
          ref={ctl as never}
          object={proxy as never}
          mode="translate"
          space="world"
          size={0.8}
          onMouseDown={() => {
            drag.active = true;
          }}
          onObjectChange={solveLive}
          onMouseUp={commit}
        />
      )}
    </>
  );
}
