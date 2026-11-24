# Doloyo - Agent command API

Every mutation of the project is a JSON command. The UI and agents use the same path, so undo/redo works for both.

Two ways in: the **MCP server** (`doloyo-mcp`, next section) for agents, and the browser console for quick scripting (`window.doloyo`; the former name `window.motionDoll` is kept as an alias):

```js
window.doloyo.dispatch({ type: 'object_add', kind: 'mannequin' })  // -> { ok: true } | { ok: false, error }
window.doloyo.getState()   // deep copy of the project JSON
window.doloyo.help()       // command cheat sheet
await window.doloyo.dispatchAsync({ type: 'image_add', mode: 'background', dataUrl })  // image_add may carry a data URL
```

## MCP setup and pairing

```
npm run mcp:install && npm run mcp:build          # once, from the repository folder
claude mcp add doloyo -- node <abs path>/mcp/dist/index.js
```

The MCP server speaks MCP on stdio and opens a WebSocket bridge on 127.0.0.1:7777 (env `DOLOYO_PORT`; `MOTION_DOLL_PORT` still works). The user must (1) run the app (`npm run dev`, http://localhost:5173), (2) open the **Agent** pill (top right), (3) type the 6-digit pairing code and click Connect. The code is returned by the `bridge_status` tool, printed on the server stderr and written to `doloyo-pairing.txt` (and, for older scripts, `motion-doll-pairing.txt`) in the OS temp folder. If a tool says "No browser connected", tell the user the code and ask them to connect. Only the origins http://localhost:5173 and http://127.0.0.1:5173 (plus `DOLOYO_ORIGINS` / `MOTION_DOLL_ORIGINS`, every `--origin`, and with `--allow-hosted` the official hosted origins) are accepted; one browser tab at a time.

### Permission modes (set by the user in the Agent panel)

- **Read-only**: `scene_get`, `viewport_snapshot`.
- **Edit**: adds every edit tool plus `undo` / `redo`. Agent edits share the app undo history, so the user can Ctrl+Z them. Agent edits never trigger Auto-key.
- **Edit + Render**: adds `render_export`.

`anim_list` needs Read; `anim_apply`, `mocap_from_video` (and its internal `mocap_upload` chunks) need Edit.

A denied call returns an error that names the required mode.

### Tools

```
bridge_status      -> {connected, pairingCode, port}
guide_read {skill?, file?}  -> this document plus the list of built-in skills; with skill, that skill (skills/<name>/SKILL.md); with file, one of its references/*.md
scene_get          -> fps, duration, time, objects (id, name, kind, transform, non-rest pose, key times; image planes list their image options), backgrounds {viewport, camera}, joints, poses, canUndo/canRedo
object_add object_set_character object_set_body object_remove object_transform joint_set pose_apply pose_save pose_delete pose_mirror joint_reset
key_add key_remove key_move key_set_easing keys_edit keys_remove timeline_set playhead_seek batch      (same fields as the commands below)
ik_reach ik_pin ik_bake        (inverse kinematics, foot pins)
camera_set                     (the animated render camera)
image_add {path|imageId, mode: background|plane|camera, name?, opacity?, inRender?, fit?, visible?, locked?, billboard?, doubleSided?, position?, rotation?, scale?}   (reference image from a LOCAL file)
image_set {object|background, opacity?, visible?, locked?, inRender?, fit?, billboard?, doubleSided?, name?}   image_remove {object|background}
scene_preset                   (duo / trio / group5 / keluarga formations, mixed gender)
undo {steps?}   redo {steps?}
anim_list {query?}   anim_apply {clip, objects?, start?, speed?, loops?, keyEvery?, mirror?, inPlace?, extend?, duration?}
mocap_from_video {path, maxPeople?, assign?, fps?, smoothing?, footLock?, inPlace?, mirror?, keyEvery?, start?}
viewport_snapshot {width?, height?}   -> PNG image (default 960x540)
render_export {format: png|png_seq|webm|mp4|glb|bvh|project, width?, height?, fps?, transparent?, objects?, outDir?, filename?}  -> {path, ...}
```

Each edit tool is the command of the same name (tool arguments = command fields; `image_add` takes a file `path` and is turned into the command by the MCP server). `object_add` returns the new object as `created: [{id, name}]`. `render_export` renders in the browser frame by frame (t = i / fps, with grid, gizmo and onion skin hidden), streams the bytes to the MCP server, which writes the file (default `./renders` under the server's working directory) and returns the absolute path. Default size is 1280x720. `png` = current playhead frame; `png_seq` = zip of PNGs; `webm` / `mp4` need WebCodecs in the browser (otherwise use `png_seq`); `transparent` works for png and png_seq. Non-looping clips include the final frame (duration * fps + 1 frames). If the scene has a render camera (kind `camera`) every image/video export uses it, with its animated values per frame and the aspect of the export size; otherwise the editor view is used. `glb` = animated glTF binary (Blender, Unity, Unreal): all mannequins and shapes, or the ones in `objects` (ids or names), baked at `fps` (default: project fps), skinned characters keep their skin and bone animation, the procedural doll is a joint-node hierarchy with meshes, the render camera is included as a camera node (position and direction baked; glTF cannot animate FOV, so the FOV of the first frame is stored); width and height are ignored except for the camera aspect. `bvh` = 17-joint motion of the first listed (or first) mannequin, centimeters, Y up. Pinned feet are included in both.

### Suggested workflow

1. `bridge_status` (connected? otherwise give the user the pairing code), `guide_read` once, then `scene_get`.
2. `timeline_set` (fps, duration); `object_add`, or reuse the existing mannequin.
3. For each pose: `playhead_seek`, `pose_apply` / `joint_set`, `key_add`. Use `batch` to make one beat a single undo step.
4. `viewport_snapshot` at a few frames (seek first) to check the poses; fix with `joint_set`.
5. `render_export` when the user asked for a file.

Example: a 2 second wave as one `batch` call. Key commands take `frame` directly, so no `playhead_seek` is needed inside it.

```json
{ "commands": [
  { "type": "timeline_set", "fps": 24, "duration": 2 },
  { "type": "pose_apply", "object": "Mannequin 1", "pose": "stand" },
  { "type": "key_add", "object": "Mannequin 1", "frame": 0 },
  { "type": "pose_apply", "object": "Mannequin 1", "pose": "wave_up" },
  { "type": "key_add", "object": "Mannequin 1", "frame": 12, "easing": "easeInOut" },
  { "type": "pose_apply", "object": "Mannequin 1", "pose": "stand" },
  { "type": "key_add", "object": "Mannequin 1", "frame": 48 }
] }
```

Bridge wire protocol (for custom clients): bridge to browser `{id, type:"call", method, params}`; browser to bridge `{id, type:"result", ok, data|error}`, plus `{id, type:"chunk", seq, data}` (base64, up to 4 MB each) before the result of `render_export`. The browser opens with `{type:"hello", code}` and receives `{type:"welcome"}`. Methods: `scene_get`, `dispatch` (params = the command), `undo`, `redo`, `viewport_snapshot`, `render_export`, `anim_list`, `anim_apply`, `mocap_upload` ({uploadId, seq, total, data: base64 chunk}, sent by the server before `mocap_from_video`), `mocap_from_video` ({uploadId, mime, ...options}).

## Characters (views of the same pose)

Every mannequin has a `character` (default `mannequin-f`) and a `material` (`doll` matte grey, or `original` textures). A character is only a *view* of the canonical 17-joint pose: joint rotations, hips offset and keys are identical for all of them, so every command, `batch`, undo, export and onion skin works the same. Switch with `object_set_character`; the pose is untouched.

Built-in ids: `doll-procedural` (smooth art doll), `mannequin-f`, `mannequin-m` (Quaternius, CC0). The former `superhero-m` / `superhero-f` were removed; projects and calls that still name them get `mannequin-m` / `mannequin-f` (with a console warning). `custom:<id>` ids are characters the user imported (.glb/.vrm) in the browser; `scene_get` shows each mannequin's `character`. An imported character can only be chosen by the user in the UI (File > Import character...), but you can switch a mannequin to an existing `custom:` id with `object_set_character`. Skinned characters load asynchronously; `viewport_snapshot` and `render_export` wait for them.

## Body sizes

Every mannequin has an optional `body: { preset, heightScale?, gender? }` (scene_get always shows it, plus the nominal `height` in meters). Missing = `dewasa` at 1, the original proportions, so old projects load unchanged.

| preset | label | meaning | height | head-heights |
|---|---|---|---|---|
| `kecil` | Baby | baby, about 12 months | 0.75 m | about 4 (big head, short neck, short chubby limbs) |
| `pendek` | Child | child, about 6-7 years | 1.20 m | about 6 |
| `remaja` | Teen | teenager, about 15 years | 1.62 m (F 1.58 m) | about 7 |
| `dewasa` | Adult | adult (default) | 1.75 m (F 1.65 m) | about 7.5 |

`heightScale` (0.9 to 1.1) fine-tunes the preset height. `gender` ("m" or "f") only nudges proportions (shoulder width) and picks the base character; it is derived from the character id when omitted.

- `object_set_body { object, preset?, heightScale?, gender? }` is one undo step. Changing the body drops the foot pins (undo brings them back).
- **Neutral children rule**: `kecil`, `pendek` and `remaja` use the neutral `mannequin-m` mesh for both genders (a girl is `gender: "f"` on that mesh, never an adult female shape); only `dewasa` + `f` uses `mannequin-f`. Built-in mannequins switch mesh automatically. Procedural doll and imported characters keep their character and are just scaled.
- Everything uses the same proportions: FK, `ik_reach` / `ik_pin` (limb lengths of the body), Copy Dance foot lock, onion ghosts, pick volumes, GLB and BVH export (joint offsets of the body; skinned characters keep the skin with scaled bones) and the picture. Feet stay on the floor for every preset.
- Poses and keys are rotations, so any pose, baked clip or mocap result works on any body. **`hipsPos` (the hips translation channel and keys) is stored in adult rig units and multiplied by the body hips height ratio when evaluated** (`hipsScale` = hips height of the body / 0.95 m), so a jump or crouch keeps the feet on the floor. `joint_set` with `position` therefore takes adult units too.
- Baby poses for any body: `duduk` (sitting on the floor, legs forward), `merangkak` (crawling on hands and knees), `berdiri_pegangan` (standing, arms raised as if holding on). When applied they solve `hipsPos.y` from the body so the contacts (feet, knees, hands, seat) rest on the floor; they are designed for `kecil` (on larger bodies `merangkak` hands can hover).

```json
{ "commands": [
  { "type": "object_add", "kind": "mannequin", "name": "Bayi", "body": { "preset": "kecil", "gender": "f" } },
  { "type": "pose_apply", "object": "Bayi", "pose": "duduk" }
] }
```

## Animation library

`anim_list {query?}` lists 86 CC0 clips (ids like `ual1/Dance_Loop`, `ual2/Sword_Regular_A`): idles, walks, runs, sitting, sword, pistol, jumps, dance... `anim_apply` bakes a clip as keys on mannequins as ONE undo step, for any character:

```
anim_apply { clip, objects?: [id|name], start?, speed?, loops?, keyEvery?, mirror?, inPlace?, extend?, duration? }
```

Defaults: the selected mannequin (else every mannequin), start at the playhead, speed 1, 1 loop, a key every frame, timeline extended when the clip is longer, original hips travel kept (`inPlace: true` drops horizontal travel, keeps height). `keyEvery` 2, 3 or 5 gives lighter tracks that are easier to edit. Existing keys inside the baked time range are replaced, hand-made keys outside are kept. `duration` (seconds, from `start`) trims the run: a 10-loop idle with `duration: 2.5` writes only 2.5 s of keys. A later `anim_apply` that overlaps an earlier `anim_apply` run replaces it on every joint: keys inside the new range are replaced and the rest of the earlier run after the new range is dropped, so a looped idle does not keep playing behind a `Death01` clip (the character holds the last pose of the new clip). Keys you made by hand are never removed this way. One undo step restores everything. Values are clamped loosely, not to the strict human joint limits. Workflow: `anim_list {query:"walk"}`, `anim_apply {clip:"ual1/Walk_Loop", loops:3, inPlace:true}`, `viewport_snapshot` after `playhead_seek`, then maybe `object_transform` + `key_add` on `position` to move the object across the scene.

## Copy Dance (motion capture from video)

`mocap_from_video` copies the motion of people in a local video file onto dolls. The MCP server reads the file (absolute path on the machine running the server; mp4, webm, mov; up to 600 MB), streams it to the browser in chunks, and the browser runs MediaPipe Pose Landmarker locally (the video never leaves the machine). Needs **Edit** permission, a connected tab, and the pose model installed once with `npm run fetch-models`.

```
mocap_from_video { path, maxPeople?: 1-4, assign?: [{track, object|"new"}], fps?, smoothing?: 0-1, footLock?, inPlace?, mirror?, keyEvery?, start? }
```

- Without `assign`: track 1 (the longest) goes to the selected/first mannequin, further tracks create new dolls. With `assign`, `object` is a mannequin id/name or `"new"`; one track per doll.
- `smoothing` (default 0.5) drives a One-Euro filter on the 3D landmarks; `footLock` (default true) pins the lowest foot to the floor; `inPlace` removes horizontal travel; `mirror` swaps left/right for selfie videos; `start` defaults to the playhead; the timeline is extended when needed. One undo step.
- Returns `{video, delegate, tracks:[{track, frames, from, to}], applied:{assigned:[{track, object, id, created, keysPerChannel}], start, end, extended}}`. It can take minutes for long videos (time-out 30 min).
- Facing follows the camera. For best results: steady camera, whole body in frame, bright light, clothes that contrast with the background. Accuracy is like webcam mocap; fast moves and occlusion degrade it, so check with `viewport_snapshot` at a few frames.
- For a different video per doll, call it once per doll with `assign: [{track:1, object:"<doll>"}]` and a suitable `start`.

## Conventions

- `object` is an object id or its name (names are used as-is; ids are stable).
- Rotations are Euler XYZ in **degrees**. Positions are meters, Y up, character faces +Z (character left is +X).
- Times are **seconds**; most commands also accept `frame` (converted with the project fps). Times snap to the frame grid.
- Joint rotations are clamped to the joint limits (see `src/core/rig.ts`).
- A command that fails returns `{ ok: false, error }` and changes nothing.
- `batch` runs several commands as one undo step.

## Joints (mannequin)

`hips, spine, chest, neck, head, L_shoulder, L_elbow, L_wrist, R_shoulder, R_elbow, R_wrist, L_hip, L_knee, L_ankle, R_hip, R_knee, R_ankle`

Rest pose: arms hang down, legs straight. Useful axes (left arm, local): `rotation[2]` positive raises the arm sideways, `rotation[0]` negative raises it forward. Elbow flexion is negative X, knee flexion is positive X, hip flexion (thigh forward) is negative X. Right side is mirrored: Y and Z flip sign.

## Channels

Animatable channels: `position`, `rotation`, `scale`, and for mannequins `hipsPos` plus every joint name. The render camera (kind `camera`) has `position`, `target` and `fov` (stored as `[fov,0,0]` in keys). `target` in key commands is `"all"` (default), one channel, or an array of channels.

## Commands

```
object_add       { kind: "mannequin"|"cube"|"sphere"|"cylinder"|"camera", name?, position?, character?, body?: { preset, heightScale?, gender? } }   // one camera at most; camera_set also creates it
object_set_body { object, preset?: "kecil"|"pendek"|"remaja"|"dewasa", heightScale?: 0.9..1.1, gender?: "m"|"f" }   // mannequin only; see Body sizes
object_set_character { object, character: "doll-procedural"|"mannequin-f"|"mannequin-m"|"custom:<id>", material?: "doll"|"original" }   // mannequin only; pose unchanged
object_remove    { object }
object_transform { object, name?, position?, rotation?, scale? }
joint_set        { object, joint, rotation?: [x,y,z], position?: [x,y,z] }   // position: hips only (offset from rest)
pose_apply       { object, pose: "stand"|"t_pose"|"crouch"|"kneel"|"point"|"wave_up"|"duduk"|"merangkak"|"berdiri_pegangan"|<custom pose name> | { joints: {name: [x,y,z]}, hipsPos? }, partial? }
pose_save        { object, name }                                             // saves the current pose into the project pose library
pose_delete      { name }                                                     // removes a custom pose
pose_mirror      { object, from: "L"|"R" }
joint_reset      { object, joint? }                                           // no joint = whole pose
key_add          { object, target?, time?|frame?, easing?, bakePins? }        // keys the object's CURRENT values; default time = playhead; bakePins also keys the pinned legs and drops the pins
key_remove       { object, target?, time?|frame? }
key_move         { object, target?, time?|frame?, to?|toFrame? }
key_set_easing   { object, target?, time?|frame?, easing: "linear"|"easeIn"|"easeOut"|"easeInOut"|"step" | {type:"bezier", c:[x1,y1,x2,y2]} }
keys_edit        { edits: [{ object, target?, time?|frame?, to?|toFrame?, value?: [x,y,z] }] }   // move several keys and/or set values, ONE undo step
keys_remove      { keys: [{ object, target?, time?|frame? }] }                // remove several keys, ONE undo step
keys_paste       { object, time?|frame?, kind?, clip: [{channel, dt, value, easing}] }   // UI clipboard (Ctrl+V); rarely needed by agents
ik_reach         { object, limb: "L_arm"|"R_arm"|"L_leg"|"R_leg", target: [x,y,z], pole?: [x,y,z], poleAngle?: degrees }
ik_pin           { object, limb: "L_leg"|"R_leg"|"L_foot"|"R_foot", pinned: boolean, position?: [x,y,z] }
ik_bake          { object, start?, end?, unpin? }
camera_set       { object?, position?: [x,y,z], target?: [x,y,z], fov?: 1..170 }
scene_preset     { preset: "duo"|"trio"|"group5"|"keluarga", character?, clear?, body? }
timeline_set     { fps?, duration?, loop? }
playhead_seek    { time?|frame? }
batch            { commands: [...] }
```

`object_restore`, `track_restore`, `pose_lib_restore` and `pins_restore` are internal commands used as inverses for undo. Do not send them (the bridge rejects them).

## Easing and bezier curves

`easing` on a key shapes the segment that STARTS at that key. It is a name (`linear`, `easeIn`, `easeOut`, `easeInOut`, `step`) or a cubic bezier time curve like CSS `cubic-bezier`:

```json
{ "type": "bezier", "c": [0.42, 0, 0.58, 1] }
```

`c = [x1, y1, x2, y2]`: x1 and x2 must be in 0..1 (time axis), y1 and y2 are free (values above 1 or below 0 overshoot the next key, useful for bounce). The named easings correspond to the bezier presets linear [0,0,1,1], easeIn [0.42,0,1,1], easeOut [0,0,0.58,1], easeInOut [0.42,0,0.58,1] (step has none). The curve maps the segment time to the blend parameter, for rotations the slerp parameter. Accepted by `key_add`, `key_set_easing` and `batch`; stored in the project file as the object above. A bad curve is rejected with an error.

## Inverse kinematics and foot pins

`ik_reach` moves the end joint of a limb (wrist for arms, ankle for legs) to a WORLD position (meters, Y up, +Z forward of an unrotated object). Analytic two-bone solve on the rig, written as ordinary joint rotations (so you can key, mirror or save them like any pose); one undo step.

- The elbow/knee keeps its current side (a straight limb defaults to knee forward, elbow backward). `pole` (a world point the elbow/knee should point toward) or `poleAngle` (swivel in degrees around the root-to-target axis; 0 is the default side) override it.
- A target beyond the limb length gives a fully extended limb pointing at the target. Joint limits are applied loosely (values are clamped, so an extreme target may stop short of the point).
- Typical use: pose the body first (`joint_set` on hips / spine), then `ik_reach` the hands and feet, then `key_add`. Remember: seek, set, key.
- Reach for a point in front of a doll at the origin: shoulder height is about y = 1.47 (rest), arm length 0.55 m, leg length 0.82 m, hips at y = 0.95.

`ik_pin { limb: "L_foot", pinned: true }` pins a foot to its current world position (or `position`). While pinned, the leg is re-solved after every change of the hips, pose or object transform, and for every frame of playback and export, so lowering the hips or moving the object bends the knees instead of sliding the foot. Pins are stored in the object (`pins: {L_foot?: [x,y,z], R_foot?: ...}`, the world position of the ankle joint). A pinned leg's own joints cannot be edited by hand (they are recomputed); `ik_reach` on a pinned foot moves the pin. `ik_bake` keys the pinned legs on every frame over `start`..`end` (default: range of the object's keys) and removes the pins, so the animation keeps working without them; `key_add { bakePins: true }` does the same for a single key. `scene_get` lists `pins` for mannequins that have them.

## Render camera

`camera_set { position?, target?, fov? }` edits the render camera, creating it if the scene has none (`object_add { kind: "camera" }` also works; only one is allowed). It is a normal keyable object with channels `position`, `target`, `fov`:

```json
{ "commands": [
  { "type": "camera_set", "position": [0, 1.4, 5], "target": [0, 1, 0], "fov": 35 },
  { "type": "key_add", "object": "Render Camera", "frame": 0, "easing": "easeInOut" },
  { "type": "camera_set", "position": [3, 1.6, 3], "fov": 28 },
  { "type": "key_add", "object": "Render Camera", "frame": 48 }
] }
```

Every image/video/glb export then uses this camera (animated, aspect = export width / height). Without a render camera the exporters use the editor view. `viewport_snapshot` shows the editor view.

## Reference images

Three ways to use a picture (png, jpg, webp, gif = first frame, svg), all local: the picture is stored in the browser (IndexedDB) next to imported characters, and the project file references it by id (opening a project whose pictures are missing shows a warning; "Embed images" on save puts pictures up to 2 MB into the file).

- `mode: "background"`: screen-space picture behind the viewport. `fit` = `fit` (whole picture, default), `fill` (covers the frame) or `center` (original pixels); `opacity`; `visible`.
- `mode: "plane"`: an object of kind `image` in the 3D scene, a textured plane `aspect` m wide and 1 m high before the scale (default scale 1.6, position `[0, 0.9, -1.2]`). It moves, rotates and scales like a shape, so `object_transform` and `key_add` (channels `position`, `rotation`, `scale`) animate it. Options: `opacity`, `doubleSided` (default true), `locked` (cannot be picked in the viewport; still in the outliner), `billboard` (always faces the camera; the rotation is ignored).
- `mode: "camera"`: picture locked to the render camera frame. It shows while looking through the camera (C) and is composited in exports. It needs a render camera (see Render camera); default `fit` is `fill`.

`inRender` (default true) decides whether the picture is part of snapshots (`viewport_snapshot`), image/video exports and GLB. A plane with `inRender: false` stays in the editor only. In GLB an image plane becomes a textured quad (unlit, animated by its keys; billboards keep the pose of the object). Adding a background replaces the one in that slot. Everything is undoable and a `batch` can mix them.

```json
{ "type": "image_add", "mode": "background", "path": "D:/refs/nursery.png", "fit": "fill", "opacity": 0.9 }
{ "type": "image_set", "background": "viewport", "visible": false }
{ "type": "image_set", "object": "Poster", "billboard": true, "locked": true }
{ "type": "image_remove", "background": "camera" }
```

As MCP tools `image_add` takes `path` (an absolute path on the machine running the MCP server, up to 20 MB, image extensions only; no URLs) or `imageId` (a picture already stored in the browser); the local path is never sent to the browser. In the browser console `dispatchAsync` also accepts `dataUrl`. Options that do not apply to the target (for example `fit` on a plane, `locked` on a background) are an error.

## Scene presets and multi-key edits

`scene_preset { preset: "trio", character: "doll-procedural", clear: true }` adds 2, 3, 4 or 5 new mannequins (`keluarga` = father, child, baby sitting in the `duduk` pose, mother; without `character` the dolls alternate Mannequin F / Mannequin M; `body` gives every doll one size, not allowed for keluarga) in an arc facing +Z (ends curve toward the audience and turn inward), as one undo step; `clear` first removes the existing mannequins. `keys_edit` / `keys_remove` change several keys as one undo step (see Commands).

## Important semantics

- `key_add` records the object's current base values (what you set with `joint_set` etc). `playhead_seek` and playback overwrite every keyed channel with its sampled value. So the pattern is always: **seek, set values, key_add**. Agent edits stop playback, and commands that touch one object (`key_move`, `track_restore`, `timeline_set`, ...) only re-sample that object, so `pose_apply` then `key_add {target:"all"}` keys exactly the pose you applied.
- Easing on a key applies to the segment that starts at that key.
- `pose_apply` with a preset name resets every joint first. Use `partial: true` with a pose object to change only the listed joints.

## Example: a 2 second wave

```js
const d = (c) => window.doloyo.dispatch(c);
d({ type: 'timeline_set', fps: 24, duration: 2 });
d({ type: 'object_add', kind: 'mannequin', name: 'Wave' });
d({ type: 'pose_apply', object: 'Wave', pose: 'stand' });
d({ type: 'playhead_seek', frame: 0 });
d({ type: 'key_add', object: 'Wave' });                                   // frame 0: standing
d({ type: 'pose_apply', object: 'Wave', pose: 'wave_up' });
d({ type: 'playhead_seek', frame: 12 });
d({ type: 'key_add', object: 'Wave' });                                   // frame 12: arm up
d({ type: 'joint_set', object: 'Wave', joint: 'R_wrist', rotation: [0, 0, 20] });
d({ type: 'playhead_seek', frame: 18 });
d({ type: 'key_add', object: 'Wave', target: 'R_wrist' });
d({ type: 'pose_apply', object: 'Wave', pose: 'stand' });
d({ type: 'playhead_seek', frame: 48 });
d({ type: 'key_add', object: 'Wave', easing: 'easeInOut' });
d({ type: 'playhead_seek', frame: 0 });
```

## Project file (.mdoll.json)

The extension stayed `.mdoll.json` after the rename from Motion Doll Studio: older files keep opening.

```json
{
  "version": 1, "name": "Untitled", "fps": 30, "duration": 4, "loop": false, "time": 0,
  "objects": [{
    "id": "...", "kind": "mannequin", "name": "Mannequin 1",
    "position": [0,0,0], "rotation": [0,0,0], "scale": [1,1,1],
    "pose": { "head": [0,0,0] }, "hipsPos": [0,0,0],
    "pins": { "L_foot": [0.09, 0.08, 0] },
    "tracks": { "head": [{ "t": 0, "value": [0,0,0], "easing": { "type": "bezier", "c": [0.42, 0, 0.58, 1] } }] }
  }, {
    "id": "...", "kind": "camera", "name": "Render Camera",
    "position": [2.8, 1.6, 3.8], "target": [0, 0.9, 0], "fov": 40,
    "tracks": { "fov": [{ "t": 0, "value": [40, 0, 0], "easing": "linear" }] }
  }],
  "customPoses": { "my pose": { "joints": { "head": [0,20,0] }, "hipsPos": [0,-0.1,0] } },
  "background": { "imageId": "img...", "name": "nursery", "aspect": 1.78, "opacity": 1, "visible": true, "inRender": true, "fit": "fill" },
  "cameraBackground": { "imageId": "img...", "name": "set", "aspect": 1.78, "opacity": 1, "visible": true, "inRender": true, "fit": "fill" }
}
```

An image plane is an object `{ "kind": "image", ..., "image": { "imageId", "aspect", "opacity", "doubleSided", "locked", "inRender", "billboard" } }`. A file saved with "Embed images" also has `embeddedImages: { "<imageId>": "data:image/...;base64,..." }`; opening it stores those pictures in the browser.
