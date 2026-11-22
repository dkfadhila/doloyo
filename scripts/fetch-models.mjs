// One-time setup for Copy Dance: copies the MediaPipe WASM runtime and downloads the pose model, so nothing is
// fetched from a CDN at runtime and videos never leave the machine.
//   npm run fetch-models              (full model, ~9 MB)
//   npm run fetch-models -- --heavy   (also the heavy model, ~30 MB)
import { cpSync, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(root, 'public', 'mediapipe');
const wasmSrc = resolve(root, 'node_modules', '@mediapipe', 'tasks-vision', 'wasm');
const BASE = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker';
const models = [{ file: 'pose_landmarker_full.task', url: `${BASE}/pose_landmarker_full/float16/latest/pose_landmarker_full.task` }];
if (process.argv.includes('--heavy')) models.push({ file: 'pose_landmarker_heavy.task', url: `${BASE}/pose_landmarker_heavy/float16/latest/pose_landmarker_heavy.task` });

if (!existsSync(wasmSrc)) {
  console.error('node_modules/@mediapipe/tasks-vision is missing. Run "npm install" first.');
  process.exit(1);
}
mkdirSync(out, { recursive: true });
cpSync(wasmSrc, resolve(out, 'wasm'), { recursive: true });
console.log('copied WASM runtime -> public/mediapipe/wasm');

for (const m of models) {
  const dest = resolve(out, m.file);
  if (existsSync(dest) && statSync(dest).size > 1_000_000) {
    console.log(`${m.file}: already present (${(statSync(dest).size / 1048576).toFixed(1)} MB)`);
    continue;
  }
  console.log(`downloading ${m.file} ...`);
  const res = await fetch(m.url);
  if (!res.ok) {
    console.error(`download failed (HTTP ${res.status}) for ${m.url}`);
    process.exit(1);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  writeFileSync(dest, buf);
  console.log(`${m.file}: ${(buf.length / 1048576).toFixed(1)} MB`);
}
console.log('done. Model: MediaPipe Pose Landmarker (Apache-2.0).');
