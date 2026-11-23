# AGENTS.md - driving Doloyo from an AI agent

This is a tutorial for AI agents (Claude Code, Claude Desktop, any MCP client) and for people setting one up. It is step by step: setup, pairing, rules, then five worked examples with exact tool calls. The full tool reference is [docs/AGENT.md](docs/AGENT.md) (the `guide_read` tool returns the same text).

## 1. What Doloyo is

Doloyo is a browser studio for posing and animating a 17-joint 3D mannequin: keyframes, curves, IK and foot pins, an animated render camera, an animation library, motion capture from video (Copy Dance), reference images, and export to PNG, PNG sequence, WebM, MP4, GLB and BVH. Everything runs locally in a browser tab.

An agent does not get a separate API. The MCP server (`mcp/`) forwards every tool call over a local WebSocket (`127.0.0.1:7777`) to the open Doloyo tab, which applies the same JSON commands the UI uses. So everything an agent does is undoable by the user (Ctrl+Z) and visible live in the tab.

## 2. Set up the MCP bridge

The npm package is not published. Build the server from a clone of the repository (Node 18 or newer):

```
git clone https://github.com/dkfadhila/doloyo
cd doloyo
npm run setup                  # app dependencies, MCP server build, pose model
npm start                      # the app on http://localhost:5173
```

`npm run setup` already builds the MCP server. To build only that: `npm run mcp:install && npm run mcp:build`. The server entry point is `mcp/dist/index.js`.

Register it with your client. Use an absolute path.

Claude Code:

```
claude mcp add doloyo -- node /abs/path/to/doloyo/mcp/dist/index.js
```

Claude Desktop (`claude_desktop_config.json`) or any client that takes a stdio server definition:

```json
{
  "mcpServers": {
    "doloyo": {
      "command": "node",
      "args": ["/abs/path/to/doloyo/mcp/dist/index.js"]
    }
  }
}
```

To drive the hosted web app (https://doloyo.vercel.app) instead of `npm start`, add `--allow-hosted` so the bridge accepts the official hosted origins:

```
claude mcp add doloyo -- node /abs/path/to/doloyo/mcp/dist/index.js --allow-hosted
```

For another origin use `--origin https://your.site` (repeatable). `--port <n>` or `DOLOYO_PORT` changes the bridge port, but the app connects to 7777 only. The former names `MOTION_DOLL_PORT` and `MOTION_DOLL_ORIGINS` still work.

Check it: call `bridge_status`. A fresh server answers `connected: false` and gives a pairing code.

```json tool-call
{ "tool": "bridge_status", "arguments": {} }
```

## 3. Pair with the browser

The browser must pair once per server run. The code is a 6-digit number.

1. Call `bridge_status` and read `pairingCode`. The same code is printed on the server's stderr and written to `doloyo-pairing.txt` (and `motion-doll-pairing.txt`) in the OS temp folder. If you cannot read it, **ask the user**; the app shows no code, it only takes one.
2. Ask the user to open Doloyo, click the **Agent** pill (top right), type the code and click **Connect**. The dot turns green.
3. Ask the user to choose a permission mode in the same panel (see below).
4. Call `bridge_status` again: `connected: true`.

Never guess a code. Five wrong codes make the server generate a new one. A tool call without a connected tab fails with a message that contains the current code; show it to the user instead of retrying in a loop.

## 4. Permission modes

The user sets the mode in the Agent panel; the browser enforces it.

| Mode | Allows |
| --- | --- |
| Read-only | `scene_get`, `anim_list`, `viewport_snapshot` |
| Edit | everything above plus all edit tools, `anim_apply`, `mocap_from_video`, `image_*`, `undo`, `redo` |
| Edit + Render | plus `render_export` |

A denied call returns an error naming the required mode. Ask the user to change it; do not work around it.

## 5. Golden rules

1. **Call `scene_get` first** and again after big changes. It lists object ids, names, kinds, transforms, key times, backgrounds, fps and duration. Do not assume object names.
2. **Use object ids** (the `id` field of `scene_get`) in later calls. Names work too, but they can be renamed or duplicated.
3. **Seek, set, key.** `key_add` records the current values. `playhead_seek` and playback overwrite keyed channels with their sampled values, so set values at the right time and key them straight away.
4. **Batch related edits** with the `batch` tool: one batch is one undo step for the user. Keys take `frame`, so no `playhead_seek` is needed inside a batch.
5. **Verify with `viewport_snapshot`** after `playhead_seek` at a few frames. Look at the picture, then fix with `joint_set`, `ik_reach` and friends.
6. **Never overwrite the user's files.** `render_export` never replaces an existing file (it adds `-1`, `-2`, ...), keeps the file name inside `outDir`, and returns the absolute path. Do not delete or edit files you did not create.
7. **Local files only.** `image_add` and `mocap_from_video` take absolute paths on the machine that runs the MCP server. There is no URL download; images up to 20 MB, videos up to 600 MB.
8. **Mind the user's undo history.** Prefer a few batches over hundreds of single calls. If a step went wrong, `undo` it instead of piling fixes on top.
9. **Children are neutral mannequins.** Body sizes `kecil` (baby), `pendek` (child), `remaja` (teen) and `dewasa` (adult) are about proportions only. Keep it that way.
10. Long renders and videos can take minutes. Do one at a time and tell the user what you are waiting for.

## 6. Tutorial A: wave hello (keyframes)

Goal: one doll waves for two seconds. Start by reading the scene.

```json tool-call
{ "tool": "scene_get", "arguments": {} }
```

Take the id or name of the first mannequin (a fresh project has `Mannequin 1`). Set the timeline and build the animation in one batch, so the user can undo it in one step:

```json tool-call
{
  "tool": "batch",
  "arguments": {
    "commands": [
      { "type": "timeline_set", "fps": 24, "duration": 2 },
      { "type": "pose_apply", "object": "Mannequin 1", "pose": "stand" },
      { "type": "key_add", "object": "Mannequin 1", "frame": 0 },
      { "type": "pose_apply", "object": "Mannequin 1", "pose": "wave_up" },
      { "type": "key_add", "object": "Mannequin 1", "frame": 12, "easing": "easeInOut" },
      { "type": "joint_set", "object": "Mannequin 1", "joint": "R_wrist", "rotation": [0, 0, 20] },
      { "type": "key_add", "object": "Mannequin 1", "frame": 18, "target": "R_wrist" },
      { "type": "pose_apply", "object": "Mannequin 1", "pose": "stand" },
      { "type": "key_add", "object": "Mannequin 1", "frame": 48, "easing": "easeInOut" }
    ]
  }
}
```

Check the middle of the wave:

```json tool-call
[
  { "tool": "playhead_seek", "arguments": { "frame": 14 } },
  { "tool": "viewport_snapshot", "arguments": { "width": 960, "height": 540 } }
]
```

If the hand is not where you want it, move to that frame, adjust the joint and key it again with `target` set to that joint:

```json tool-call
[
  { "tool": "playhead_seek", "arguments": { "frame": 14 } },
  { "tool": "joint_set", "arguments": { "object": "Mannequin 1", "joint": "R_elbow", "rotation": [-100, 0, 0] } },
  { "tool": "key_add", "arguments": { "object": "Mannequin 1", "frame": 14, "target": "R_elbow" } }
]
```

## 7. Tutorial B: dance crew with a camera move, rendered to MP4

Goal: five dolls dance, the render camera moves, and the result is an MP4. This needs Edit + Render.

Step 1: a formation of five mixed-gender dolls (this replaces the existing mannequins), then read the new names.

```json tool-call
[
  { "tool": "scene_preset", "arguments": { "preset": "group5", "clear": true } },
  { "tool": "scene_get", "arguments": {} }
]
```

Step 2: bake the Dance Loop clip on all five. `anim_list` finds clip names (`query` filters them). The clip is 1 second long, so three loops make 3 seconds and the timeline is extended automatically. `keyEvery: 2` gives lighter tracks that are easy for the user to edit.

```json tool-call
[
  { "tool": "anim_list", "arguments": { "query": "dance" } },
  {
    "tool": "anim_apply",
    "arguments": {
      "clip": "Dance_Loop",
      "objects": ["Mannequin 1", "Mannequin 2", "Mannequin 3", "Mannequin 4", "Mannequin 5"],
      "loops": 3,
      "keyEvery": 2,
      "start": 0
    }
  }
]
```

Step 3: a slow push-in by the render camera, with eased keys. `camera_set` creates the camera if there is none; its channels are `position`, `target` and `fov`. At 30 fps (check `scene_get`) three seconds is frame 90.

```json tool-call
{
  "tool": "batch",
  "arguments": {
    "commands": [
      { "type": "camera_set", "position": [0, 1.5, 7], "target": [0, 1, 0], "fov": 35 },
      { "type": "key_add", "object": "Render Camera", "frame": 0, "easing": "easeInOut" },
      { "type": "camera_set", "position": [2.5, 1.3, 4.5], "target": [0, 1, 0], "fov": 28 },
      { "type": "key_add", "object": "Render Camera", "frame": 90 }
    ]
  }
}
```

Step 4: check a frame, then render. Image and video exports use the render camera automatically.

```json tool-call
[
  { "tool": "playhead_seek", "arguments": { "frame": 45 } },
  { "tool": "viewport_snapshot", "arguments": { "width": 960, "height": 540 } },
  {
    "tool": "render_export",
    "arguments": { "format": "mp4", "width": 1280, "height": 720, "fps": 30, "outDir": "/abs/path/to/renders", "filename": "dance-crew" }
  }
]
```

The reply has the absolute `path` of the written file. MP4 and WebM need WebCodecs in the browser (Chrome or Edge); otherwise export `png_seq` and assemble the frames with ffmpeg.

## 8. Tutorial C: baby commercial scene with a reference background

Goal: a family scene (two adults, a child, a baby sitting on the floor) in front of a picture of a room, rendered as a still.

Step 1: the `keluarga` preset creates father, child, baby (already in the `duduk` sitting pose) and mother, left to right.

```json tool-call
[
  { "tool": "scene_preset", "arguments": { "preset": "keluarga", "clear": true } },
  { "tool": "scene_get", "arguments": {} }
]
```

In `scene_get`, the object whose `body.preset` is `kecil` is the baby. To seat any small doll yourself (the hips height is solved from the body so the doll rests on the floor), use the `duduk` pose; `merangkak` (crawling) and `berdiri_pegangan` (standing, holding on) work the same way:

```json tool-call
{ "tool": "pose_apply", "arguments": { "object": "Mannequin 3", "pose": "duduk" } }
```

Step 2: the reference image. `image_add` reads a local file on the machine that runs the MCP server and streams it to the browser. Mode `background` puts it behind the scene on screen; `fit: "fill"` covers the frame. `inRender` (default true) makes it part of snapshots and renders.

```json tool-call
{
  "tool": "image_add",
  "arguments": { "path": "/abs/path/to/nursery-room.png", "mode": "background", "name": "nursery", "fit": "fill", "opacity": 1, "inRender": true }
}
```

Other modes: `plane` adds a textured plane object to the 3D scene (move it with `object_transform`), `camera` locks the picture to the render camera frame. Tune later with `image_set`, for example:

```json tool-call
[
  { "tool": "image_add", "arguments": { "path": "/abs/path/to/poster.png", "mode": "plane", "name": "Poster", "position": [0, 1.75, -1.6], "scale": [1.15, 1.15, 1.15], "locked": true } },
  { "tool": "image_set", "arguments": { "background": "viewport", "opacity": 0.9 } },
  { "tool": "image_set", "arguments": { "object": "Poster", "inRender": false } }
]
```

Step 3: a camera, a check and the render. The still uses the render camera at the current playhead frame.

```json tool-call
[
  { "tool": "camera_set", "arguments": { "position": [0, 1.2, 5], "target": [0, 0.8, 0], "fov": 38 } },
  { "tool": "viewport_snapshot", "arguments": { "width": 960, "height": 540 } },
  { "tool": "render_export", "arguments": { "format": "png", "width": 1920, "height": 1080, "outDir": "/abs/path/to/renders", "filename": "baby-commercial" } }
]
```

`viewport_snapshot` shows the editor view unless the user is looking through the camera, so the PNG render is the final check. Reference pictures live only in that browser; the project file references them by id.

## 9. Tutorial D: Copy Dance from a local video

Goal: copy the dance of a person in a video onto a doll. Needs Edit permission and the pose model (`npm run fetch-models`, done by `npm run setup`). The video never leaves the machine.

```json tool-call
{
  "tool": "mocap_from_video",
  "arguments": {
    "path": "/abs/path/to/dance.mp4",
    "maxPeople": 1,
    "assign": [{ "track": 1, "object": "Mannequin 1" }],
    "smoothing": 0.5,
    "footLock": true,
    "inPlace": false,
    "keyEvery": 1,
    "start": 0
  }
}
```

The server streams the file in chunks, the browser analyses it and bakes keys as one undo step. The reply lists the tracks found and the keys added; a long video can take minutes. Without `assign`, track 1 goes to the selected or first mannequin and further tracks create new dolls (set `maxPeople` up to 4). Use `mirror: true` for selfie videos. Check the result:

```json tool-call
[
  { "tool": "playhead_seek", "arguments": { "frame": 30 } },
  { "tool": "viewport_snapshot", "arguments": { "width": 960, "height": 540 } }
]
```

Accuracy is webcam-grade. A steady camera, the whole body in frame and good light help; fast moves and hidden limbs do not.

## 10. Tutorial E: IK reach and foot pins

Goal: a doll crouches with both feet planted and reaches forward with one hand.

Pin the feet where they stand, lower the hips (the legs bend instead of the feet sliding), then reach with IK and key the result:

```json tool-call
{
  "tool": "batch",
  "arguments": {
    "commands": [
      { "type": "pose_apply", "object": "Mannequin 1", "pose": "stand" },
      { "type": "ik_pin", "object": "Mannequin 1", "limb": "L_foot", "pinned": true },
      { "type": "ik_pin", "object": "Mannequin 1", "limb": "R_foot", "pinned": true },
      { "type": "joint_set", "object": "Mannequin 1", "joint": "hips", "position": [0, -0.3, 0] },
      { "type": "ik_reach", "object": "Mannequin 1", "limb": "R_arm", "target": [0.3, 1.1, 0.45], "poleAngle": 20 },
      { "type": "key_add", "object": "Mannequin 1", "frame": 24, "bakePins": true }
    ]
  }
}
```

`ik_reach` takes a world position in meters (Y up, a doll at the origin faces +Z) for the wrist or ankle, and an optional `pole` point or `poleAngle` to steer the elbow or knee. Targets beyond the limb length give a fully extended limb. `bakePins: true` keys the pinned legs and removes the pins, so the pose survives without them. For a whole range of frames use `ik_bake`:

```json tool-call
{ "tool": "ik_bake", "arguments": { "object": "Mannequin 1", "start": 0, "end": 2 } }
```

## 11. Troubleshooting

- **No browser connected.** The tab is not paired. Give the user the `pairingCode` from `bridge_status` and ask them to open the Agent pill and click Connect. After a server restart the code changes.
- **403 or "Rejected connection" in the server log.** The page's origin is not allowed. The bridge accepts `http://localhost:5173` and `http://127.0.0.1:5173` by default. For the hosted app start the server with `--allow-hosted`; for your own site use `--origin https://your.site`. Origins must match exactly (scheme, host, port).
- **Safari.** Safari blocks a secure page from talking to `ws://127.0.0.1`. Use Chrome or Edge for the hosted app, or the local app (`npm start`) in Safari. Chrome and Edge may show a Private Network Access prompt for the hosted app: allow it.
- **Port 7777 in use.** Another server is running (the tool error says so). Stop it. `DOLOYO_PORT` changes the server port, but the app connects to 7777 only.
- **Timeouts on long renders.** Renders and video analysis run in the tab (limits: 10 minutes for a render, 30 for Copy Dance). Keep the tab in the foreground, use a smaller size or fps, or export `png_seq`. A call that fails with "Timed out waiting for the browser" usually means the tab is in the background or busy.
- **"Permission denied".** The user's permission mode is too low; ask them to raise it in the Agent panel.
- **An edit seems to vanish.** The object has keys and the playhead moved. Seek, set, then `key_add`.
- **A picture does not show.** Reference images are stored in the browser that received them; after clearing site data or opening the project elsewhere they are gone (the app warns). Add them again with `image_add`.

Full reference: [docs/AGENT.md](docs/AGENT.md).
