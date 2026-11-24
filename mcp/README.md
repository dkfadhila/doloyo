# doloyo-mcp

Local MCP server for Doloyo. It speaks MCP on stdio to your agent and runs a WebSocket bridge on `127.0.0.1:7777` that the Doloyo browser tab connects to. Everything stays on your machine.

```
agent  --stdio (MCP)-->  doloyo-mcp  --WebSocket 127.0.0.1:7777-->  Doloyo (browser tab)
```

## Build

From the repository folder:

```
npm run mcp:install
npm run mcp:build
```

or inside `mcp/`: `npm install && npm run build`. Needs Node 18+.

## Register with an agent

Claude Code:

```
claude mcp add doloyo -- node D:/path/to/doloyo/mcp/dist/index.js
```

Claude Desktop (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "doloyo": {
      "command": "node",
      "args": ["D:/path/to/doloyo/mcp/dist/index.js"],
      "env": { "DOLOYO_PORT": "7777" }
    }
  }
}
```

The package is not on npm: run it from a clone as shown above. Do not install a package of this name from npm.

## Command line

```
doloyo-mcp [--origin <url>]... [--allow-hosted] [--port <n>] [--help] [--version]
```

| Flag | Meaning |
| --- | --- |
| `--origin <url>` | Allow this browser origin (repeatable, `--origin=<url>` also works). Paths are dropped, so `https://studio.example.com/app` becomes `https://studio.example.com`. |
| `--allow-hosted` | Also allow the origins in the `HOSTED_ORIGINS` constant (`src/bridge.ts`). Currently `https://doloyo.vercel.app`, `https://doloyo.tirtavex.tech`, and the two former hosts `https://doll.tirtavex.tech` and `https://motion-doll-studio.vercel.app`. |
| `--port <n>` | WebSocket port (same as `DOLOYO_PORT`; the app expects 7777). |
| `--help`, `--version` | Print usage or the version to stdout and exit. |

Using a hosted copy of the app: start the server with its origin, for example `claude mcp add doloyo -- node <path>/mcp/dist/index.js --allow-hosted`, open the site, and connect with the pairing code. The page keeps using `ws://127.0.0.1:7777` even when it is served over https. Chrome and Edge may show a Private Network Access prompt (allow it); Safari blocks this connection, so use the local install there.

## Pairing flow

1. Start the app (`npm run dev`, http://localhost:5173).
2. The MCP server prints `[doloyo] Pairing code: 482913 ...` on stderr and writes the code to `doloyo-pairing.txt` (and, for older scripts, `motion-doll-pairing.txt`) in the OS temp folder (`%TEMP%` on Windows). The agent can also call `bridge_status` and tell you the code.
3. In the app click the **Agent** pill (top right), enter the code, click **Connect**. The dot turns green.
4. Choose the permission mode: Read-only, Edit, or Edit + Render.

If the agent calls a tool before you connect, it gets an error that includes the code and tells it to ask you to connect.

## Security model

- Binds to 127.0.0.1 only.
- Accepts WebSocket upgrades only from allowed origins: `http://localhost:5173`, `http://127.0.0.1:5173`, plus the comma-separated `DOLOYO_ORIGINS` (or former `MOTION_DOLL_ORIGINS`) env var, every `--origin` flag, and with `--allow-hosted` the built-in hosted origins. Missing or other origins get HTTP 403.
- The first message must be `{type:"hello", code}` with the pairing code, within 5 seconds; a wrong code closes the socket (4001). After 5 wrong attempts a new code is generated.
- One active browser connection; a newer one replaces the older (older gets close code 4002).
- The browser enforces the permission mode and refuses internal undo commands, so a connected agent can never exceed what the user allowed in the panel.
- Stdout is reserved for the MCP protocol; all logs go to stderr.

## Environment

| Variable | Default | Meaning |
| --- | --- | --- |
| `DOLOYO_PORT` | `7777` | WebSocket port (the app expects 7777). The former `MOTION_DOLL_PORT` still works. |
| `DOLOYO_ORIGINS` | none | Extra allowed origins, comma separated (the `--origin` flag does the same). The former `MOTION_DOLL_ORIGINS` still works. |

## Tools

`bridge_status`, `guide_read`, `scene_get`, `object_add`, `object_remove`, `image_add` (reference image from a local file: viewport background, image plane or render-camera background; the server streams the file, up to 20 MB, no URLs), `image_set`, `image_remove`, `object_transform`, `joint_set`, `pose_apply`, `pose_save`, `pose_delete`, `pose_mirror`, `joint_reset`, `key_add`, `key_remove`, `key_move`, `key_set_easing` (named or bezier easing), `keys_edit`, `keys_remove`, `ik_reach`, `ik_pin`, `ik_bake` (inverse kinematics and foot pins), `camera_set` (the animated render camera), `scene_preset` (duo, trio, group of 5, keluarga; mixed gender), `object_set_body` (body size kecil / pendek / remaja / dewasa, height fine-tune, gender; `object_add` and `scene_preset` also take `body`), `timeline_set`, `playhead_seek`, `batch`, `undo`, `redo`, `viewport_snapshot` (returns an image), `object_set_character` (switch a mannequin between the built-in characters and imported `custom:` ones; the pose is unchanged), `anim_list` / `anim_apply` (86 CC0 animation clips baked as keys), `mocap_from_video` (Copy Dance: this server reads a local video file, streams it to the browser in 3 MB chunks, the browser runs MediaPipe locally and bakes keys; needs `npm run fetch-models` once in the app folder), `render_export` (png, png_seq, webm, mp4, glb, bvh, project; image/video exports use the render camera when the scene has one; the file is written by this server, default `./renders` under its working directory, and the absolute path is returned).

The semantics of every command are in [../docs/AGENT.md](../docs/AGENT.md) (also served by `guide_read`).

## Troubleshooting

- "Port 7777 is already in use": another instance is running. Stop it or set `DOLOYO_PORT` (the app currently connects to 7777 only).
- Connection never goes green: open the browser console; check the origin is exactly `http://localhost:5173` (or add yours with `--origin <url>` or `DOLOYO_ORIGINS`).
- **MCP client request timeout (60 s default).** The MCP SDK clients (TypeScript and Python) give up on a request after 60 seconds, even though the server and the tab keep rendering. Long `render_export` calls (and `anim_apply`, `mocap_from_video`) then fail on the client with `MCP error -32001: Request timed out`. Raise the per-call timeout. TypeScript SDK:

  ```ts
  const res = await client.callTool(
    { name: 'render_export', arguments: { format: 'mp4', width: 1920, height: 1080 } },
    undefined, // result schema (default)
    { timeout: 10 * 60 * 1000 }, // ms; the server itself waits up to 10 minutes
  );
  ```

  Claude Code and Claude Desktop have their own tool timeout setting (for Claude Code, the `MCP_TOOL_TIMEOUT` environment variable, in ms).
- Some agent clients hide stderr; read the code from the temp file or via `bridge_status`.

## Test

`npm run smoke` (inside `mcp/`, or `npm run smoke --prefix mcp` from the root) builds, checks `--help`/`--version`/`--origin`/`--allow-hosted`, spawns the server over stdio and plays a fake browser: tools list, pairing, origin and code rejection, round trips, chunked render download, and the Phase 2.5 tools (`object_set_character`, `anim_list`, `anim_apply`, and `mocap_from_video` including chunked upload of a 7 MB file and path validation). The script ends with `process.exit`.
