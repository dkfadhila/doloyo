// Dev-time helper used by prepare-assets.sh.
//   node scripts/gltf-strip.mjs <in> <out> --no-anims      keep mesh + skeleton, drop animations
//   node scripts/gltf-strip.mjs <in> <out> --anims-only    keep skeleton nodes + animations, drop meshes/skins/materials
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { prune, dedup } from '@gltf-transform/functions';

const [, , input, output, mode] = process.argv;
if (!input || !output || !['--no-anims', '--anims-only'].includes(mode)) {
  console.error('usage: gltf-strip.mjs <in> <out> --no-anims|--anims-only');
  process.exit(1);
}
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(input);
const root = doc.getRoot();

if (mode === '--no-anims') {
  for (const a of root.listAnimations()) {
    a.listChannels().forEach((c) => c.dispose());
    a.listSamplers().forEach((c) => c.dispose());
    a.dispose();
  }
} else {
  for (const n of root.listNodes()) {
    if (n.getMesh()) n.setMesh(null);
    if (n.getSkin()) n.setSkin(null);
  }
  root.listSkins().forEach((s) => s.dispose());
  root.listMeshes().forEach((m) => m.dispose());
  root.listMaterials().forEach((m) => m.dispose());
  root.listTextures().forEach((t) => t.dispose());
}
await doc.transform(prune({ keepLeaves: true }), dedup());
await io.write(output, doc);
console.log(`${output}: nodes=${root.listNodes().length} meshes=${root.listMeshes().length} anims=${root.listAnimations().length}`);
