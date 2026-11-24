import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readSync, statSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { basename, dirname, extname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { BridgeError, type Bridge } from './bridge.js';

const here = dirname(fileURLToPath(import.meta.url));
const RENDER_TIMEOUT_MS = 10 * 60 * 1000;
const MOCAP_TIMEOUT_MS = 30 * 60 * 1000;
const UPLOAD_CHUNK = 3_000_000; // raw bytes per bridge call (4 MB base64)
const MAX_VIDEO_BYTES = 600 * 1024 * 1024;
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const IMAGE_MIME: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml' };
const VIDEO_MIME: Record<string, string> = { '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm', '.mkv': 'video/x-matroska' };

const JOINTS = [
  'hips', 'spine', 'chest', 'neck', 'head',
  'L_shoulder', 'L_elbow', 'L_wrist', 'R_shoulder', 'R_elbow', 'R_wrist',
  'L_hip', 'L_knee', 'L_ankle', 'R_hip', 'R_knee', 'R_ankle',
] as const;

const num = z.number().finite();
const vec3 = z.tuple([num, num, num]);
const objectRef = z.string().min(1).describe('Object id or name (see scene_get).');
const joint = z.enum(JOINTS).describe('Joint name. L = character left (+X), R = character right.');
const easing = z.union([
  z.enum(['linear', 'easeIn', 'easeOut', 'easeInOut', 'step']),
  z
    .object({ type: z.literal('bezier'), c: z.tuple([num, num, num, num]) })
    .describe('Cubic bezier time curve like CSS cubic-bezier(x1,y1,x2,y2): c = [x1,y1,x2,y2], x1 and x2 in 0..1, y free (overshoot allowed). Example ease-in-out: [0.42,0,0.58,1].'),
]);
const limb = z.enum(['L_arm', 'R_arm', 'L_leg', 'R_leg']).describe('Limb: L_arm/R_arm (shoulder-elbow-wrist) or L_leg/R_leg (hip-knee-ankle).');
const target = z
  .union([z.string(), z.array(z.string())])
  .optional()
  .describe('"all" (default), one channel ("position","rotation","scale","hipsPos" or a joint name; the render camera has "position","target","fov") or an array of channels.');
const time = z.number().min(0).optional().describe('Time in seconds. Defaults to the playhead. Snaps to the frame grid.');
const frame = z.number().int().min(0).optional().describe('Frame number (alternative to time, uses the project fps).');
const bodyPreset = z.enum(['kecil', 'pendek', 'remaja', 'dewasa']).describe('Body size: kecil = baby/toddler (~12 months, 0.75 m, big head, short limbs), pendek = child (~6-7 years, 1.20 m), remaja = teenager (1.62 m, F 1.58 m), dewasa = adult (1.75 m, F 1.65 m; the default look).');
const bodySpec = z
  .object({
    preset: bodyPreset,
    heightScale: z.number().min(0.9).max(1.1).optional().describe('Fine-tune of the preset height, 0.9 to 1.1 (default 1).'),
    gender: z.enum(['m', 'f']).optional().describe('Only a subtle proportion difference (shoulder width) and the base character; never chest or hip shape. Default: from the character (mannequin-f / superhero-f = f).'),
  })
  .describe('Body size of a mannequin.');
const imageMode = z.enum(['background', 'plane', 'camera']).describe('background = screen-space image behind the viewport, plane = textured plane object in the 3D scene, camera = image locked to the render camera frame.');
const imageSlot = z.enum(['viewport', 'camera']).describe('Which background: the viewport background or the render-camera background.');
const imageFit = z.enum(['fit', 'fill', 'center']).describe('Backgrounds: fit = whole picture visible, fill = covers the frame (cropped), center = original pixel size.');
const keyRef = z.object({ object: objectRef, target, time, frame });

type Content = { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string };
interface ToolResult {
  [k: string]: unknown;
  content: Content[];
  isError?: boolean;
}

const text = (t: string): ToolResult => ({ content: [{ type: 'text', text: t }] });
const errorResult = (e: unknown): ToolResult => ({
  isError: true,
  content: [{ type: 'text', text: e instanceof BridgeError ? e.message : 'Error: ' + (e instanceof Error ? e.message : String(e)) }],
});

function readGuide(): string {
  const candidates = [resolve(here, '..', '..', 'docs', 'AGENT.md'), resolve(here, '..', 'guide', 'AGENT.md')];
  for (const p of candidates) if (existsSync(p)) return readFileSync(p, 'utf8');
  throw new Error('AGENT.md not found (looked in ' + candidates.join(', ') + ')');
}

// The browser is untrusted here: never take the extension or a path from its reply.
const EXPORT_EXT: Record<string, string> = { png: 'png', png_seq: 'zip', webm: 'webm', mp4: 'mp4', glb: 'glb', bvh: 'bvh', project: 'mdoll.json' };

function safeStem(raw: unknown, ext: string): string {
  let s = basename(String(raw ?? '').replace(/\\/g, '/'));
  if (s.toLowerCase().endsWith('.' + ext)) s = s.slice(0, -(ext.length + 1));
  s = s.replace(/[<>:"|?*\u0000-\u001f]/g, '_').replace(/^[. ]+|[. ]+$/g, '').slice(0, 120);
  return s || 'doloyo';
}

/** Writes without ever replacing an existing file; returns the path used. */
function writeNew(dir: string, stem: string, ext: string, bytes: Buffer): string {
  for (let i = 0; i < 1000; i++) {
    const path = resolve(dir, `${stem}${i ? `-${i}` : ''}.${ext}`);
    try {
      writeFileSync(path, bytes, { flag: 'wx' });
      return path;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
    }
  }
  throw new Error('Too many files with the same name');
}

/** Read a local file and stream it to the browser in chunks (same transfer as video uploads). Returns the upload id. */
async function uploadFile(bridge: Bridge, file: string, size: number): Promise<string> {
  const uploadId = randomBytes(8).toString('hex');
  const total = Math.ceil(size / UPLOAD_CHUNK);
  const fd = openSync(file, 'r');
  try {
    const buf = Buffer.alloc(UPLOAD_CHUNK);
    for (let seq = 0; seq < total; seq++) {
      const n = readSync(fd, buf, 0, UPLOAD_CHUNK, seq * UPLOAD_CHUNK);
      await bridge.call('mocap_upload', { uploadId, seq, total, data: buf.subarray(0, n).toString('base64') }, 60_000);
    }
  } finally {
    closeSync(fd);
  }
  return uploadId;
}

function stamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

export function registerTools(server: McpServer, bridge: Bridge): void {
  const guard =
    <A>(fn: (args: A) => Promise<ToolResult> | ToolResult) =>
    async (args: A): Promise<ToolResult> => {
      try {
        return await fn(args);
      } catch (e) {
        return errorResult(e);
      }
    };

  /** Forward to the browser and return its JSON as text. */
  const forward = async (method: string, params: unknown, timeout?: number): Promise<ToolResult> => {
    const r = await bridge.call(method, params, timeout);
    return text(JSON.stringify(r.data));
  };

  /** Edit tools: the tool name is the command type, args are the command fields. */
  const command = <S extends z.ZodRawShape>(name: string, description: string, shape: S) =>
    server.registerTool(
      name,
      { description, inputSchema: shape },
      guard(async (args: unknown) => forward('dispatch', { type: name, ...(args as object) })) as never,
    );

  // ---- meta ----

  server.registerTool(
    'bridge_status',
    {
      description:
        'Report whether the Doloyo browser app is connected to this MCP server. If not connected, tell the user the pairingCode and ask them to open the app, open the Agent panel and click Connect.',
    },
    guard(async () =>
      text(
        JSON.stringify({
          connected: bridge.connected,
          pairingCode: bridge.code,
          port: bridge.port,
          listening: bridge.listening,
          ...(bridge.listenError ? { error: bridge.listenError } : {}),
        }),
      ),
    ),
  );

  server.registerTool(
    'guide_read',
    {
      description:
        'Read the Doloyo agent guide (command semantics, joint axes, keyframe workflow, examples). Read it once before animating.',
    },
    guard(async () => text(readGuide())),
  );

  // ---- read ----

  server.registerTool(
    'scene_get',
    {
      description:
        'Get a compact JSON summary of the scene: fps, duration, playhead time, every object (id, name, kind, transform, non-rest joint pose, key times per channel), joint names, available pose presets and saved custom poses, undo/redo availability. Call this before editing to learn object ids and the current state.',
    },
    guard(async () => forward('scene_get', {})),
  );

  server.registerTool(
    'viewport_snapshot',
    {
      description:
        'Render the current viewport (at the current playhead) to a PNG image and return it so you can look at the result. Grid and gizmos are hidden. Default 960x540.',
      inputSchema: {
        width: z.number().int().min(64).max(4096).optional().describe('Pixel width, default 960.'),
        height: z.number().int().min(64).max(4096).optional().describe('Pixel height, default 540.'),
      },
    },
    guard(async (args: { width?: number; height?: number }) => {
      const r = await bridge.call('viewport_snapshot', args);
      const d = r.data as { data: string; mimeType: string; width: number; height: number };
      return {
        content: [
          { type: 'image', data: d.data, mimeType: d.mimeType },
          { type: 'text', text: `Viewport ${d.width}x${d.height}` },
        ],
      };
    }) as never,
  );

  // ---- edit ----

  command(
    'object_add',
    'Add an object. Returns the new object id and name. A new mannequin starts in the rest pose (arms down). kind "camera" adds the render camera (only one allowed; camera_set also creates it).',
    {
      kind: z.enum(['mannequin', 'cube', 'sphere', 'cylinder', 'camera']),
      name: z.string().optional(),
      character: z.string().optional().describe('Mannequins only: doll-procedural, mannequin-f (default), mannequin-m, superhero-m, superhero-f or custom:<id> of an imported character.'),
      position: vec3.optional().describe('[x,y,z] meters, Y up. Default: next free slot beside the others.'),
      body: bodySpec.optional().describe('Mannequins only: body size. kecil and pendek use the neutral mannequin-m mesh for both genders (a girl keeps gender f), dewasa f uses mannequin-f. Superhero characters only allow remaja and dewasa.'),
    },
  );
  command(
    'object_set_character',
    'Change which character a mannequin is drawn with (the pose and keys are unchanged, any character is just a different view of the same 17-joint pose). Built-in: doll-procedural, mannequin-f, mannequin-m, superhero-m, superhero-f; imported ones are custom:<id> (scene_get shows each mannequin character). material: doll = matte grey, original = the character textures; omit to keep the current one.',
    {
      object: objectRef,
      character: z.string().min(1),
      material: z.enum(['doll', 'original']).optional(),
    },
  );
  command(
    'object_set_body',
    'Set the body size of a mannequin: preset kecil (baby ~0.75 m, 4 head-heights), pendek (child ~1.20 m), remaja (teen ~1.62 m) or dewasa (adult), a heightScale 0.9..1.1 fine-tune and/or gender. Proportions (leg, torso, arm, neck, head, shoulder and hip width) change everywhere: IK, foot pins, exports and the picture all match, and the feet stay on the floor. Pose data are rotations, so keys and animation clips work on any body unchanged; hipsPos keys are stored in adult units and scaled by the body. Small presets switch built-in mannequins to the neutral mannequin-m mesh (dewasa female uses mannequin-f). Superhero characters only support remaja and dewasa (error otherwise). Pinned feet are removed (undo brings them back). Baby poses for pose_apply: duduk (sitting), merangkak (crawling), berdiri_pegangan (standing, holding on).',
    {
      object: objectRef,
      preset: bodyPreset.optional(),
      heightScale: z.number().min(0.9).max(1.1).optional().describe('0.9 to 1.1, relative to the preset height (1 = the preset).'),
      gender: z.enum(['m', 'f']).optional().describe('m or f: subtle proportion difference only; also maps to the right base character.'),
    },
  );
  command('object_remove', 'Remove an object (undoable).', { object: objectRef });

  // ---- reference images ----

  server.registerTool(
    'image_add',
    {
      description:
        'Add a reference image from a LOCAL file (undoable). The MCP server reads the file and streams it to the browser, which stores it (IndexedDB, in that browser only; no URLs). Modes: "background" = screen-space picture behind the viewport, "plane" = textured plane object in the 3D scene (transform it with object_transform, key it like a shape), "camera" = picture locked to the render camera frame (visible when looking through the camera; composited in renders). Display options: opacity 0..1; inRender (draw it in snapshots, exports and GLB; default true); backgrounds: fit, visible; planes: locked (not selectable in the viewport), billboard (always faces the camera), doubleSided. A plane is placed 1.2 m behind the origin, 1.6 m high by default (position, rotation, scale override). The reply lists created (the plane id) for mode "plane". Adding a background replaces the previous one of that slot. Needs "Edit" permission.',
      inputSchema: {
        path: z.string().min(1).optional().describe('Absolute path of a png, jpg, webp, gif (first frame) or svg file on the machine running this MCP server, up to 20 MB.'),
        imageId: z.string().min(1).optional().describe('Id of a picture already stored in the browser (alternative to path).'),
        mode: imageMode,
        name: z.string().optional(),
        opacity: z.number().min(0).max(1).optional(),
        inRender: z.boolean().optional(),
        fit: imageFit.optional(),
        visible: z.boolean().optional().describe('Backgrounds only.'),
        locked: z.boolean().optional().describe('Planes only.'),
        billboard: z.boolean().optional().describe('Planes only: always face the camera (rotation is ignored).'),
        doubleSided: z.boolean().optional().describe('Planes only (default true).'),
        position: vec3.optional().describe('Planes only.'),
        rotation: vec3.optional().describe('Planes only, degrees.'),
        scale: vec3.optional().describe('Planes only: the plane is aspect x 1 m before the scale (default scale [1.6,1.6,1.6]).'),
      },
    },
    guard(async (args: { path?: string; imageId?: string; mode: string } & Record<string, unknown>) => {
      const { path, ...params } = args;
      if ((path === undefined) === (params.imageId === undefined)) throw new Error('Give exactly one of path (a local file) or imageId');
      if (path === undefined) return forward('dispatch', { type: 'image_add', ...params });
      if (/^[a-z][a-z0-9+.-]*:\/\//i.test(path)) throw new Error('Only local files are supported (no URLs). Download the image first and pass its absolute path.');
      if (!isAbsolute(path)) throw new Error('path must be an absolute path');
      const file = resolve(path);
      if (!existsSync(file)) throw new Error(`File not found: ${file}`);
      const mime = IMAGE_MIME[extname(file).toLowerCase()];
      if (!mime) throw new Error(`Unsupported image type "${extname(file)}" (use png, jpg, webp, gif or svg)`);
      const size = statSync(file).size;
      if (size === 0 || size > MAX_IMAGE_BYTES) throw new Error(`Image must be between 1 byte and ${MAX_IMAGE_BYTES / 1048576} MB (got ${size} bytes)`);
      const uploadId = await uploadFile(bridge, file, size);
      return forward('dispatch', { type: 'image_add', ...params, uploadId, mime, filename: basename(file) });
    }) as never,
  );
  command(
    'image_set',
    'Change a reference image (undoable). Target a plane with object (id or name), or a background with background "viewport" | "camera". Planes accept opacity, locked, billboard, doubleSided, inRender, name; backgrounds accept opacity, visible, fit, inRender, name. Options that do not apply to the target are an error. Move, rotate and scale planes with object_transform.',
    {
      object: objectRef.optional().describe('Image plane id or name.'),
      background: imageSlot.optional(),
      name: z.string().optional(),
      opacity: z.number().min(0).max(1).optional(),
      inRender: z.boolean().optional().describe('Include in snapshots, exports and GLB.'),
      visible: z.boolean().optional().describe('Backgrounds only.'),
      fit: imageFit.optional(),
      locked: z.boolean().optional().describe('Planes only: not selectable in the viewport.'),
      billboard: z.boolean().optional().describe('Planes only: always face the camera.'),
      doubleSided: z.boolean().optional().describe('Planes only.'),
    },
  );
  command('image_remove', 'Remove an image plane (object) or a background (background "viewport" | "camera"). Undoable. The picture stays stored in the browser.', {
    object: objectRef.optional().describe('Image plane id or name.'),
    background: imageSlot.optional(),
  });
  command(
    'object_transform',
    'Set an object transform and/or rename it. Rotation is Euler XYZ in degrees, position in meters (Y up), the character faces +Z. Only the given fields change. Edits are lost on the next playhead move if that channel has keys; add a key afterwards (key_add).',
    {
      object: objectRef,
      name: z.string().optional(),
      position: vec3.optional(),
      rotation: vec3.optional().describe('Degrees.'),
      scale: vec3.optional(),
    },
  );
  command(
    'joint_set',
    'Set a mannequin joint rotation (Euler XYZ degrees, clamped to human joint limits). Left arm: rotation[2] > 0 raises the arm sideways, rotation[0] < 0 raises it forward. Elbow bends with negative X, knee with positive X, hip flexion (thigh forward) is negative X. Right side mirrors Y and Z. Hips can also be translated with position (offset from rest, meters).',
    {
      object: objectRef,
      joint,
      rotation: vec3.optional(),
      position: vec3.optional().describe('Hips only: offset from rest in meters.'),
    },
  );
  command(
    'pose_apply',
    'Apply a pose to a mannequin: a preset ("stand","t_pose","crouch","kneel","point","wave_up","duduk","merangkak","berdiri_pegangan"; the three baby poses solve the hips height from the body so hands, knees and feet rest on the floor), a saved custom pose name, or an inline pose {joints:{name:[x,y,z]}, hipsPos?}. A preset/name resets every joint first; with partial=true and an inline pose only the listed joints change.',
    {
      object: objectRef,
      pose: z.union([
        z.string(),
        z.object({ joints: z.record(z.string(), vec3), hipsPos: vec3.optional() }),
      ]),
      partial: z.boolean().optional(),
    },
  );
  command('pose_save', 'Save the mannequin current pose into the project pose library under a name (overwrites an existing custom pose with that name). Saved poses are part of the project file.', {
    object: objectRef,
    name: z.string().min(1).max(40),
  });
  command('pose_delete', 'Delete a custom pose from the pose library.', { name: z.string().min(1) });
  command('pose_mirror', 'Copy one side of the pose to the other (L to R or R to L), mirroring the rotations.', {
    object: objectRef,
    from: z.enum(['L', 'R']).describe('Side to copy FROM.'),
  });
  command('joint_reset', 'Reset one joint, or the whole pose when joint is omitted, to the rest pose.', {
    object: objectRef,
    joint: joint.optional(),
  });
  command(
    'key_add',
    'Record a keyframe of the object CURRENT values at the given time (default: playhead). Pattern: playhead_seek, set values (joint_set/pose_apply/object_transform), key_add. Playback and playhead_seek overwrite keyed channels with their sampled values, so always key what you set.',
    {
      object: objectRef,
      target,
      time,
      frame,
      easing: easing.optional().describe('Easing of the segment that starts at this key (named or bezier).'),
      bakePins: z.boolean().optional().describe('Mannequins with pinned feet: also key the pinned legs (hip/knee/ankle) and remove the pins, so the result stays without them.'),
    },
  );
  command('key_remove', 'Remove the key at a time.', { object: objectRef, target, time, frame });
  command('key_move', 'Move a key to another time.', {
    object: objectRef,
    target,
    time,
    frame,
    to: z.number().min(0).optional().describe('New time in seconds.'),
    toFrame: z.number().int().min(0).optional().describe('New frame number.'),
  });
  command('key_set_easing', 'Set the easing of the segment starting at a key: linear, easeIn, easeOut, easeInOut, step, or a custom cubic bezier {type:"bezier", c:[x1,y1,x2,y2]}.', { object: objectRef, target, time, frame, easing });
  command(
    'keys_edit',
    'Move several keys and/or set their values as ONE undo step. Each edit selects a key (object, target, time|frame) and gives to|toFrame (new time) and/or value ([x,y,z] for that channel; rotation channels in Euler degrees; fov uses value[0]). Colliding keys at the destination are replaced.',
    {
      edits: z
        .array(keyRef.extend({ to: z.number().min(0).optional(), toFrame: z.number().int().min(0).optional(), value: vec3.optional() }))
        .min(1)
        .max(500),
    },
  );
  command('keys_remove', 'Remove several keys as ONE undo step.', { keys: z.array(keyRef).min(1).max(500) });
  command(
    'ik_reach',
    'Inverse kinematics: move a limb end (wrist or ankle joint) to a WORLD position [x,y,z] in meters (Y up, character faces +Z). Two-bone analytic solve; the elbow/knee keeps its current side unless you give pole (a world point the elbow/knee should point toward) or poleAngle (degrees of swivel around the shoulder-to-target axis; 0 = knee forward / elbow backward). Targets beyond the limb length give a fully extended limb pointing at the target; joint limits are applied loosely (clamped). Writes the joint rotations (undoable as one step); key them afterwards with key_add. On a pinned foot it also moves the pin.',
    {
      object: objectRef,
      limb,
      target: vec3.describe('World position of the wrist/ankle joint.'),
      pole: vec3.optional().describe('World point the elbow/knee should point toward.'),
      poleAngle: z.number().optional().describe('Swivel in degrees (alternative to pole).'),
    },
  );
  command(
    'ik_pin',
    'Pin (or unpin) a foot to a world position. While pinned, the leg is re-solved by IK whenever the hips, pose or object move (also during playback and export), so the foot does not slide. position defaults to where the ankle is now. Use ik_bake to turn the result into plain keys.',
    {
      object: objectRef,
      limb: z.enum(['L_leg', 'R_leg', 'L_foot', 'R_foot']),
      pinned: z.boolean(),
      position: vec3.optional().describe('World position of the ankle joint (default: its current position).'),
    },
  );
  command(
    'ik_bake',
    'Key the pinned legs (hip, knee, ankle) on every frame between start and end (default: the range of the existing keys, else the whole duration), then remove the pins (unpin default true) so the result stays without them. One undo step.',
    { object: objectRef, start: z.number().min(0).optional(), end: z.number().min(0).optional(), unpin: z.boolean().optional() },
  );
  command(
    'camera_set',
    'Set the render camera (kind "camera"; created automatically if the scene has none): position (eye, meters), target (look-at point) and fov (vertical degrees, 1..170). Exports (png, png_seq, webm, mp4, glb) use this camera, animated by its keys. Animate it like other objects: playhead_seek, camera_set, key_add {object: <camera id or name>} (channels position, target, fov).',
    {
      object: objectRef.optional().describe('Camera object id or name (default: the render camera).'),
      position: vec3.optional(),
      target: vec3.optional(),
      fov: z.number().min(1).max(170).optional(),
    },
  );
  command(
    'scene_preset',
    'Add a formation of new mannequins in an arc facing the audience (+Z): duo (2), trio (3), group5 (5) or keluarga (4: father, child, baby sitting, mother), as ONE undo step. Mixed gender by default (alternating mannequin-f / mannequin-m). clear=true first removes the existing mannequins. character picks one model for every new doll (adults in keluarga follow the family gender for superhero ids). body sets one body size for every doll (not for keluarga, which has fixed sizes).',
    { preset: z.enum(['duo', 'trio', 'group5', 'keluarga']), character: z.string().optional(), clear: z.boolean().optional(), body: bodySpec.optional() },
  );
  command('timeline_set', 'Set the project fps (1..240), duration in seconds and/or loop flag.', {
    fps: z.number().int().min(1).max(240).optional(),
    duration: z.number().min(0.1).max(3600).optional(),
    loop: z.boolean().optional(),
  });
  command('playhead_seek', 'Move the playhead. Keyed channels are evaluated at that time.', { time, frame });
  command(
    'batch',
    'Run several commands as ONE undo step. Each item is a command object like {"type":"joint_set","object":"Mannequin 1","joint":"head","rotation":[0,20,0]}; allowed types are the other edit tool names. If one fails the earlier ones in the batch may already be applied: check the error.',
    { commands: z.array(z.object({ type: z.string() }).passthrough()).min(1).max(500) },
  );

  server.registerTool(
    'undo',
    {
      description: 'Undo the last edit(s). Agent edits and user edits share one history.',
      inputSchema: { steps: z.number().int().min(1).max(50).optional().describe('Default 1.') },
    },
    guard(async (args: { steps?: number }) => forward('undo', args)) as never,
  );
  server.registerTool(
    'redo',
    {
      description: 'Redo the last undone edit(s).',
      inputSchema: { steps: z.number().int().min(1).max(50).optional().describe('Default 1.') },
    },
    guard(async (args: { steps?: number }) => forward('redo', args)) as never,
  );

  // ---- animation library ----

  server.registerTool(
    'anim_list',
    {
      description:
        'List the built-in animation clips (86 CC0 clips by Quaternius: walks, runs, idles, sword, dance, sitting...). Optional query filters by name. Clip ids look like "ual1/Dance_Loop"; names alone also work in anim_apply.',
      inputSchema: { query: z.string().optional().describe('Case-insensitive substring, e.g. "walk" or "sword".') },
    },
    guard(async (args: { query?: string }) => forward('anim_list', args)) as never,
  );

  server.registerTool(
    'anim_apply',
    {
      description:
        'Bake a library clip onto mannequins as keyframes (ONE undo step). The clip is sampled on the Quaternius skeleton and converted to our 17-joint pose, so it works for every character type. Defaults: selected mannequin (else all), start at the playhead, speed 1, 1 loop, a key every frame, timeline extended if needed. Keys of the written range are replaced, and the part after it of an EARLIER anim_apply run that overlaps it is dropped (a later clip supersedes the rest of an earlier one on the same joints; hand-made keys are kept). Use duration to cut a looped clip short. Returns the keys added and the new duration.',
      inputSchema: {
        clip: z.string().min(1).describe('Clip id or name from anim_list.'),
        objects: z.array(z.string()).optional().describe('Mannequin ids or names. Default: selected mannequin, else every mannequin.'),
        start: z.number().min(0).optional().describe('Start time in seconds. Default: the playhead.'),
        speed: z.number().min(0.05).max(20).optional(),
        loops: z.number().int().min(1).max(50).optional(),
        keyEvery: z.number().int().min(1).max(30).optional().describe('Frames between keys (1 = every frame; 2, 3 or 5 give lighter, easier-to-edit tracks).'),
        mirror: z.boolean().optional().describe('Mirror left/right.'),
        inPlace: z.boolean().optional().describe('Remove horizontal hips travel (keep height).'),
        extend: z.boolean().optional().describe('Grow the timeline duration if the clip is longer. Default true.'),
        duration: z.number().positive().max(3600).optional().describe('Trim the run to this many seconds from start: loops and clip keys past it are not written. Default: the full run (clip length x loops / speed).'),
      },
    },
    guard(async (args: Record<string, unknown>) => forward('anim_apply', args, RENDER_TIMEOUT_MS)) as never,
  );

  // ---- copy dance (video motion capture) ----

  server.registerTool(
    'mocap_from_video',
    {
      description:
        'Copy Dance: motion capture from a local video file. The MCP server reads the file and streams it to the browser, which runs MediaPipe pose tracking fully locally and bakes keys (ONE undo step). Needs "Edit" permission, the browser tab open, and the pose model installed (npm run fetch-models). Tracks (people) are numbered; use assign to map tracks to dolls, or leave it empty: track 1 goes to the selected/first mannequin and further tracks create new dolls. Returns the tracks found and the keys added. Can take minutes for long videos. Works best with a steady camera, whole body visible, good light.',
      inputSchema: {
        path: z.string().min(1).describe('Absolute path of the video file on the machine running this MCP server (mp4, webm, mov).'),
        maxPeople: z.number().int().min(1).max(4).optional().describe('Max people to track (default 1).'),
        assign: z
          .array(z.object({ track: z.number().int().min(1), object: z.string().min(1).describe('Mannequin id or name, or "new" to create a doll.') }))
          .optional(),
        fps: z.number().int().min(5).max(60).optional().describe('Sampling fps (default: the project fps).'),
        smoothing: z.number().min(0).max(1).optional().describe('0 = raw, 1 = very smooth (One-Euro filter). Default 0.5.'),
        footLock: z.boolean().optional().describe('Pin the lowest foot to the floor (default true).'),
        inPlace: z.boolean().optional().describe('No hip travel across the scene (default false).'),
        mirror: z.boolean().optional().describe('Mirror left/right for selfie videos (default false).'),
        keyEvery: z.number().int().min(1).max(30).optional().describe('Frames between keys (default 1).'),
        start: z.number().min(0).optional().describe('Start time in seconds. Default: the playhead.'),
      },
    },
    guard(async (args: { path: string } & Record<string, unknown>) => {
      const { path, ...params } = args;
      if (!isAbsolute(path)) throw new Error('path must be an absolute path');
      const file = resolve(path);
      if (!existsSync(file)) throw new Error(`File not found: ${file}`);
      const mime = VIDEO_MIME[extname(file).toLowerCase()];
      if (!mime) throw new Error(`Unsupported video type "${extname(file)}" (use mp4, webm or mov)`);
      const size = statSync(file).size;
      if (size === 0 || size > MAX_VIDEO_BYTES) throw new Error(`Video must be between 1 byte and ${MAX_VIDEO_BYTES / 1048576} MB (got ${size} bytes)`);
      const uploadId = await uploadFile(bridge, file, size);
      return forward('mocap_from_video', { ...params, uploadId, mime }, MOCAP_TIMEOUT_MS);
    }) as never,
  );

  // ---- render ----

  server.registerTool(
    'render_export',
    {
      description:
        'Render/export locally and save the file on the machine running this MCP server; returns the absolute path. Needs "Edit + Render" permission in the app. Formats: png (current frame), png_seq (zip of PNG frames for the whole duration), webm, mp4 (needs WebCodecs in the browser; otherwise use png_seq), glb (animated glTF binary for Blender/Unity/Unreal: all mannequins and shapes, or the ones in "objects", baked at fps, plus the render camera), bvh (17-joint motion of the first listed/selected mannequin), project (.mdoll.json). If a render camera exists, image/video exports use it (animated); otherwise the current editor view. Reference images and image planes are drawn when their inRender option is on. Default size 1280x720; fps defaults to the project fps. Long renders can take minutes.',
      inputSchema: {
        format: z.enum(['png', 'png_seq', 'webm', 'mp4', 'glb', 'bvh', 'project']),
        width: z.number().int().min(16).max(7680).optional(),
        height: z.number().int().min(16).max(7680).optional(),
        fps: z.number().int().min(1).max(240).optional(),
        transparent: z.boolean().optional().describe('Transparent background (png and png_seq only).'),
        objects: z.array(z.string()).optional().describe('glb/bvh only: object ids or names to export (default: all).'),
        outDir: z.string().optional().describe('Output directory. Default: ./renders under the MCP server working directory.'),
        filename: z.string().optional().describe('File name (no directory; the extension follows the format; existing files are never replaced). Default: project name plus timestamp.'),
      },
    },
    guard(async (args: { format: string; width?: number; height?: number; fps?: number; transparent?: boolean; objects?: string[]; outDir?: string; filename?: string }) => {
      const { outDir, filename, ...params } = args;
      const r = await bridge.call('render_export', params, RENDER_TIMEOUT_MS);
      const d = r.data as { filename: string; ext: string; width: number; height: number; fps: number; frames: number; bytes: number };
      if (!r.bytes) throw new Error('Browser returned no data');
      if (r.bytes.length !== d.bytes) throw new Error(`Received ${r.bytes.length} bytes but the browser reported ${d.bytes}`);
      const dir = resolve(outDir ?? resolve(process.cwd(), 'renders'));
      mkdirSync(dir, { recursive: true });
      const ext = EXPORT_EXT[args.format];
      const stem = filename ? safeStem(filename, ext) : `${safeStem(d.filename, ext)}_${stamp()}`;
      const path = writeNew(dir, stem, ext, r.bytes);
      return text(JSON.stringify({ path, bytes: r.bytes.length, format: args.format, width: d.width, height: d.height, fps: d.fps, frames: d.frames }));
    }) as never,
  );
}
