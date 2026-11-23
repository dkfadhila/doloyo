import { useFrame } from '@react-three/fiber';
import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { DoubleSide, EdgesGeometry, FrontSide, Group, LineBasicMaterial, LineSegments, Mesh, MeshBasicMaterial, PlaneGeometry, Quaternion, SRGBColorSpace, Texture, Vector3 } from 'three';
import { useStore } from '../store';
import { ensureImage, getCachedImage, imagesVersion, onImagesChange } from '../images/store';
import { ACCENT, D2R, drag, getLive, registerApplier, type LiveState } from './shared';

const PLACEHOLDER = '#3a3e45';
const tmpPos = new Vector3();
const tmpScale = new Vector3();
const tmpQuat = new Quaternion();

/**
 * Reference image as a textured plane in the scene: aspect m wide and 1 m high before the object scale, transform with the gizmo.
 * Unlit (the picture keeps its colours), can be translucent, double sided, locked (never picked) and turn to face the camera.
 * Plane objects that are not "in render" are flagged noSnap so snapshots and exports skip them.
 */
export function ImagePlane({ id }: { id: string }) {
  const root = useRef<Group>(null);
  const mesh = useRef<Mesh>(null);
  const edges = useRef<LineSegments>(null);
  const imageId = useStore((s) => s.project.objects.find((o) => o.id === id)?.image?.imageId ?? '');
  const aspect = useStore((s) => s.project.objects.find((o) => o.id === id)?.image?.aspect ?? 1);
  const locked = useStore((s) => s.project.objects.find((o) => o.id === id)?.image?.locked ?? false);
  useSyncExternalStore(onImagesChange, imagesVersion);

  const geo = useMemo(() => new PlaneGeometry(aspect, 1), [aspect]);
  const edgeGeo = useMemo(() => new EdgesGeometry(geo), [geo]);
  useEffect(
    () => () => {
      geo.dispose();
      edgeGeo.dispose();
    },
    [geo, edgeGeo],
  );
  const mat = useMemo(() => new MeshBasicMaterial({ color: '#ffffff', transparent: true, depthWrite: false, toneMapped: false }), []);
  const edgeMat = useMemo(() => new LineBasicMaterial({ color: ACCENT, depthTest: false, transparent: true }), []);
  const tex = useRef<Texture | null>(null);
  useEffect(() => () => void (mat.dispose(), edgeMat.dispose()), [mat, edgeMat]);

  // texture from the stored picture (loads once, then follows image changes)
  useEffect(() => {
    let alive = true;
    void ensureImage(imageId).then(() => {
      if (!alive) return;
      const img = getCachedImage(imageId);
      tex.current?.dispose();
      tex.current = null;
      if (img) {
        const t = new Texture(img);
        t.colorSpace = SRGBColorSpace;
        t.anisotropy = 8;
        t.needsUpdate = true;
        tex.current = t;
      }
      mat.map = tex.current;
      mat.color.set(tex.current ? '#ffffff' : PLACEHOLDER);
      mat.needsUpdate = true;
    });
    return () => {
      alive = false;
    };
  }, [imageId, mat]);
  useEffect(
    () => () => {
      tex.current?.dispose();
    },
    [],
  );

  const apply = useCallback(
    (l: LiveState) => {
      const r = root.current;
      const m = mesh.current;
      const o = l.project.objects.find((x) => x.id === id);
      if (!r || !m || !o?.image) return;
      const im = o.image;
      r.position.set(...o.position);
      r.rotation.set(o.rotation[0] * D2R, o.rotation[1] * D2R, o.rotation[2] * D2R);
      r.scale.set(...o.scale);
      const placeholder = !mat.map;
      mat.opacity = placeholder ? Math.min(im.opacity, 0.35) : im.opacity;
      const side = im.doubleSided ? DoubleSide : FrontSide;
      if (mat.side !== side) {
        mat.side = side;
        mat.needsUpdate = true;
      }
      m.userData.noSnap = !im.inRender;
      m.userData.billboard = im.billboard;
      if (edges.current) edges.current.visible = l.selected === id;
    },
    [id, mat],
  );
  useEffect(() => registerApplier(apply), [apply]);
  useFrame(() => {
    if (!drag.active) apply(getLive());
  });

  // billboard: take the camera orientation just before drawing (also holds for the offscreen export camera)
  const onBeforeRender = useCallback((_r: unknown, _s: unknown, camera: { quaternion: Quaternion }) => {
    const m = mesh.current;
    const g = root.current;
    if (!m || !g || !m.userData.billboard) return;
    tmpPos.copy(g.position);
    tmpScale.set(g.scale.x, g.scale.y, 1);
    tmpQuat.copy(camera.quaternion);
    m.matrixWorld.compose(tmpPos, tmpQuat, tmpScale);
  }, []);

  return (
    <group ref={root} name={`obj:${id}`}>
      <mesh
        ref={mesh}
        geometry={geo}
        material={mat}
        renderOrder={-1}
        onBeforeRender={onBeforeRender as never}
        {...(locked ? { raycast: () => null } : {})}
        onClick={
          locked
            ? undefined
            : (e) => {
                e.stopPropagation();
                useStore.getState().select(id, null);
              }
        }
      />
      <lineSegments ref={edges} geometry={edgeGeo} material={edgeMat} visible={false} userData={{ noSnap: true }} raycast={() => null} />
    </group>
  );
}
