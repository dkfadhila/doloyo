import type { VRM } from '@pixiv/three-vrm';
import type { Object3D } from 'three';
import { JOINTS } from '../core/rig';
import { CUSTOM_PREFIX, type JointName } from '../core/types';
import { parseFile } from './loader';
import { saveCustomCharacter } from './store';
import { type BoneMap, type CharacterDef } from './registry';

const RIG_PREFIX = /^(mixamorig|bip01|bip|armature|j|c|def|cc_base|b)$/;

/** "mixamorig:LeftForeArm" -> ['left','fore','arm'], "upperarm_l" -> ['upperarm','l'], "J_Bip_L_UpperArm" -> ['l','upper','arm'] */
export function tokens(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .filter((t, i, a) => !(RIG_PREFIX.test(t) && i < a.length - 1));
}

type Side = 'L' | 'R' | null;
function splitSide(tok: string[]): { side: Side; part: string } {
  let side: Side = null;
  const rest: string[] = [];
  tok.forEach((t, i) => {
    if (t === 'left' || (t === 'l' && (i === 0 || i === tok.length - 1))) side = 'L';
    else if (t === 'right' || (t === 'r' && (i === 0 || i === tok.length - 1))) side = 'R';
    else rest.push(t);
  });
  // "LeftArm" style names glued into one token ("leftarm") when the source had no case change
  if (!side && rest.length === 1) {
    const m = /^(left|right)(.+)$/.exec(rest[0]);
    if (m) return { side: m[1] === 'left' ? 'L' : 'R', part: m[2] };
  }
  return { side, part: rest.join('') };
}

const PART: [RegExp, string][] = [
  [/^(upperarm|arm|uparm|upperarm1)$/, 'shoulder'],
  [/^(lowerarm|forearm|lowarm|elbow)$/, 'elbow'],
  [/^hand$/, 'wrist'],
  [/^(thigh|upperleg|upleg|leg1|upperleg1)$/, 'hip'],
  [/^(calf|lowerleg|shin|lowleg|leg2|leg)$/, 'knee'],
  [/^foot$/, 'ankle'],
];

/** Best-effort mapping of common rigs (Unreal/Quaternius, Mixamo, generic Hips/Spine/LeftArm...) to our 17 joints. */
export function guessBones(names: string[]): BoneMap {
  const map: BoneMap = {};
  const spines: string[] = [];
  for (const raw of names) {
    const { side, part } = splitSide(tokens(raw));
    if (!part) continue;
    if (!side) {
      if (/^(hips|pelvis|hip|root)$/.test(part) && !(part === 'root' && names.some((n) => /pelvis|hips/i.test(n)))) map.hips ??= raw;
      else if (/^(spine\d*|chest|upperchest|abdomen|torso)$/.test(part)) spines.push(raw);
      else if (/^neck\d*$/.test(part)) map.neck ??= raw;
      else if (part === 'head') map.head ??= raw;
      continue;
    }
    for (const [re, j] of PART) {
      if (re.test(part)) {
        const key = `${side}_${j}` as JointName;
        // "leg" alone is the thigh in some rigs (Mixamo "LeftLeg" is the shin, handled by order: first thigh wins)
        if (!map[key]) map[key] = raw;
        break;
      }
    }
  }
  if (spines.length) {
    map.spine = spines[0];
    map.chest = spines[spines.length - 1];
  }
  return map;
}

/** Child bone used to define the direction of hands and feet (middle finger base, toes). */
export function guessHints(root: Object3D, map: BoneMap): Record<string, string> {
  const hints: Record<string, string> = {};
  const pick = (joint: JointName, prefer: RegExp) => {
    const b = map[joint] ? root.getObjectByName(map[joint]!) : null;
    if (!b) return;
    const kids = b.children.filter((c) => c.name && !(c as { isMesh?: boolean }).isMesh);
    const best = kids.find((c) => prefer.test(c.name.toLowerCase())) ?? kids[0];
    if (best) hints[joint] = best.name;
  };
  for (const s of ['L', 'R']) {
    pick(`${s}_wrist` as JointName, /middle/);
    pick(`${s}_ankle` as JointName, /toe|ball/);
  }
  return hints;
}

const VRM_BONES: Partial<Record<JointName, string[]>> = {
  hips: ['hips'], spine: ['spine'], chest: ['upperChest', 'chest'], neck: ['neck'], head: ['head'],
  L_shoulder: ['leftUpperArm'], L_elbow: ['leftLowerArm'], L_wrist: ['leftHand'],
  R_shoulder: ['rightUpperArm'], R_elbow: ['rightLowerArm'], R_wrist: ['rightHand'],
  L_hip: ['leftUpperLeg'], L_knee: ['leftLowerLeg'], L_ankle: ['leftFoot'],
  R_hip: ['rightUpperLeg'], R_knee: ['rightLowerLeg'], R_ankle: ['rightFoot'],
};

/** Mapping from the VRM humanoid (raw bone nodes; the retargeter does not need normalised bones). */
export function vrmBones(vrm: VRM): { map: BoneMap; hints: Record<string, string>; blends: { bone: string; from: JointName; to: JointName; t: number }[] } {
  const map: BoneMap = {};
  const raw = (n: string) => vrm.humanoid.getRawBoneNode(n as never)?.name;
  for (const j of JOINTS) {
    for (const n of VRM_BONES[j] ?? []) {
      const name = raw(n);
      if (name) {
        map[j] = name;
        break;
      }
    }
  }
  const hints: Record<string, string> = {};
  for (const [j, n] of [['L_wrist', 'leftMiddleProximal'], ['R_wrist', 'rightMiddleProximal'], ['L_ankle', 'leftToes'], ['R_ankle', 'rightToes']] as const) {
    const name = raw(n);
    if (name) hints[j] = name;
  }
  const blends: { bone: string; from: JointName; to: JointName; t: number }[] = [];
  if (raw('upperChest') && raw('chest')) blends.push({ bone: raw('chest')!, from: 'spine', to: 'chest', t: 0.5 });
  return { map, hints, blends };
}

export interface Analysis {
  kind: 'glb' | 'vrm';
  name: string;
  nodeNames: string[];
  map: BoneMap;
  hints: Record<string, string>;
  blends: { bone: string; from: JointName; to: JointName; t: number }[];
  skinned: boolean;
  /** Joints that could not be mapped. */
  missing: JointName[];
}

export async function analyzeFile(file: File): Promise<Analysis> {
  const { gltf, vrm, kind } = await parseFile(file);
  const nodeNames: string[] = [];
  let skinned = false;
  gltf.scene.traverse((o) => {
    if ((o as { isSkinnedMesh?: boolean }).isSkinnedMesh) skinned = true;
    else if (o.name && !(o as { isMesh?: boolean }).isMesh) nodeNames.push(o.name);
  });
  if (!skinned) throw new Error('This file has no skinned mesh (no skeleton), so it cannot be posed.');
  let map: BoneMap, hints: Record<string, string>, blends: Analysis['blends'] = [];
  if (vrm) ({ map, hints, blends } = vrmBones(vrm));
  else {
    map = guessBones(nodeNames);
    hints = guessHints(gltf.scene, map);
  }
  return { kind, name: file.name.replace(/\.[^.]+$/, ''), nodeNames, map, hints, blends, skinned, missing: JOINTS.filter((j) => !map[j]) };
}

export function newCustomId(): string {
  return CUSTOM_PREFIX + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

export async function commitImport(file: File, a: Analysis, map: BoneMap, label: string): Promise<CharacterDef> {
  const def: CharacterDef = {
    id: newCustomId(),
    label: label.trim() || a.name,
    kind: a.kind,
    url: '',
    bones: map,
    defaultMaterial: 'original',
    custom: true,
    calibration: {
      childHints: a.hints,
      blends: a.blends,
    },
  };
  await saveCustomCharacter(def, file);
  return def;
}
