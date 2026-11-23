// Automated smoke test: spawns dist/index.js over stdio, talks MCP, and plays a fake browser over WebSocket.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import WebSocket from 'ws';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 17000 + Math.floor(Math.random() * 2000);
const ORIGIN = 'http://localhost:5173';
const outDir = mkdtempSync(join(tmpdir(), 'motion-doll-smoke-'));
let passed = 0;
const ok = (name) => console.log('  ok  ' + name) || passed++;

const EXPECTED_TOOLS = [
  'bridge_status', 'guide_read', 'scene_get', 'object_add', 'object_remove', 'object_transform', 'joint_set',
  'pose_apply', 'pose_save', 'pose_delete', 'pose_mirror', 'joint_reset', 'key_add', 'key_remove', 'key_move',
  'key_set_easing', 'timeline_set', 'playhead_seek', 'batch', 'undo', 'redo', 'viewport_snapshot', 'render_export',
  'object_set_character', 'anim_list', 'anim_apply', 'mocap_from_video',
  'keys_edit', 'keys_remove', 'ik_reach', 'ik_pin', 'ik_bake', 'camera_set', 'scene_preset', 'object_set_body',
];

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [join(root, 'dist', 'index.js')],
  env: { ...process.env, MOTION_DOLL_PORT: String(PORT) },
  stderr: 'pipe',
});
let stderr = '';
transport.stderr?.on('data', (d) => (stderr += d));
const client = new Client({ name: 'smoke', version: '0.0.0' });

const textOf = (r) => r.content.filter((c) => c.type === 'text').map((c) => c.text).join('\n');
const json = (r) => JSON.parse(textOf(r));

/** Open a socket and resolve with how the handshake went. */
function open(origin, code) {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}`, origin ? { origin } : {});
    const messages = [];
    ws.on('message', (m) => messages.push(JSON.parse(m.toString())));
    ws.on('unexpected-response', (_req, res) => resolve({ rejected: res.statusCode }));
    ws.on('error', () => {});
    ws.on('open', () => ws.send(JSON.stringify({ type: 'hello', code })));
    ws.on('close', (closeCode) => resolve({ closeCode, ws, messages }));
    const t = setInterval(() => {
      if (messages.some((m) => m.type === 'welcome')) {
        clearInterval(t);
        resolve({ ws, messages, welcome: true });
      }
    }, 10);
  });
}

try {
  // CLI: --help / --version / bad flag (no server is started)
  const cli = (...args) => spawnSync(process.execPath, [join(root, 'dist', 'index.js'), ...args], { encoding: 'utf8', timeout: 10000 });
  const help = cli('--help');
  assert.equal(help.status, 0);
  assert.match(help.stdout, /Usage: motion-doll-mcp/);
  assert.match(help.stdout, /--origin <url>/);
  assert.match(help.stdout, /--allow-hosted/);
  const pkgVersion = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
  assert.equal(cli('--version').stdout.trim(), pkgVersion);
  assert.equal(cli('--nope').status, 2);
  assert.equal(cli('--origin', 'not-a-url').status, 2);
  assert.match(readFileSync(join(root, 'dist', 'index.js'), 'utf8').split('\n')[0], /^#!\/usr\/bin\/env node/);
  ok('CLI: --help, --version, bad flags rejected, shebang kept');

  await client.connect(transport);

  // tools
  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name);
  for (const n of EXPECTED_TOOLS) assert.ok(names.includes(n), `missing tool ${n}`);
  assert.equal(names.length, EXPECTED_TOOLS.length, 'unexpected extra tools: ' + names.filter((n) => !EXPECTED_TOOLS.includes(n)));
  assert.ok(tools.every((t) => t.description && t.description.length > 10), 'every tool needs a description');
  ok(`listTools (${names.length} tools)`);

  // bridge_status + pairing file
  const status = json(await client.callTool({ name: 'bridge_status', arguments: {} }));
  assert.equal(status.connected, false);
  assert.match(status.pairingCode, /^\d{6}$/);
  assert.equal(status.port, PORT);
  const fileCode = readFileSync(join(tmpdir(), 'motion-doll-pairing.txt'), 'utf8').trim();
  assert.equal(fileCode, status.pairingCode);
  assert.match(stderr, /Pairing code: \d{6}/);
  ok('bridge_status + pairing file + stderr banner');
  const code = status.pairingCode;

  // guide
  const guide = textOf(await client.callTool({ name: 'guide_read', arguments: {} }));
  assert.match(guide, /Motion Doll/);
  ok('guide_read');

  // no browser
  const noBrowser = await client.callTool({ name: 'scene_get', arguments: {} });
  assert.equal(noBrowser.isError, true);
  assert.match(textOf(noBrowser), /pairing code/i);
  assert.ok(textOf(noBrowser).includes(code));
  ok('scene_get without browser -> error mentioning the pairing code');

  // security
  const badOrigin = await open('http://evil.example', code);
  assert.equal(badOrigin.rejected, 403);
  const noOrigin = await open(undefined, code);
  assert.equal(noOrigin.rejected, 403);
  ok('bad / missing Origin rejected with 403');

  // --origin (repeatable, normalized to an origin) and --allow-hosted on a second server instance
  {
    const { spawn } = await import('node:child_process');
    const port2 = PORT + 2500;
    const child = spawn(process.execPath, [join(root, 'dist', 'index.js'), '--allow-hosted', '--origin', 'https://studio.example.com/some/path', '--origin=https://b.example.org'], {
      env: { ...process.env, MOTION_DOLL_PORT: String(port2) },
      stdio: ['pipe', 'ignore', 'pipe'],
    });
    try {
      await new Promise((res, rej) => {
        child.stderr.on('data', (d) => /listening/.test(String(d)) && res());
        child.on('exit', () => rej(new Error('second server exited early')));
        setTimeout(() => rej(new Error('second server did not start')), 8000);
      });
      const probe = (origin) =>
        new Promise((res) => {
          const ws = new WebSocket(`ws://127.0.0.1:${port2}`, { origin });
          ws.on('unexpected-response', (_q, r) => res(r.statusCode));
          ws.on('error', () => {});
          ws.on('open', () => (ws.close(), res('open')));
        });
      assert.equal(await probe('https://studio.example.com'), 'open');
      assert.equal(await probe('https://b.example.org'), 'open');
      assert.equal(await probe('https://evil.example.com'), 403);
      ok('--origin (repeatable) and --allow-hosted: configured origins accepted, others 403');
    } finally {
      child.kill();
    }
  }
  const wrong = await open(ORIGIN, code === '000000' ? '111111' : '000000');
  assert.equal(wrong.closeCode, 4001);
  ok('wrong pairing code closed with 4001');

  // fake browser
  const calls = [];
  const b = await open(ORIGIN, code);
  assert.equal(b.welcome, true);
  const PNG_1X1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
  const GLB_BYTES = Buffer.concat([Buffer.from('glTF'), Buffer.from([2, 0, 0, 0, 12, 0, 0, 0])]);
  const renderBytes = [Buffer.from('chunk-zero-'), Buffer.from('chunk-one'), Buffer.from('-end')];
  const uploads = [];
  const answer = (ws) =>
    ws.on('message', (raw) => {
      const m = JSON.parse(raw.toString());
      if (m.type !== 'call') return;
      calls.push(m);
      const reply = (data) => ws.send(JSON.stringify({ id: m.id, type: 'result', ok: true, data }));
      if (m.method === 'dispatch') {
        if (m.params.type === 'object_remove') return ws.send(JSON.stringify({ id: m.id, type: 'result', ok: false, error: 'Object not found: nope' }));
        return reply({ ok: true, echo: m.params });
      }
      if (m.method === 'anim_list') return reply({ total: 86, count: 1, clips: [{ id: 'ual1/Dance_Loop', name: 'Dance_Loop', duration: 1, loop: true }] });
      if (m.method === 'anim_apply') return reply({ ok: true, clip: 'ual1/Dance_Loop', keysPerChannel: 31, echo: m.params });
      if (m.method === 'mocap_upload') {
        uploads.push(m.params);
        return reply({ ok: true, received: uploads.length, total: m.params.total });
      }
      if (m.method === 'mocap_from_video') return reply({ ok: true, tracks: [{ track: 1, frames: 90 }], applied: { assigned: [{ track: 1, object: 'Mannequin 1', keysPerChannel: 90 }] }, echo: m.params });
      if (m.method === 'scene_get') return reply({ fps: 30, duration: 4, objects: [{ id: 'o1', name: 'Mannequin 1' }] });
      if (m.method === 'undo' || m.method === 'redo') return reply({ ok: true, steps: m.params.steps ?? 1 });
      if (m.method === 'viewport_snapshot') return reply({ mimeType: 'image/png', width: 960, height: 540, data: PNG_1X1 });
      if (m.method === 'render_export') {
        const glb = m.params.format === 'glb';
        const bytes = glb ? [GLB_BYTES] : renderBytes;
        bytes.forEach((buf, seq) => ws.send(JSON.stringify({ id: m.id, type: 'chunk', seq, data: buf.toString('base64') })));
        return reply(
          glb
            ? { filename: 'Untitled.glb', ext: 'glb', mime: 'model/gltf-binary', bytes: GLB_BYTES.length, chunks: 1, width: 0, height: 0, fps: m.params.fps ?? 30, frames: 121 }
            : { filename: 'Untitled.webm', ext: 'webm', mime: 'video/webm', bytes: Buffer.concat(renderBytes).length, chunks: renderBytes.length, width: 1280, height: 720, fps: 30, frames: 121 },
        );
      }
    });
  answer(b.ws);

  const st2 = json(await client.callTool({ name: 'bridge_status', arguments: {} }));
  assert.equal(st2.connected, true);
  ok('browser pairs with correct origin + code, bridge_status.connected');

  const scene = json(await client.callTool({ name: 'scene_get', arguments: {} }));
  assert.equal(scene.fps, 30);
  assert.equal(calls.at(-1).method, 'scene_get');
  ok('scene_get round trip');

  const disp = json(await client.callTool({ name: 'joint_set', arguments: { object: 'Mannequin 1', joint: 'head', rotation: [0, 20, 0] } }));
  assert.deepEqual(calls.at(-1).params, { type: 'joint_set', object: 'Mannequin 1', joint: 'head', rotation: [0, 20, 0] });
  assert.equal(disp.ok, true);
  ok('joint_set forwards as dispatch');

  const batch = await client.callTool({
    name: 'batch',
    arguments: { commands: [{ type: 'pose_apply', object: 'Mannequin 1', pose: 'wave_up' }, { type: 'key_add', object: 'Mannequin 1', frame: 0 }] },
  });
  assert.notEqual(batch.isError, true);
  assert.equal(calls.at(-1).params.type, 'batch');
  assert.equal(calls.at(-1).params.commands.length, 2);
  ok('batch forwards');

  const rejected = await client.callTool({ name: 'object_remove', arguments: { object: 'nope' } });
  assert.equal(rejected.isError, true);
  assert.match(textOf(rejected), /Object not found/);
  ok('browser error propagates as isError');

  // depending on SDK version invalid input is a JSON-RPC error (throws) or an isError result
  let invalidMsg = '';
  try {
    const invalid = await client.callTool({ name: 'joint_set', arguments: { object: 'x', joint: 'tail', rotation: [0, 0, 0] } });
    assert.equal(invalid.isError, true);
    invalidMsg = textOf(invalid);
  } catch (e) {
    invalidMsg = String(e.message);
  }
  assert.match(invalidMsg, /Invalid enum value|invalid/i);
  assert.ok(!calls.some((c) => c.params?.joint === 'tail'), 'invalid call must not reach the browser');
  ok('zod validation rejects unknown joint');

  const setChar = json(await client.callTool({ name: 'object_set_character', arguments: { object: 'Mannequin 1', character: 'superhero-m', material: 'original' } }));
  assert.deepEqual(calls.at(-1).params, { type: 'object_set_character', object: 'Mannequin 1', character: 'superhero-m', material: 'original' });
  assert.equal(setChar.ok, true);
  ok('object_set_character forwards as dispatch');

  const bad = await client.callTool({ name: 'object_set_character', arguments: { object: 'Mannequin 1', character: 'x', material: 'shiny' } }).catch((e) => ({ isError: true, content: [{ type: 'text', text: String(e.message) }] }));
  assert.equal(bad.isError, true);
  ok('object_set_character validates material');

  const setBody = json(await client.callTool({ name: 'object_set_body', arguments: { object: 'Mannequin 1', preset: 'kecil', heightScale: 1.05, gender: 'f' } }));
  assert.deepEqual(calls.at(-1).params, { type: 'object_set_body', object: 'Mannequin 1', preset: 'kecil', heightScale: 1.05, gender: 'f' });
  assert.equal(setBody.ok, true);
  for (const args of [{ object: 'Mannequin 1', preset: 'giant' }, { object: 'Mannequin 1', heightScale: 1.5 }, { object: 'Mannequin 1', gender: 'x' }]) {
    const n = calls.length;
    const badBody = await client.callTool({ name: 'object_set_body', arguments: args }).catch((e) => ({ isError: true, content: [{ type: 'text', text: String(e.message) }] }));
    assert.equal(badBody.isError, true);
    assert.equal(calls.length, n, 'invalid body must not reach the browser');
  }
  await client.callTool({ name: 'object_add', arguments: { kind: 'mannequin', name: 'Bayi', body: { preset: 'kecil', gender: 'm' } } });
  assert.deepEqual(calls.at(-1).params, { type: 'object_add', kind: 'mannequin', name: 'Bayi', body: { preset: 'kecil', gender: 'm' } });
  ok('object_set_body / object_add body forward as dispatch and validate preset, heightScale and gender');

  const list = json(await client.callTool({ name: 'anim_list', arguments: { query: 'dance' } }));
  assert.equal(calls.at(-1).method, 'anim_list');
  assert.deepEqual(calls.at(-1).params, { query: 'dance' });
  assert.equal(list.clips[0].id, 'ual1/Dance_Loop');
  ok('anim_list round trip');

  const ap = json(await client.callTool({ name: 'anim_apply', arguments: { clip: 'Dance_Loop', objects: ['Mannequin 1'], speed: 1.5, loops: 2, keyEvery: 2, mirror: true, inPlace: true } }));
  assert.equal(calls.at(-1).method, 'anim_apply');
  assert.deepEqual(calls.at(-1).params, { clip: 'Dance_Loop', objects: ['Mannequin 1'], speed: 1.5, loops: 2, keyEvery: 2, mirror: true, inPlace: true });
  assert.equal(ap.keysPerChannel, 31);
  ok('anim_apply forwards its options');

  const apBad = await client.callTool({ name: 'anim_apply', arguments: { clip: 'x', loops: 0 } }).catch((e) => ({ isError: true, content: [{ type: 'text', text: String(e.message) }] }));
  assert.equal(apBad.isError, true);
  ok('anim_apply validates loops');

  // mocap: the server reads the file and streams it in chunks; the fake browser reassembles it
  const video = Buffer.alloc(7_000_000, 7);
  video.write('ftypmp42', 4);
  const videoPath = join(outDir, 'dance.mp4');
  writeFileSync(videoPath, video);
  const mo = json(await client.callTool({ name: 'mocap_from_video', arguments: { path: videoPath, maxPeople: 2, assign: [{ track: 1, object: 'Mannequin 1' }], smoothing: 0.3, footLock: true } }));
  assert.equal(uploads.length, 3, 'a 7 MB file is sent as 3 chunks');
  assert.deepEqual(Buffer.concat(uploads.sort((a, b) => a.seq - b.seq).map((u) => Buffer.from(u.data, 'base64'))), video);
  assert.equal(new Set(uploads.map((u) => u.uploadId)).size, 1);
  const last = calls.at(-1);
  assert.equal(last.method, 'mocap_from_video');
  assert.equal(last.params.uploadId, uploads[0].uploadId);
  assert.equal(last.params.maxPeople, 2);
  assert.equal(last.params.mime, 'video/mp4');
  assert.equal(last.params.path, undefined, 'the local path must not be forwarded to the browser');
  assert.equal(mo.tracks[0].track, 1);
  ok('mocap_from_video streams the file in chunks and forwards options');

  const noFile = await client.callTool({ name: 'mocap_from_video', arguments: { path: join(outDir, 'missing.mp4') } });
  assert.equal(noFile.isError, true);
  assert.match(textOf(noFile), /not found/i);
  const relPath = await client.callTool({ name: 'mocap_from_video', arguments: { path: 'relative.mp4' } });
  assert.equal(relPath.isError, true);
  assert.match(textOf(relPath), /absolute/i);
  ok('mocap_from_video rejects missing and relative paths');

  // ---- phase 3: IK, pins, camera, presets, bezier easing, key editing ----
  const reach = json(await client.callTool({ name: 'ik_reach', arguments: { object: 'Mannequin 1', limb: 'L_arm', target: [0.4, 1.4, 0.3], poleAngle: 20 } }));
  assert.deepEqual(calls.at(-1).params, { type: 'ik_reach', object: 'Mannequin 1', limb: 'L_arm', target: [0.4, 1.4, 0.3], poleAngle: 20 });
  assert.equal(reach.ok, true);
  const reachPole = await client.callTool({ name: 'ik_reach', arguments: { object: 'Mannequin 1', limb: 'R_leg', target: [0, 0.3, 0.4], pole: [0, 0.5, 2] } });
  assert.notEqual(reachPole.isError, true);
  assert.deepEqual(calls.at(-1).params.pole, [0, 0.5, 2]);
  const badLimb = await client.callTool({ name: 'ik_reach', arguments: { object: 'x', limb: 'L_wing', target: [0, 0, 0] } }).catch((e) => ({ isError: true, content: [{ type: 'text', text: String(e.message) }] }));
  assert.equal(badLimb.isError, true);
  const badTarget = await client.callTool({ name: 'ik_reach', arguments: { object: 'x', limb: 'L_arm', target: [0, 0] } }).catch((e) => ({ isError: true, content: [{ type: 'text', text: String(e.message) }] }));
  assert.equal(badTarget.isError, true);
  ok('ik_reach forwards (target, pole, poleAngle) and validates limb / target');

  await client.callTool({ name: 'ik_pin', arguments: { object: 'Mannequin 1', limb: 'L_foot', pinned: true, position: [0.09, 0.08, 0.1] } });
  assert.deepEqual(calls.at(-1).params, { type: 'ik_pin', object: 'Mannequin 1', limb: 'L_foot', pinned: true, position: [0.09, 0.08, 0.1] });
  await client.callTool({ name: 'ik_bake', arguments: { object: 'Mannequin 1', start: 0, end: 2 } });
  assert.deepEqual(calls.at(-1).params, { type: 'ik_bake', object: 'Mannequin 1', start: 0, end: 2 });
  ok('ik_pin and ik_bake forward as dispatch');

  await client.callTool({ name: 'camera_set', arguments: { position: [3, 1.6, 4], target: [0, 1, 0], fov: 35 } });
  assert.deepEqual(calls.at(-1).params, { type: 'camera_set', position: [3, 1.6, 4], target: [0, 1, 0], fov: 35 });
  const badFov = await client.callTool({ name: 'camera_set', arguments: { fov: 400 } }).catch((e) => ({ isError: true, content: [{ type: 'text', text: String(e.message) }] }));
  assert.equal(badFov.isError, true);
  await client.callTool({ name: 'key_add', arguments: { object: 'Render Camera', frame: 12, target: ['position', 'target', 'fov'] } });
  assert.deepEqual(calls.at(-1).params.target, ['position', 'target', 'fov']);
  await client.callTool({ name: 'object_add', arguments: { kind: 'camera' } });
  assert.equal(calls.at(-1).params.kind, 'camera');
  ok('camera_set / camera keys / object_add camera forward; fov validated');

  await client.callTool({ name: 'scene_preset', arguments: { preset: 'trio', character: 'superhero-f', clear: true } });
  assert.deepEqual(calls.at(-1).params, { type: 'scene_preset', preset: 'trio', character: 'superhero-f', clear: true });
  const badPreset = await client.callTool({ name: 'scene_preset', arguments: { preset: 'army' } }).catch((e) => ({ isError: true, content: [{ type: 'text', text: String(e.message) }] }));
  assert.equal(badPreset.isError, true);
  await client.callTool({ name: 'scene_preset', arguments: { preset: 'keluarga', clear: true } });
  assert.deepEqual(calls.at(-1).params, { type: 'scene_preset', preset: 'keluarga', clear: true });
  await client.callTool({ name: 'scene_preset', arguments: { preset: 'duo', body: { preset: 'pendek' } } });
  assert.deepEqual(calls.at(-1).params, { type: 'scene_preset', preset: 'duo', body: { preset: 'pendek' } });
  ok('scene_preset forwards and validates the preset name (keluarga, body)');

  await client.callTool({ name: 'key_set_easing', arguments: { object: 'Mannequin 1', frame: 0, target: 'head', easing: { type: 'bezier', c: [0.2, 0, 0.1, 1.4] } } });
  assert.deepEqual(calls.at(-1).params.easing, { type: 'bezier', c: [0.2, 0, 0.1, 1.4] });
  await client.callTool({ name: 'key_set_easing', arguments: { object: 'Mannequin 1', frame: 0, easing: 'easeInOut' } });
  assert.equal(calls.at(-1).params.easing, 'easeInOut');
  const badEase = await client.callTool({ name: 'key_set_easing', arguments: { object: 'Mannequin 1', frame: 0, easing: { type: 'bezier', c: [0, 0, 1] } } }).catch((e) => ({ isError: true, content: [{ type: 'text', text: String(e.message) }] }));
  assert.equal(badEase.isError, true);
  ok('key_set_easing accepts named and bezier easing, rejects a malformed bezier');

  await client.callTool({ name: 'keys_edit', arguments: { edits: [{ object: 'Mannequin 1', target: 'head', frame: 0, toFrame: 6, value: [0, 10, 0] }] } });
  assert.equal(calls.at(-1).params.type, 'keys_edit');
  assert.equal(calls.at(-1).params.edits[0].toFrame, 6);
  await client.callTool({ name: 'keys_remove', arguments: { keys: [{ object: 'Mannequin 1', frame: 6 }] } });
  assert.equal(calls.at(-1).params.type, 'keys_remove');
  ok('keys_edit / keys_remove forward');

  const undo = json(await client.callTool({ name: 'undo', arguments: { steps: 2 } }));
  assert.equal(undo.steps, 2);
  ok('undo');

  const snap = await client.callTool({ name: 'viewport_snapshot', arguments: {} });
  const img = snap.content.find((c) => c.type === 'image');
  assert.ok(img && img.mimeType === 'image/png' && img.data === PNG_1X1);
  ok('viewport_snapshot returns MCP image content');

  const rend = json(await client.callTool({ name: 'render_export', arguments: { format: 'webm', width: 1280, height: 720, outDir, filename: 'clip' } }));
  assert.equal(rend.path, join(outDir, 'clip.webm'));
  assert.deepEqual(readFileSync(rend.path), Buffer.concat(renderBytes));
  assert.equal(calls.at(-1).params.outDir, undefined, 'outDir must not be forwarded to the browser');
  ok('render_export: chunks reassembled and file written ' + rend.path);

  const glb = json(await client.callTool({ name: 'render_export', arguments: { format: 'glb', fps: 24, objects: ['Mannequin 1'], outDir, filename: 'anim' } }));
  assert.equal(glb.path, join(outDir, 'anim.glb'));
  assert.deepEqual(readFileSync(glb.path), Buffer.concat([Buffer.from('glTF'), Buffer.from([2, 0, 0, 0, 12, 0, 0, 0])]));
  assert.deepEqual(calls.at(-1).params, { format: 'glb', fps: 24, objects: ['Mannequin 1'] });
  const bvh = await client.callTool({ name: 'render_export', arguments: { format: 'bvh', outDir } }).catch((e) => ({ isError: true, content: [{ type: 'text', text: String(e.message) }] }));
  assert.notEqual(bvh.isError, true); // valid format (the fake browser answers with its canned file)
  const safe = json(await client.callTool({ name: 'render_export', arguments: { format: 'glb', outDir, filename: '../../anim' } }));
  assert.equal(safe.path, join(outDir, 'anim-1.glb'), 'stays in outDir and never overwrites');
  ok('render_export: no traversal, no overwrite');

  const badFormat = await client.callTool({ name: 'render_export', arguments: { format: 'fbx' } }).catch((e) => ({ isError: true, content: [{ type: 'text', text: String(e.message) }] }));
  assert.equal(badFormat.isError, true);
  ok('render_export glb: objects forwarded, .glb written; bvh accepted, unknown format rejected');

  // a newer connection replaces the older
  const b2 = await open(ORIGIN, code);
  assert.equal(b2.welcome, true);
  await new Promise((r) => (b.ws.readyState === WebSocket.CLOSED ? r() : b.ws.once('close', (c) => (assert.equal(c, 4002), r()))));
  answer(b2.ws);
  const again = json(await client.callTool({ name: 'scene_get', arguments: {} }));
  assert.equal(again.fps, 30);
  ok('newer browser connection replaces the older (4002)');

  // browser drops -> error again
  b2.ws.close();
  await new Promise((r) => setTimeout(r, 200));
  const gone = await client.callTool({ name: 'scene_get', arguments: {} });
  assert.equal(gone.isError, true);
  ok('disconnect -> tools error again');

  // stdout stayed clean: the SDK would have thrown on junk while parsing JSON-RPC
  console.log(`\nSMOKE PASSED (${passed} checks)`);
} catch (e) {
  console.error('\nSMOKE FAILED:', e);
  console.error('--- server stderr ---\n' + stderr);
  process.exitCode = 1;
} finally {
  await client.close().catch(() => {});
  rmSync(outDir, { recursive: true, force: true });
  // Leftover sockets/timers from fake browsers would otherwise keep the process alive.
  process.exit(process.exitCode ?? 0);
}
