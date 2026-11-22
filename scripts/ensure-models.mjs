// prebuild hook: make sure public/mediapipe exists so the production build ships the local Copy Dance model.
// public/mediapipe is generated (gitignored). If it is missing, run fetch-models; if that fails (offline CI),
// warn and continue: the app falls back to the pinned CDN copies at runtime.
//   SKIP_MODELS=1 npm run build   skips the download entirely
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const mp = resolve(root, 'public', 'mediapipe');
const ok = existsSync(resolve(mp, 'pose_landmarker_full.task')) && existsSync(resolve(mp, 'wasm', 'vision_wasm_internal.wasm'));

if (ok) {
  console.log('[ensure-models] public/mediapipe present, using local files');
} else if (process.env.SKIP_MODELS) {
  console.warn('[ensure-models] SKIP_MODELS set: Copy Dance will load the model from the CDN at runtime');
} else {
  console.log('[ensure-models] public/mediapipe missing, running fetch-models ...');
  const r = spawnSync(process.execPath, [resolve(root, 'scripts', 'fetch-models.mjs')], { stdio: 'inherit' });
  if (r.status !== 0) console.warn('[ensure-models] fetch-models failed; the build continues and Copy Dance will load the model from the CDN at runtime');
}
