import { useFrame } from '@react-three/fiber';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { Group, MeshStandardMaterial } from 'three';
import type { ObjectKind } from '../core/types';
import { useStore } from '../store';
import { ACCENT, BODY, D2R, drag, getLive, registerApplier, type LiveState } from './shared';

export function Shape({ id, kind }: { id: string; kind: ObjectKind }) {
  const root = useRef<Group>(null);
  const mat = useMemo(() => new MeshStandardMaterial({ color: BODY, roughness: 0.85, metalness: 0 }), []);
  useEffect(() => () => mat.dispose(), [mat]);

  const apply = useCallback(
    (l: LiveState) => {
      const r = root.current;
      const o = l.project.objects.find((x) => x.id === id);
      if (!r || !o) return;
      r.position.set(...o.position);
      r.rotation.set(o.rotation[0] * D2R, o.rotation[1] * D2R, o.rotation[2] * D2R);
      r.scale.set(...o.scale);
      mat.color.copy(l.selected === id ? ACCENT : BODY);
    },
    [id, mat],
  );
  useEffect(() => registerApplier(apply), [apply]);
  useFrame(() => {
    if (!drag.active) apply(getLive());
  });

  return (
    <group ref={root} name={`obj:${id}`}>
      <mesh
        castShadow
        receiveShadow
        material={mat}
        onClick={(e) => {
          e.stopPropagation();
          useStore.getState().select(id, null);
        }}
      >
        {kind === 'cube' && <boxGeometry args={[0.5, 0.5, 0.5]} />}
        {kind === 'sphere' && <sphereGeometry args={[0.25, 32, 20]} />}
        {kind === 'cylinder' && <cylinderGeometry args={[0.2, 0.2, 0.5, 32]} />}
      </mesh>
    </group>
  );
}
