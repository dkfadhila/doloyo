import { useFrame, useThree } from '@react-three/fiber';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { BufferAttribute, BufferGeometry, Group, LineBasicMaterial, MeshBasicMaterial, PerspectiveCamera, Vector3 } from 'three';
import { useStore } from '../store';
import { useUi } from '../ui/uiStore';
import { ACCENT, BODY, drag, getLive, registerApplier, viewApi, type LiveState } from './shared';

const MUTED = '#8a8f98';
const UP = new Vector3(0, 1, 0);
const DEPTH = 0.7; // frustum gizmo depth (meters), purely visual

/** Camera basis looking from `pos` to `target` (up = +Y). */
export function cameraBasis(pos: Vector3, target: Vector3) {
  const f = target.clone().sub(pos);
  if (f.lengthSq() < 1e-10) f.set(0, 0, -1);
  f.normalize();
  const r = new Vector3().crossVectors(f, UP);
  if (r.lengthSq() < 1e-8) r.set(1, 0, 0);
  r.normalize();
  const u = new Vector3().crossVectors(r, f).normalize();
  return { f, r, u };
}

/** The render camera in the scene: frustum wireframe (position, look-at, FOV, export aspect) and a pick sphere. Never drawn in exports. */
export function CameraObject({ id }: { id: string }) {
  const root = useRef<Group>(null);
  const geo = useMemo(() => {
    const g = new BufferGeometry();
    // apex->4 corners (8), rect (8), up marker (6), apex->target (2), target cross (6)
    g.setAttribute('position', new BufferAttribute(new Float32Array(30 * 3), 3));
    return g;
  }, []);
  const mat = useMemo(() => new LineBasicMaterial({ color: MUTED }), []);
  const pick = useMemo(() => new MeshBasicMaterial({ colorWrite: false, depthWrite: false, transparent: true, opacity: 0 }), []);
  useEffect(
    () => () => {
      geo.dispose();
      mat.dispose();
      pick.dispose();
    },
    [geo, mat, pick],
  );

  const apply = useCallback(
    (l: LiveState) => {
      const r = root.current;
      const o = l.project.objects.find((x) => x.id === id);
      if (!r || !o) return;
      r.position.set(...o.position);
      r.visible = !useStore.getState().lookThrough;
      mat.color.set(l.selected === id ? ACCENT : MUTED);
      const aspect = useUi.getState().renderAspect;
      const { f, r: rt, u } = cameraBasis(new Vector3(0, 0, 0), new Vector3(...o.target).sub(new Vector3(...o.position)));
      const hh = DEPTH * Math.tan((o.fov * Math.PI) / 360);
      const hw = hh * aspect;
      const c = (sx: number, sy: number) => f.clone().multiplyScalar(DEPTH).addScaledVector(rt, sx * hw).addScaledVector(u, sy * hh);
      const tl = c(-1, 1), tr = c(1, 1), br = c(1, -1), bl = c(-1, -1);
      const top = c(0, 1.35);
      const tgt = new Vector3(...o.target).sub(new Vector3(...o.position));
      const k = 0.06;
      const pts: Vector3[] = [
        new Vector3(), tl, new Vector3(), tr, new Vector3(), br, new Vector3(), bl,
        tl, tr, tr, br, br, bl, bl, tl,
        c(-0.4, 1), top, top, c(0.4, 1), c(0.4, 1), c(-0.4, 1),
        new Vector3(), tgt,
        tgt.clone().addScaledVector(rt, -k), tgt.clone().addScaledVector(rt, k),
        tgt.clone().addScaledVector(u, -k), tgt.clone().addScaledVector(u, k),
        tgt.clone().addScaledVector(f, -k), tgt.clone().addScaledVector(f, k),
      ];
      const a = geo.getAttribute('position') as BufferAttribute;
      pts.forEach((p, i) => a.setXYZ(i, p.x, p.y, p.z));
      a.needsUpdate = true;
      geo.computeBoundingSphere();
    },
    [id, geo, mat],
  );
  useEffect(() => registerApplier(apply), [apply]);
  useFrame(() => {
    if (!drag.active) apply(getLive());
  });

  return (
    <group ref={root} name={`obj:${id}`}>
      <group userData={{ noSnap: true }}>
        <lineSegments geometry={geo} material={mat} frustumCulled={false} raycast={() => null} />
        <mesh
          material={pick}
          onClick={(e) => {
            e.stopPropagation();
            useStore.getState().select(id, null);
          }}
        >
          <sphereGeometry args={[0.12, 12, 8]} />
        </mesh>
        <mesh>
          <boxGeometry args={[0.12, 0.08, 0.1]} />
          <meshBasicMaterial color={BODY} wireframe />
        </mesh>
      </group>
    </group>
  );
}


/** Registers how to read the editor view (for "Set camera from view") and implements "look through render camera". */
export function ViewCamera() {
  const camera = useThree((s) => s.camera) as PerspectiveCamera;
  const size = useThree((s) => s.size);
  const controls = useThree((s) => s.controls) as unknown as {
    enabled: boolean;
    target: Vector3;
    update: () => void;
  } | null;
  const saved = useRef<{ pos: Vector3; target: Vector3; fov: number } | null>(null);
  const through = useStore((s) => s.lookThrough);
  const hasCamera = useStore((s) => s.project.objects.some((o) => o.kind === 'camera'));
  const active = through && hasCamera;

  useEffect(() => {
    viewApi.get = () => {
      if (saved.current) {
        // looking through the camera: report the saved editor view instead of the camera itself
        const s = saved.current;
        return { position: [s.pos.x, s.pos.y, s.pos.z], target: [s.target.x, s.target.y, s.target.z], fov: s.fov };
      }
      const t = controls?.target ?? new Vector3(0, 0.9, 0);
      return { position: [camera.position.x, camera.position.y, camera.position.z], target: [t.x, t.y, t.z], fov: camera.fov };
    };
    return () => {
      viewApi.get = null;
    };
  }, [camera, controls]);

  useEffect(() => {
    if (!controls) return;
    if (active) {
      saved.current = { pos: camera.position.clone(), target: controls.target.clone(), fov: camera.fov };
      controls.enabled = false;
      return () => {
        const s = saved.current;
        saved.current = null;
        controls.enabled = true;
        if (s) {
          camera.position.copy(s.pos);
          camera.fov = s.fov;
          camera.updateProjectionMatrix();
          controls.target.copy(s.target);
          camera.lookAt(s.target);
          controls.update();
        }
      };
    }
  }, [active, camera, controls]);

  useFrame(() => {
    if (!active) return;
    const o = getLive().project.objects.find((x) => x.kind === 'camera');
    if (!o) return;
    camera.position.set(...o.position);
    camera.up.copy(UP);
    camera.lookAt(new Vector3(...o.target));
    // the camera's FOV is vertical for the export aspect: keep that frame inside the viewport (safe frame)
    const view = size.width / Math.max(1, size.height);
    const ra = useUi.getState().renderAspect;
    const tan = Math.tan((o.fov * Math.PI) / 360);
    camera.fov = view >= ra ? o.fov : (2 * Math.atan(tan * (ra / view)) * 180) / Math.PI;
    camera.updateProjectionMatrix();
  });
  return null;
}
