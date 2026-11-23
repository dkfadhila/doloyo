/**
 * Animation export to glTF binary (.glb) and BVH. DOM-free (three math + the three GLTFExporter), so it also runs in node tests.
 *
 * GLB: a fresh scene is built (the live viewport is never touched). Procedural dolls become a hierarchy of joint nodes with
 * meshes attached (node TRS animation: opens in Blender, Unity, Unreal). Skinned characters keep their skinned meshes; every
 * bone gets a baked quaternion track sampled with the same retargeting the viewport uses. The render camera (if any) is a camera
 * node with baked position/rotation tracks (glTF 2.0 cannot animate the field of view: the FOV at the first frame is stored).
 */
import {
  AnimationClip,
  BoxGeometry,
  CanvasTexture,
  CylinderGeometry,
  DoubleSide,
  FrontSide,
  Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PerspectiveCamera,
  PlaneGeometry,
  Quaternion,
  QuaternionKeyframeTrack,
  Scene,
  SRGBColorSpace,
  SphereGeometry,
  Vector3,
  VectorKeyframeTrack,
  type BufferGeometry,
  type KeyframeTrack,
} from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { eulerToQuat, evaluateProject, quatToEuler } from '../core/interpolate';
import { objectMatrix } from '../core/ik';
import { profileOf } from '../core/body';
import { RIG, RIG_BY_NAME } from '../core/rig';
import type { JointName, Pose, Project, SceneObject, Vec3 } from '../core/types';
import { ballGeometry, BALL_JOINTS, dollParts } from '../three/dollGeometry';
import { frameCount, frameTime } from './plan';

const BODY_HEX = 0xcfcfd2;

/** A loaded skinned character that can be posed (viewport retargeter or a test double). */
export interface SkinRig {
  root: Object3D;
  /** Prepare materials/visibility for export (e.g. doll look). */
  prepare?: (o: SceneObject) => void;
  apply: (pose: Pose, hipsPos: Vec3) => void;
  dispose?: () => void;
}

export interface GlbBuildOptions {
  project: Project;
  /** Objects to export (mannequins and shapes). The render camera is included separately. */
  objects: SceneObject[];
  camera?: SceneObject | null;
  fps: number;
  /** Camera aspect (width / height of the export resolution). */
  aspect: number;
  /** Provide a skinned rig for objects whose character is a model file; return null to fall back to the procedural doll. */
  loadSkin?: (o: SceneObject) => Promise<SkinRig | null>;
  /** Pixels of a reference image (image planes become textured quads); return null when unavailable (the quad is then untextured). */
  loadImage?: (imageId: string) => Promise<CanvasImageSource | null>;
}

export interface GlbBuild {
  scene: Scene;
  clip: AnimationClip;
  frames: number;
  duration: number;
  names: string[];
  dispose: () => void;
}

const safe = (s: string) => s.replace(/[^\w\-]+/g, '_').replace(/^_+|_+$/g, '') || 'Object';

function uniqueNames(objs: SceneObject[]): string[] {
  const used = new Set<string>();
  return objs.map((o) => {
    let n = safe(o.name);
    let i = 2;
    while (used.has(n)) n = `${safe(o.name)}_${i++}`;
    used.add(n);
    return n;
  });
}

const qOf = (e: Vec3) => {
  const q = eulerToQuat(e);
  return new Quaternion(q[0], q[1], q[2], q[3]);
};

/** Keep a track only when its values change (static values are set on the node instead). */
function varying(values: number[], stride: number): boolean {
  for (let i = stride; i < values.length; i++) if (Math.abs(values[i] - values[i % stride]) > 1e-6) return true;
  return false;
}

/** Continuous quaternion stream (flip the sign when the dot product turns negative, so players interpolate the short way). */
function pushQuat(arr: number[], q: Quaternion) {
  const n = arr.length;
  let { x, y, z, w } = q;
  if (n >= 4 && arr[n - 4] * x + arr[n - 3] * y + arr[n - 2] * z + arr[n - 1] * w < 0) {
    x = -x; y = -y; z = -z; w = -w;
  }
  arr.push(x, y, z, w);
}

class TrackSet {
  readonly tracks: KeyframeTrack[] = [];
  constructor(private times: number[]) {}
  quat(node: Object3D, values: number[]) {
    node.quaternion.set(values[0], values[1], values[2], values[3]);
    if (varying(values, 4)) this.tracks.push(new QuaternionKeyframeTrack(`${node.name}.quaternion`, this.times, values));
  }
  vec(node: Object3D, prop: 'position' | 'scale', values: number[]) {
    node[prop].set(values[0], values[1], values[2]);
    if (varying(values, 3)) this.tracks.push(new VectorKeyframeTrack(`${node.name}.${prop}`, this.times, values));
  }
}

/** Build the export scene and the baked animation clip. */
export async function buildGlbScene(opt: GlbBuildOptions): Promise<GlbBuild> {
  const { project, fps } = opt;
  const n = frameCount(project, fps);
  const times = Array.from({ length: n }, (_, i) => frameTime(i, fps, project.duration));
  const samples = times.map((t) => evaluateProject({ ...project, time: t }, t));
  const find = (id: string, i: number) => samples[i].objects.find((o) => o.id === id)!;

  const scene = new Scene();
  scene.name = 'Doloyo';
  const ts = new TrackSet(times.map((t) => Math.round(t * 1e6) / 1e6));
  const disposers: (() => void)[] = [];
  const dollMat = new MeshStandardMaterial({ color: BODY_HEX, roughness: 0.85, metalness: 0, name: 'Doll' });
  const shapeMat = new MeshStandardMaterial({ color: BODY_HEX, roughness: 0.85, metalness: 0, name: 'Shape' });
  const names = uniqueNames(opt.objects);

  for (let oi = 0; oi < opt.objects.length; oi++) {
    const src = opt.objects[oi];
    const base = names[oi];
    const holder = new Group();
    holder.name = base;
    scene.add(holder);

    // object transform
    const pos: number[] = [], rot: number[] = [], scl: number[] = [];
    for (let i = 0; i < n; i++) {
      const o = find(src.id, i);
      pos.push(...o.position);
      pushQuat(rot, qOf(o.rotation));
      scl.push(...o.scale);
    }
    ts.vec(holder, 'position', pos);
    ts.quat(holder, rot);
    ts.vec(holder, 'scale', scl);

    if (src.kind === 'image' && src.image) {
      const im = src.image;
      let map: CanvasTexture | null = null;
      const pixels = opt.loadImage ? await opt.loadImage(im.imageId) : null;
      if (pixels) {
        map = new CanvasTexture(pixels as HTMLCanvasElement);
        map.colorSpace = SRGBColorSpace;
        map.name = `${base}_image`;
      }
      // quad: aspect m wide, 1 m high, scaled by the object scale; unlit so the picture keeps its colours
      const mat = new MeshBasicMaterial({ color: 0xffffff, map, transparent: true, opacity: im.opacity, side: im.doubleSided ? DoubleSide : FrontSide, name: `${base}_material` });
      disposers.push(() => {
        mat.dispose();
        map?.dispose();
      });
      const quad = new Mesh(new PlaneGeometry(im.aspect, 1), mat);
      quad.name = `${base}_mesh`;
      holder.add(quad);
      continue;
    }

    if (src.kind !== 'mannequin') {
      const geo = src.kind === 'cube' ? 'box' : src.kind;
      const mesh = new Mesh(shapeGeometry(geo), shapeMat);
      mesh.name = `${base}_mesh`;
      holder.add(mesh);
      continue;
    }

    const rig = opt.loadSkin ? await opt.loadSkin(src) : null;
    if (rig) {
      disposers.push(() => rig.dispose?.());
      rig.prepare?.(src);
      // unique bone names per object so clip bindings cannot collide
      rig.root.traverse((o) => {
        if (o !== rig.root) o.name = `${base}__${o.name}`;
      });
      holder.add(rig.root);
      const bones: Object3D[] = [];
      rig.root.traverse((o) => {
        if ((o as { isBone?: boolean }).isBone) bones.push(o);
      });
      const quat = new Map<Object3D, number[]>(bones.map((b) => [b, []]));
      const posB = new Map<Object3D, number[]>(bones.map((b) => [b, []]));
      for (let i = 0; i < n; i++) {
        const o = find(src.id, i);
        rig.apply(o.pose, o.hipsPos);
        for (const b of bones) {
          pushQuat(quat.get(b)!, b.quaternion);
          posB.get(b)!.push(b.position.x, b.position.y, b.position.z);
        }
      }
      for (const b of bones) {
        ts.quat(b, quat.get(b)!);
        ts.vec(b, 'position', posB.get(b)!);
      }
      continue;
    }

    // procedural doll: joint hierarchy with meshes
    const groups = {} as Record<JointName, Group>;
    const parts = dollParts();
    const prof = profileOf(src);
    for (const d of RIG) {
      const g = new Group();
      g.name = `${base}_${d.name}`;
      g.position.set(...prof.offset[d.name]);
      groups[d.name] = g;
      (d.parent ? groups[d.parent] : holder).add(g);
      // the volumes of the joint are scaled by the body (a holder keeps the child joints at their own offsets)
      const vol = new Group();
      vol.name = `${g.name}_volume`;
      vol.scale.setScalar(prof.mesh[d.name]);
      g.add(vol);
      if (BALL_JOINTS.has(d.name)) {
        const m = new Mesh(ballGeometry(d.ball), dollMat);
        m.name = `${g.name}_ball`;
        vol.add(m);
      }
      parts[d.name].forEach((p, k) => {
        p.geo.normalizeNormals(); // lathe normals are not unit length; keeps the exporter quiet
        const m = new Mesh(p.geo, dollMat);
        m.name = `${g.name}_mesh${k}`;
        m.position.set(...p.pos);
        if (p.quat) m.quaternion.set(...p.quat);
        if (p.scale) m.scale.set(...p.scale);
        vol.add(m);
      });
    }
    for (const d of RIG) {
      const q: number[] = [];
      for (let i = 0; i < n; i++) pushQuat(q, qOf(find(src.id, i).pose[d.name]));
      ts.quat(groups[d.name], q);
    }
    const hp: number[] = [];
    const off = prof.offset.hips;
    for (let i = 0; i < n; i++) {
      const h = find(src.id, i).hipsPos;
      hp.push(off[0] + h[0] * prof.hipsScale, off[1] + h[1] * prof.hipsScale, off[2] + h[2] * prof.hipsScale);
    }
    ts.vec(groups.hips, 'position', hp);
  }

  if (opt.camera) {
    const c = opt.camera;
    const cam = new PerspectiveCamera(find(c.id, 0).fov, opt.aspect, 0.05, 200);
    cam.name = 'RenderCamera';
    scene.add(cam);
    const pos: number[] = [], rot: number[] = [];
    const m = new Matrix4();
    for (let i = 0; i < n; i++) {
      const o = find(c.id, i);
      const eye = new Vector3(...o.position);
      const target = new Vector3(...o.target);
      if (eye.distanceToSquared(target) < 1e-10) target.z -= 1;
      m.lookAt(eye, target, new Vector3(0, 1, 0));
      pos.push(eye.x, eye.y, eye.z);
      pushQuat(rot, new Quaternion().setFromRotationMatrix(m));
    }
    ts.vec(cam, 'position', pos);
    ts.quat(cam, rot);
    names.push('RenderCamera');
  }

  const duration = n > 1 ? times[n - 1] : 0;
  const clip = new AnimationClip('Doloyo', duration, ts.tracks);
  return {
    scene,
    clip,
    frames: n,
    duration,
    names,
    dispose: () => {
      disposers.forEach((d) => d());
      dollMat.dispose();
      shapeMat.dispose();
    },
  };
}

function shapeGeometry(kind: string): BufferGeometry {
  if (kind === 'sphere') return new SphereGeometry(0.25, 32, 20);
  if (kind === 'cylinder') return new CylinderGeometry(0.2, 0.2, 0.5, 32);
  return new BoxGeometry(0.5, 0.5, 0.5);
}

/** Serialize a built scene (+ clip) to a binary glTF. */
export async function writeGlb(b: GlbBuild): Promise<Uint8Array> {
  const exporter = new GLTFExporter();
  const out = (await exporter.parseAsync(b.scene, { binary: true, trs: true, onlyVisible: true, animations: b.clip.tracks.length ? [b.clip] : [], maxTextureSize: 1024 })) as ArrayBuffer;
  return new Uint8Array(out);
}

// ---------------- BVH ----------------

const f4 = (n: number) => (Math.abs(n) < 5e-7 ? 0 : n).toFixed(4);

/** BVH of one mannequin (17 joints, Y up, +Z forward, centimeters). Joint rotations are Euler XYZ (channel order X, Y, Z). */
export function buildBvh(project: Project, obj: SceneObject, fps: number): string {
  const n = frameCount(project, fps);
  const prof = profileOf(obj);
  const lines: string[] = ['HIERARCHY'];
  const kids = (j: JointName | null) => RIG.filter((d) => d.parent === j);
  const emit = (name: JointName, depth: number) => {
    const d = RIG_BY_NAME[name];
    const pad = '  '.repeat(depth);
    const off = d.parent ? prof.offset[name] : ([0, 0, 0] as Vec3);
    lines.push(`${pad}${d.parent ? 'JOINT' : 'ROOT'} ${name}`, `${pad}{`, `${pad}  OFFSET ${off.map((v) => f4(v * 100)).join(' ')}`);
    lines.push(`${pad}  CHANNELS ${d.parent ? 3 : 6} ${d.parent ? '' : 'Xposition Yposition Zposition '}Xrotation Yrotation Zrotation`);
    const ch = kids(name);
    if (!ch.length) {
      const seg = d.segs[0];
      const sc = prof.mesh[name];
      const end: Vec3 = seg ? [seg.to[0] * sc, seg.to[1] * sc, seg.to[2] * sc] : d.ovoid ? [0, 0.22 * sc, 0] : [0, 0.05 * sc, 0];
      lines.push(`${pad}  End Site`, `${pad}  {`, `${pad}    OFFSET ${end.map((v) => f4(v * 100)).join(' ')}`, `${pad}  }`);
    }
    ch.forEach((c) => emit(c.name, depth + 1));
    lines.push(`${pad}}`);
  };
  emit('hips', 0);
  lines.push('MOTION', `Frames: ${n}`, `Frame Time: ${(1 / fps).toFixed(6)}`);
  const order: JointName[] = [];
  const walk = (name: JointName) => {
    order.push(name);
    kids(name).forEach((c) => walk(c.name));
  };
  walk('hips');
  for (let i = 0; i < n; i++) {
    const t = frameTime(i, fps, project.duration);
    const o = evaluateProject({ ...project, time: t }, t).objects.find((x) => x.id === obj.id)!;
    const root = prof.offset.hips;
    const k = prof.hipsScale;
    const p = new Vector3(root[0] + o.hipsPos[0] * k, root[1] + o.hipsPos[1] * k, root[2] + o.hipsPos[2] * k).applyMatrix4(objectMatrix(o));
    const vals: number[] = [];
    for (const j of order) {
      let e = o.pose[j];
      if (j === 'hips') {
        const q = qOf(o.rotation).multiply(qOf(o.pose.hips));
        e = quatToEuler([q.x, q.y, q.z, q.w]);
        vals.push(p.x * 100, p.y * 100, p.z * 100);
      }
      vals.push(e[0], e[1], e[2]);
    }
    lines.push(vals.map(f4).join(' '));
  }
  return lines.join('\n') + '\n';
}
