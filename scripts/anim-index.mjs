// Writes public/assets/anims/index.json (clip names + durations) so the app can list clips without downloading the GLBs.
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { writeFileSync } from 'node:fs';

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const clips = [];
for (const file of ['ual1', 'ual2']) {
  const doc = await io.read(`public/assets/anims/${file}.glb`);
  for (const a of doc.getRoot().listAnimations()) {
    let d = 0;
    for (const s of a.listSamplers()) d = Math.max(d, s.getInput()?.getMax([])[0] ?? 0);
    clips.push({ id: `${file}/${a.getName()}`, file, name: a.getName(), duration: Math.round(d * 1000) / 1000 });
  }
}
writeFileSync('public/assets/anims/index.json', JSON.stringify({ license: 'CC0 1.0, Quaternius', clips }, null, 1));
console.log(`index.json: ${clips.length} clips`);
