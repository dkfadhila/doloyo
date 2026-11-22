// Dev-time helper used by prepare-assets.sh.
//   node scripts/merge-hair.mjs <body.glb> <hair.gltf> <out.glb>
// Copies the hair mesh of a Quaternius "Rigged to Head Bone" hairstyle into the body file and binds it to the BODY skeleton
// (the hair and the body share the same 65-bone Unreal-style rig, matched by bone name), so the hair follows the head bone.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { mergeDocuments, unpartition } from '@gltf-transform/functions';

const [, , bodyPath, hairPath, outPath] = process.argv;
if (!bodyPath || !hairPath || !outPath) {
  console.error('usage: merge-hair.mjs <body.glb> <hair.gltf> <out.glb>');
  process.exit(1);
}
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const body = await io.read(bodyPath);
const hair = await io.read(hairPath);
const bodyNodes = new Map(body.getRoot().listNodes().map((n) => [n.getName(), n]));
const bodySkin = body.getRoot().listSkins()[0];
const scene = body.getRoot().listScenes()[0];

const map = mergeDocuments(body, hair);
const hairMeshNode = hair.getRoot().listNodes().find((n) => n.getMesh() && n.getSkin());
if (!hairMeshNode) throw new Error('hair file has no skinned mesh node');
const newNode = map.get(hairMeshNode);
const newSkin = newNode.getSkin();

// re-point the merged skin at the body's own bones (same names), keeping the joint order and inverse bind matrices
const joints = newSkin.listJoints();
const replacement = joints.map((j) => {
  const t = bodyNodes.get(j.getName());
  if (!t) throw new Error('body has no bone named ' + j.getName());
  return t;
});
joints.forEach((j) => newSkin.removeJoint(j));
replacement.forEach((t) => newSkin.addJoint(t));
const sk = newSkin.getSkeleton();
if (sk) newSkin.setSkeleton(bodyNodes.get(sk.getName()) ?? bodySkin.getSkeleton());

// the hair mesh node goes next to the body meshes; the duplicated armature is dropped
newNode.getParentNode()?.removeChild(newNode);
scene.addChild(newNode);
for (const n of hair.getRoot().listNodes()) {
  const m = map.get(n);
  if (m && m !== newNode) m.dispose();
}
for (const s of hair.getRoot().listScenes()) map.get(s)?.dispose();
await body.transform(unpartition());
await io.write(outPath, body);
console.log(`${outPath}: hair ${newNode.getName()} bound to ${replacement.length} body bones`);
