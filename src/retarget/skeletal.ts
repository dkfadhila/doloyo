/**
 * Skeletal retargeting between our canonical 17-joint pose and any humanoid skeleton (Quaternius, Mixamo, VRM...).
 *
 * Model: every mapped bone b of our joint j gets, in OUR frame (Y up, +X left, +Z forward),
 *     Q_b = R_j * O_j * C_b * Q0_b
 * R_j  world rotation of our joint (FK of the pose; includes twist)
 * Q0_b the bone's rest world rotation (from the bind pose)
 * C_b  shortest arc from the bone's rest direction (towards its child) to our rest segment direction, so a T-pose
 *      character ends up with arms-down exactly where our rest pose has them, and every bone then points where our
 *      segment points (swing); twist comes from R_j (resolved by the rig's own joint axes)
 * O_j  optional per-joint tweak from the registry calibration
 * The inverse (read) is exact: R_j = Q_b * Q0_b^-1 * C_b^-1 * O_j^-1, so clips sampled on a skeleton convert back to
 * our Euler angles without loss.
 */
import { Box3, Euler, Group, Matrix4, Object3D, Quaternion, Vector3, type SkinnedMesh } from 'three';
import type { BodyProfile } from '../core/body';
import type { BoneMap, Calibration } from '../characters/registry';
import { emptyPose, JOINTS, RIG, RIG_BY_NAME } from '../core/rig';
import type { JointName, Pose, Vec3 } from '../core/types';
import { arc, D2R, quatToEuler, v3 } from './solver';

/** The joint whose bone defines this joint's segment direction. */
const CHILD_JOINT: Partial<Record<JointName, JointName>> = {
  hips: 'spine', spine: 'chest', chest: 'neck', neck: 'head',
  L_shoulder: 'L_elbow', L_elbow: 'L_wrist', R_shoulder: 'R_elbow', R_elbow: 'R_wrist',
  L_hip: 'L_knee', L_knee: 'L_ankle', R_hip: 'R_knee', R_knee: 'R_ankle',
};
const UP = new Vector3(0, 1, 0);
const RIG_HEIGHT = 0.95;

type Role =
  | { kind: 'joint'; bone: Object3D; joint: JointName; q0: Quaternion; corr: Quaternion }
  | { kind: 'blend'; bone: Object3D; from: JointName; to: JointName; t: number; q0: Quaternion; corr: Quaternion }
  | { kind: 'share'; bone: Object3D; joint: JointName; share: number; q0: Quaternion };

/** One bone that body fitting may move/scale (see Retargeter.setBody). */
interface FitNode {
  node: Object3D;
  pos0: Vector3;
  scale0: Vector3;
  /** World rotation of the parent at rest, in our frame. */
  parentQ: Quaternion;
  /** Our joint of this bone, if mapped. */
  joint: JointName | null;
  /** Joint whose placement factors this bone follows: itself when mapped, else the next mapped joint down the chain. */
  chain: JointName | null;
  /** Some ancestor bone is mapped (bones above the pelvis, like root and IK helpers, are never touched). */
  underMapped: boolean;
}

export interface RetargetInfo {
  scale: number;
  yaw: number; // degrees applied for facing
  mapped: JointName[];
  missing: JointName[];
}

export class Retargeter {
  /** Add this to the scene; it holds the model with the facing/scale fit applied. */
  readonly root = new Group();
  readonly info: RetargetInfo;
  private roles: Role[] = [];
  private roleOf = new Map<Object3D, Role>();
  private nodes: Object3D[] = [];
  private restLocal = new Map<Object3D, Quaternion>();
  private pelvis: Object3D | null = null;
  private pelvisParentInv = new Matrix4();
  private pelvisRestModel = new Vector3();
  private pelvisRestWorld = new Vector3();
  private yaw = new Quaternion();
  private scale = 1;
  private wq = new Map<Object3D, Quaternion>();
  // body fitting
  private fitNodes: FitNode[] = [];
  private pelvisParent0 = new Matrix4();
  private pelvisRestModel0 = new Vector3();
  private rootY0 = 0;
  private yOffset = 0;
  private hipsScale = 1;
  private body: BodyProfile | null = null;
  private footBones: Object3D[] = [];
  private soles: { mesh: SkinnedMesh; idx: number[] }[] | null = null;

  constructor(readonly model: Object3D, bones: BoneMap, cal: Calibration = {}) {
    this.root.name = 'retarget-root';
    this.root.add(model);
    this.root.updateMatrixWorld(true);

    const find = (n?: string) => (n ? model.getObjectByName(n) ?? null : null);
    const bone = {} as Partial<Record<JointName, Object3D>>;
    const missing: JointName[] = [];
    for (const j of JOINTS) {
      const b = find(bones[j]);
      if (b) bone[j] = b;
      else missing.push(j);
    }
    const wpos = (o: Object3D) => o.getWorldPosition(new Vector3());
    const wquat = (o: Object3D) => o.getWorldQuaternion(new Quaternion());

    // facing: align the character's left-right axis with +X (rotation about Y only)
    let yawRad = (cal.yaw ?? 0) * D2R;
    if (bone.L_hip && bone.R_hip) {
      const lat = wpos(bone.L_hip).sub(wpos(bone.R_hip));
      if (Math.hypot(lat.x, lat.z) > 1e-6) yawRad += Math.atan2(lat.z, lat.x);
    }
    this.yaw.setFromAxisAngle(UP, yawRad);
    const Y = this.yaw;

    const ourPos = (o: Object3D) => wpos(o).applyQuaternion(Y);
    const ourQuat = (o: Object3D) => Y.clone().multiply(wquat(o));

    // height fit
    let minY = Infinity;
    model.traverse((o) => {
      if ((o as SkinnedMesh).isSkinnedMesh) {
        const b = new Box3().expandByObject(o);
        if (isFinite(b.min.y)) minY = Math.min(minY, b.min.y);
      }
    });
    if (!isFinite(minY)) {
      for (const j of ['L_ankle', 'R_ankle'] as JointName[]) {
        const b = bone[j];
        if (b) minY = Math.min(minY, ourPos(b).y, ...(b.children.map((c) => ourPos(c).y)));
      }
    }
    if (!isFinite(minY)) minY = 0;
    const pelvis = bone.hips;
    const pelvisY = pelvis ? ourPos(pelvis).y : RIG_HEIGHT;
    const h = Math.max(0.2, pelvisY - minY);
    this.scale = (RIG_HEIGHT / h) * (cal.scaleMul ?? 1);

    const hint = (n?: string) => find(n);
    const addJoint = (j: JointName, b: Object3D) => {
      const q0 = ourQuat(b);
      let corr = new Quaternion();
      const hintBone = hint(cal.childHints?.[j]);
      const childJ = CHILD_JOINT[j];
      const childBone = hintBone ?? (childJ ? bone[childJ] : undefined);
      if (childBone) {
        const d0 = ourPos(childBone).sub(ourPos(b));
        const s0 = hintBone ? segDir(j) : v3(RIG_BY_NAME[childJ!].offset).normalize();
        if (d0.lengthSq() > 1e-10) corr = arc(d0, s0);
      }
      const off = cal.jointOffsets?.[j];
      if (off) corr = new Quaternion().setFromEuler(new Euler(off[0] * D2R, off[1] * D2R, off[2] * D2R, 'XYZ')).multiply(corr);
      this.roles.push({ kind: 'joint', bone: b, joint: j, q0, corr });
    };
    for (const j of JOINTS) {
      const b = bone[j];
      if (b) addJoint(j, b);
    }
    for (const bl of cal.blends ?? []) {
      const b = find(bl.bone);
      if (!b || !bone[bl.from] || !bone[bl.to]) continue;
      const mapped = new Set(Object.values(bone));
      const child = b.children.find((c) => mapped.has(c)) ?? b.children.find((c) => !(c as SkinnedMesh).isMesh);
      let corr = new Quaternion();
      if (child) {
        const d0 = ourPos(child).sub(ourPos(b));
        if (d0.lengthSq() > 1e-10) corr = arc(d0, UP);
      }
      this.roles.push({ kind: 'blend', bone: b, from: bl.from, to: bl.to, t: bl.t, q0: ourQuat(b), corr });
    }
    for (const sh of cal.shares ?? []) {
      const b = find(sh.bone);
      if (b && bone[sh.joint]) this.roles.push({ kind: 'share', bone: b, joint: sh.joint, share: sh.share, q0: ourQuat(b) });
    }
    for (const r of this.roles) this.roleOf.set(r.bone, r);

    // nodes to drive: role bones and all their ancestors up to the model root
    const set = new Set<Object3D>();
    for (const r of this.roles) for (let o: Object3D | null = r.bone; o && o !== this.root; o = o.parent) set.add(o);
    model.traverse((o) => {
      if (set.has(o)) {
        this.nodes.push(o);
        this.restLocal.set(o, o.quaternion.clone());
      }
    });

    if (pelvis) {
      this.pelvis = pelvis;
      this.pelvisParentInv.copy(pelvis.parent!.matrixWorld).invert();
      this.pelvisRestModel.copy(wpos(pelvis));
    }

    // body fitting data (rest state, before the facing/scale fit is applied to the root)
    const mappedJoint = new Map<Object3D, JointName>();
    for (const j of JOINTS) if (bone[j]) mappedJoint.set(bone[j]!, j);
    const isBone = (o: Object3D) => (o as { isBone?: boolean }).isBone === true;
    const nextMapped = (o: Object3D): JointName | null => {
      const j = mappedJoint.get(o);
      if (j) return j;
      for (const c of o.children) {
        if (!isBone(c)) continue;
        const n = nextMapped(c);
        if (n) return n;
      }
      return null;
    };
    const underMapped = new Set<Object3D>();
    model.traverse((o) => {
      if (!isBone(o)) return;
      const par = o.parent;
      const j = mappedJoint.get(o) ?? null;
      const um = !!par && (mappedJoint.has(par) || underMapped.has(par));
      if (um || j) underMapped.add(o);
      this.fitNodes.push({
        node: o, pos0: o.position.clone(), scale0: o.scale.clone(),
        parentQ: par ? ourQuat(par) : new Quaternion(), joint: j, chain: j ?? nextMapped(o), underMapped: um,
      });
    });
    if (pelvis) {
      this.pelvisParent0.copy(this.pelvisParentInv).invert();
      this.pelvisRestModel0.copy(this.pelvisRestModel);
    }
    this.yOffset = cal.yOffset ?? 0;
    this.footBones = [bone.L_ankle, bone.R_ankle].filter((b): b is Object3D => !!b);

    this.root.quaternion.copy(Y);
    this.root.scale.setScalar(this.scale);
    this.root.position.set(0, -minY * this.scale + (cal.yOffset ?? 0), 0);
    this.rootY0 = this.root.position.y;
    this.root.updateMatrixWorld(true);
    if (pelvis) this.pelvisRestWorld.copy(wpos(pelvis));

    this.info = { scale: this.scale, yaw: (yawRad * 180) / Math.PI, mapped: JOINTS.filter((j) => bone[j]), missing };
  }

  /**
   * Fit the skeleton to a body profile (children, teens, height fine-tune). Every mapped bone gets a uniform scale
   * (its volume: limb/torso girth follows length) and every bone between mapped joints is repositioned per axis
   * (leg length, torso length, arm length, shoulder width, hip width, neck length), then the legs are tuned so the hips
   * sit at the profile hips height with the soles exactly on the floor. null = the original proportions.
   * Rotations are never touched, so poses, clips and retargeting are unchanged; hipsPos is multiplied by hipsScale.
   */
  setBody(profile: BodyProfile | null): void {
    this.body = profile && !profile.identity ? profile : null;
    for (const f of this.fitNodes) {
      f.node.position.copy(f.pos0);
      f.node.scale.copy(f.scale0);
    }
    this.root.position.y = this.rootY0;
    this.pelvisRestModel.copy(this.pelvisRestModel0);
    this.hipsScale = 1;
    const prof = this.body;
    if (prof) {
      this.hipsScale = prof.hipsScale;
      // the hips height is linear in the leg multiplier: two probes, then solve
      const h1 = this.fitBody(prof, 1);
      const h2 = this.fitBody(prof, 1.25);
      const a = (h2 - h1) / 0.25;
      const legMul = a > 1e-6 ? Math.min(2.5, Math.max(0.3, 1 + (prof.hipsY - h1) / a)) : 1;
      this.fitBody(prof, legMul);
      const m = this.measure();
      this.root.position.y = -m.minY + this.yOffset;
    }
    this.apply(emptyPose(), [0, 0, 0]);
    this.root.updateMatrixWorld(true);
    if (this.pelvis) this.pelvisRestWorld.copy(this.pelvis.getWorldPosition(new Vector3()));
  }

  get profile(): BodyProfile | null {
    return this.body;
  }

  /** Place every fitted bone for the profile; returns the hips height above the lowest vertex (rig meters). */
  private fitBody(prof: BodyProfile, legMul: number): number {
    const C = new Map<Object3D, number>();
    const axisOf = (j: JointName): Vector3 => {
      const a = prof.axis[j];
      if (j.endsWith('_hip')) return new Vector3(a[0], a[1] * legMul, a[2]);
      if (j.endsWith('_knee') || j.endsWith('_ankle')) return new Vector3(a[0] * legMul, a[1] * legMul, a[2] * legMul);
      return new Vector3(...a);
    };
    for (const f of this.fitNodes) {
      const par = f.node.parent;
      const cp = (par && C.get(par)) || 1;
      let own = cp;
      if (f.joint) {
        own = prof.mesh[f.joint];
        f.node.scale.copy(f.scale0).multiplyScalar(own / cp);
      }
      C.set(f.node, own);
      if (f.chain && (f.joint || f.underMapped)) {
        const w = f.pos0.clone().applyQuaternion(f.parentQ).multiply(axisOf(f.chain));
        f.node.position.copy(w.applyQuaternion(f.parentQ.clone().invert()).divideScalar(cp));
      }
    }
    if (this.pelvis) this.pelvisRestModel.copy(this.pelvis.position).applyMatrix4(this.pelvisParent0);
    const m = this.measure();
    return m.pelvisY - m.minY;
  }

  /** Skinned vertices whose strongest weight is a foot bone (cached): the soles, immune to stray vertices elsewhere. */
  private footVerts(): { mesh: SkinnedMesh; idx: number[] }[] {
    if (this.soles) return this.soles;
    const feet = new Set<Object3D>();
    for (const b of this.footBones) b.traverse((o) => feet.add(o));
    const out: { mesh: SkinnedMesh; idx: number[] }[] = [];
    this.model.traverse((o) => {
      const m = o as SkinnedMesh;
      if (!m.isSkinnedMesh) return;
      const si = m.geometry.getAttribute('skinIndex');
      const sw = m.geometry.getAttribute('skinWeight');
      const idx: number[] = [];
      for (let i = 0; i < si.count; i++) {
        let k = 0;
        for (let j = 1; j < 4; j++) if (sw.getComponent(i, j) > sw.getComponent(i, k)) k = j;
        if (sw.getComponent(i, k) > 0 && feet.has(m.skeleton.bones[si.getComponent(i, k)])) idx.push(i);
      }
      if (idx.length) out.push({ mesh: m, idx });
    });
    this.soles = out;
    return out;
  }

  /** Rest pose measurement: pelvis height and the lowest sole vertex, in our frame with the root at y = 0. */
  private measure(): { pelvisY: number; minY: number } {
    this.root.position.y = 0;
    this.apply(emptyPose(), [0, 0, 0]);
    this.root.updateMatrixWorld(true);
    let minY = Infinity;
    const v = new Vector3();
    for (const { mesh, idx } of this.footVerts()) {
      for (const i of idx) {
        mesh.getVertexPosition(i, v);
        mesh.applyBoneTransform(i, v);
        v.applyMatrix4(mesh.matrixWorld);
        if (v.y < minY) minY = v.y;
      }
    }
    if (!isFinite(minY)) minY = 0;
    const pelvisY = this.pelvis ? this.pelvis.getWorldPosition(new Vector3()).y : 0;
    return { pelvisY, minY };
  }

  /** World rotation of every joint for a pose (our frame). */
  private jointWorld(pose: Pose): Record<JointName, Quaternion> {
    const out = {} as Record<JointName, Quaternion>;
    for (const d of RIG) {
      const e = pose[d.name];
      const q = new Quaternion().setFromEuler(new Euler(e[0] * D2R, e[1] * D2R, e[2] * D2R, 'XYZ'));
      out[d.name] = d.parent ? out[d.parent].clone().multiply(q) : q;
    }
    return out;
  }

  /** Drive the skeleton from our pose (forward retarget). */
  apply(pose: Pose, hipsPos: Vec3): void {
    const R = this.jointWorld(pose);
    const wq = this.wq;
    wq.clear();
    const parentOf = (n: Object3D) => (n.parent === this.root ? this.root.quaternion : wq.get(n.parent!) ?? new Quaternion());
    for (const n of this.nodes) {
      const pq = parentOf(n);
      const role = this.roleOf.get(n);
      const local = this.restLocal.get(n)!.clone();
      if (role) {
        let world: Quaternion;
        if (role.kind === 'joint') world = R[role.joint].clone().multiply(role.corr).multiply(role.q0);
        else if (role.kind === 'blend') world = R[role.from].clone().slerp(R[role.to], role.t).multiply(role.corr).multiply(role.q0);
        else {
          const chest = R.chest;
          const rel = chest.clone().invert().multiply(R[role.joint]);
          world = chest.clone().multiply(new Quaternion().slerp(rel, role.share)).multiply(role.q0);
        }
        local.copy(pq.clone().invert().multiply(world));
      }
      n.quaternion.copy(local);
      wq.set(n, pq.clone().multiply(n.quaternion));
    }
    if (this.pelvis) {
      const target = this.pelvisRestModel.clone().add(v3(hipsPos).multiplyScalar(this.hipsScale).applyQuaternion(this.yaw.clone().invert()).divideScalar(this.scale));
      this.pelvis.position.copy(target.applyMatrix4(this.pelvisParentInv));
    }
  }

  /** Read our pose back from the skeleton's current state (e.g. after an AnimationMixer update). Exact inverse of apply. */
  read(): { pose: Pose; hipsPos: Vec3 } {
    const wq = this.wq;
    wq.clear();
    for (const n of this.nodes) {
      const pq = n.parent === this.root ? this.root.quaternion : wq.get(n.parent!) ?? new Quaternion();
      wq.set(n, pq.clone().multiply(n.quaternion));
    }
    const R = {} as Record<JointName, Quaternion>;
    const pose = {} as Pose;
    for (const d of RIG) {
      const role = this.roles.find((r) => r.kind === 'joint' && r.joint === d.name);
      const parentR = d.parent ? R[d.parent] : new Quaternion();
      if (role && role.kind === 'joint') {
        const q = wq.get(role.bone)!.clone().multiply(role.q0.clone().invert()).multiply(role.corr.clone().invert());
        R[d.name] = q;
      } else R[d.name] = parentR.clone();
      pose[d.name] = quatToEuler(parentR.clone().invert().multiply(R[d.name]));
    }
    let hipsPos: Vec3 = [0, 0, 0];
    if (this.pelvis) {
      this.root.updateMatrixWorld(true);
      const p = this.pelvis.getWorldPosition(new Vector3()).sub(this.pelvisRestWorld);
      hipsPos = [p.x / this.hipsScale, p.y / this.hipsScale, p.z / this.hipsScale];
    }
    return { pose, hipsPos };
  }
}

/** Rest segment direction of a leaf joint (wrist, ankle) from the rig's own geometry. */
function segDir(j: JointName): Vector3 {
  const seg = RIG_BY_NAME[j].segs[0];
  return seg ? v3(seg.to).sub(v3(seg.from ?? [0, 0, 0])).normalize() : new Vector3(0, -1, 0);
}
