import { TransformControls } from '@react-three/drei';
import { useThree } from '@react-three/fiber';
import { useEffect, useRef, useState } from 'react';
import { Euler, type Object3D } from 'three';
import { profileOf } from '../core/body';
import type { Vec3 } from '../core/types';
import { useStore, type Mode } from '../store';
import { drag } from './shared';

const R2D = 180 / Math.PI;
const round = (n: number) => Math.round(n * 1000) / 1000;
const v3 = (a: number, b: number, c: number): Vec3 => [round(a), round(b), round(c)];

export function Gizmo() {
  const scene = useThree((s) => s.scene);
  const sel = useStore((s) => s.selection);
  const mode = useStore((s) => s.mode);
  const kind = useStore((s) => s.project.objects.find((o) => o.id === s.selection.object)?.kind);
  const ikActive = useStore((s) => s.ikOn && s.ikLimb !== null);
  const looking = useStore((s) => s.lookThrough);
  const [target, setTarget] = useState<Object3D | null>(null);
  const ref = useRef<{ axis: string | null } | null>(null);

  const jointMode = !!(sel.object && sel.joint && kind === 'mannequin');
  const name = !sel.object ? null : jointMode ? `${sel.object}:${sel.joint}` : `obj:${sel.object}`;
  let m: Mode = kind === 'camera' ? 'translate' : mode;
  if (jointMode) m = mode === 'translate' && sel.joint === 'hips' ? 'translate' : 'rotate';
  const hidden = (ikActive && kind === 'mannequin') || (looking && kind === 'camera');

  useEffect(() => {
    setTarget(name ? scene.getObjectByName(name) ?? null : null);
  }, [name, scene, kind]);

  useEffect(() => {
    drag.controls = ref.current;
    return () => {
      drag.controls = null;
    };
  }, [target, m]);

  if (!target || !sel.object || hidden) return null;
  const objectId = sel.object;

  const onDown = () => {
    drag.active = true;
  };
  const onUp = () => {
    drag.active = false;
    drag.lastEnd = performance.now();
    const d = useStore.getState().dispatch;
    if (jointMode && sel.joint) {
      if (m === 'translate') {
        const ob = useStore.getState().project.objects.find((x) => x.id === objectId);
        const prof = ob ? profileOf(ob) : profileOf({ character: '', body: undefined });
        const off = prof.offset.hips;
        const k = prof.hipsScale; // hipsPos is stored in adult units
        d({ type: 'joint_set', object: objectId, joint: 'hips', position: v3((target.position.x - off[0]) / k, (target.position.y - off[1]) / k, (target.position.z - off[2]) / k) });
      } else {
        const e = new Euler().setFromQuaternion(target.quaternion, 'XYZ');
        d({ type: 'joint_set', object: objectId, joint: sel.joint, rotation: v3(e.x * R2D, e.y * R2D, e.z * R2D) });
      }
      return;
    }
    if (m === 'translate') d({ type: 'object_transform', object: objectId, position: v3(target.position.x, target.position.y, target.position.z) });
    else if (m === 'scale') d({ type: 'object_transform', object: objectId, scale: v3(target.scale.x, target.scale.y, target.scale.z) });
    else {
      const e = new Euler().setFromQuaternion(target.quaternion, 'XYZ');
      d({ type: 'object_transform', object: objectId, rotation: v3(e.x * R2D, e.y * R2D, e.z * R2D) });
    }
  };

  return (
    <TransformControls
      key={`${name}:${m}`}
      ref={ref as never}
      object={target}
      mode={m}
      space={jointMode && m === 'rotate' ? 'local' : 'world'}
      size={0.8}
      onMouseDown={onDown}
      onMouseUp={onUp}
    />
  );
}
