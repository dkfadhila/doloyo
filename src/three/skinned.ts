import { Color, Group, Material, MeshBasicMaterial, MeshStandardMaterial, type Mesh, type Object3D, type SkinnedMesh } from 'three';
import { getCharacter } from '../characters/registry';
import { loadCharacter } from '../characters/loader';
import type { MaterialMode, Pose, Vec3 } from '../core/types';
import type { BodyProfile } from '../core/body';
import { Retargeter } from '../retarget/skeletal';
import { ACCENT, BODY, OBJECT_TINT } from './shared';

const BLACK = new Color(0, 0, 0);
const HIDE_IN_DOLL = /eye|brow|lash|hair|tooth|teeth|tongue/i;

/** A loaded skinned character bound to one scene object, driven by our 17-joint pose. */
export class SkinnedInstance {
  private meshes: SkinnedMesh[] = [];
  private originals = new Map<Mesh, Material | Material[]>();
  private clones = new Map<Mesh, Material | Material[]>();
  private doll = new MeshStandardMaterial({ color: BODY, roughness: 0.85, metalness: 0 });
  /** Character file this instance was built from (views compare it with the object's current character). */
  characterId = '';
  private look = '';
  private ghostMat: MeshBasicMaterial | null = null;

  constructor(readonly rt: Retargeter) {
    rt.model.traverse((o) => {
      const m = o as SkinnedMesh;
      if (!m.isMesh) return;
      m.frustumCulled = false; // bounds come from the bind pose, not the posed skeleton
      m.castShadow = true;
      m.receiveShadow = true;
      m.raycast = () => {}; // picking uses the invisible joint proxies
      if (m.isSkinnedMesh) this.meshes.push(m);
      this.originals.set(m, m.material);
      const cl = Array.isArray(m.material) ? m.material.map((x) => x.clone()) : m.material.clone();
      this.clones.set(m, cl);
    });
  }

  get root(): Group {
    return this.rt.root;
  }

  /** Fit the skeleton to a body size (null = original proportions). Feet stay on the floor. */
  setBody(profile: BodyProfile | null): void {
    this.rt.setBody(profile);
  }

  apply(pose: Pose, hipsPos: Vec3): void {
    this.rt.apply(pose, hipsPos);
  }

  /** Onion-skin ghost: every mesh gets one translucent flat material and casts no shadow. */
  setGhost(color: Color, opacity: number): void {
    const m = new MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false });
    this.ghostMat = m;
    this.root.userData.noSnap = true;
    for (const mesh of this.meshes) {
      mesh.material = m;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      mesh.visible = !HIDE_IN_DOLL.test(mesh.name);
      mesh.renderOrder = 2;
    }
    this.look = 'ghost';
  }

  /** Switch between matte art-doll look and the file's own textures; tint when selected. */
  setLook(mode: MaterialMode, selected: boolean): void {
    const key = mode + (selected ? '1' : '0');
    if (key === this.look) return;
    this.look = key;
    this.doll.color.copy(selected ? OBJECT_TINT : BODY);
    for (const m of this.meshes) {
      if (mode === 'doll') {
        m.material = this.doll;
        m.visible = !HIDE_IN_DOLL.test(m.name);
      } else {
        const cl = this.clones.get(m)!;
        m.material = cl;
        m.visible = true;
        for (const mat of Array.isArray(cl) ? cl : [cl]) {
          const s = mat as MeshStandardMaterial;
          if (s.emissive) {
            s.emissive.copy(selected ? ACCENT : BLACK);
            s.emissiveIntensity = selected ? 0.22 : 0;
          }
        }
      }
    }
  }

  dispose(): void {
    this.doll.dispose();
    this.ghostMat?.dispose();
    for (const cl of this.clones.values()) for (const m of Array.isArray(cl) ? cl : [cl]) m.dispose();
    this.root.removeFromParent();
  }
}

/** Load the character file and build the retargeter (async; the file parse is cached). */
export async function createSkinned(characterId: string): Promise<SkinnedInstance> {
  const def = getCharacter(characterId);
  if (!def) throw new Error(`Unknown character: ${characterId}`);
  const loaded = await loadCharacter(characterId);
  const scene: Object3D = loaded.scene;
  const rt = new Retargeter(scene, def.bones, def.calibration);
  if (!rt.info.mapped.includes('hips')) throw new Error(`Character "${def.label}" has no hips bone mapped`);
  const inst = new SkinnedInstance(rt);
  inst.characterId = characterId;
  return inst;
}
