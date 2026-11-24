---
name: doloyo-keyframe-motion
description: Keyframe and motion-design craft for Doloyo dolls driven over the doloyo MCP tools. Use when you pose and key mannequins by hand (pose_apply, joint_set, key_add, ik_reach, ik_pin), mix hand keys with baked library clips, pick easing or bezier curves, time a move, or when an animation looks floaty, robotic, sliding or weightless. Covers pose-to-pose blocking, breakdowns, spacing, holds, overshoot and settle, arcs, weight shifts and the 12 animation principles mapped to the 17-joint doll.
---

# Doloyo keyframe motion

Doloyo stores motion as keys on channels: each mannequin has `position`, `rotation`, `scale`, `hipsPos` and one channel per joint (17 joints, Euler XYZ degrees, slerped). Keys are linear unless you give an easing, and the easing on a key shapes the segment that **starts** at that key. Everything below is about deciding which keys exist, where they sit in time, and how the segments between them are eased.

Read `guide_read` once for the joint axes. Short version: the doll faces +Z, character left is +X; hip flexion (thigh forward) is negative X, knee flexion positive X, elbow flexion negative X; left arm `rotation[2] > 0` raises it sideways, `rotation[0] < 0` raises it forward; the right side mirrors Y and Z.

## The working loop

1. **Block** the story poses only (keys, not in-betweens). Use `step` easing while blocking so you judge poses and timing without interpolation mush.
2. **Time** them: move keys with `keys_edit` until the rhythm reads (count frames, see the timing table).
3. **Breakdowns**: add the one pose between two keys that defines the path (the arc high point, the moment the weight passes over the foot).
4. **Ease**: switch `step` to real easings per segment (`key_set_easing`).
5. **Polish**: overlap (head and arms settle 2 to 4 frames after the hips), overshoot and settle, foot contacts (`ik_pin`), micro-holds.
6. **Check** with `playhead_seek` + `viewport_snapshot` at each key and at the midpoint of every long segment; fix and re-check.

Always: **seek, set, key**. `key_add` records the current values, and any seek or playback overwrites keyed channels with sampled values. Keys accept `frame` directly, so a whole beat fits in one `batch` (one undo step for the user).

```json tool-call
{
  "tool": "batch",
  "arguments": {
    "commands": [
      { "type": "pose_apply", "object": "Lead", "pose": "stand" },
      { "type": "key_add", "object": "Lead", "frame": 0, "easing": "step" },
      { "type": "pose_apply", "object": "Lead", "pose": "crouch" },
      { "type": "key_add", "object": "Lead", "frame": 9, "easing": "step" },
      { "type": "pose_apply", "object": "Lead", "pose": { "joints": { "L_shoulder": [0, 0, 150], "R_shoulder": [0, 0, -150], "chest": [-10, 0, 0] } } },
      { "type": "key_add", "object": "Lead", "frame": 15, "easing": "step" }
    ]
  }
}
```

Then, once the timing is right, replace the blocking steps with real curves:

```json tool-call
{
  "tool": "batch",
  "arguments": {
    "commands": [
      { "type": "key_set_easing", "object": "Lead", "frame": 0, "easing": "easeInOut" },
      { "type": "key_set_easing", "object": "Lead", "frame": 9, "easing": { "type": "bezier", "c": [0.1, 0.8, 0.3, 1.15] } }
    ]
  }
}
```

## Pose-to-pose or straight ahead

- **Pose-to-pose** (the default in Doloyo): key the extremes, then breakdowns, then let the curves fill the rest. Best for acting, strikes, anything where a pose must read.
- **Straight ahead**: key every 2 to 3 frames in order, each from the previous. Use it for chaotic secondary motion (a doll tumbling down stairs, a flailing fall) or let a library clip be your straight-ahead pass (`anim_apply` writes a key per frame by default; `keyEvery: 2` or `3` gives a lighter, editable track).
- **Hybrid** (usually best for fights): library clip for the body mechanics, hand keys on the object `position` / `rotation` for travel and exaggeration, IK for contacts.

## Key, breakdown, in-between

- **Key**: the storytelling pose (wind-up, contact, follow-through end). Silhouette test: it should read from the camera angle you will use, with limbs off the torso.
- **Breakdown**: decides how you get there. Example, a punch: the breakdown between guard and full extension has the elbow leading and the shoulder already turned, so the fist travels on a slight arc instead of a straight lerp.
- **In-betweens**: leave them to the curve. Add a hand key only to fix a path (an elbow passing through the body, a foot dipping under the floor).

Rotations are slerped per joint, so a big swing (more than about 120 degrees on one joint in one segment) can take the short way round. Split it with a breakdown.

## Easing directions

| Motion | Easing | Doloyo value |
| --- | --- | --- |
| Starts from rest, ends moving (exit, launch, a thrown punch leaving guard) | ease-in | `easeIn` or bezier `[0.5, 0, 1, 1]` |
| Arrives and stops (landing, settling into a pose, camera stopping) | ease-out | `easeOut` or `[0, 0, 0.3, 1]` |
| Starts and stops on screen (a reach, a turn, a weight shift) | ease-in-out | `easeInOut` or `[0.45, 0, 0.55, 1]` |
| Snappy decisive strike (fast attack, slow settle) | strong ease-out | `[0.05, 0.7, 0.1, 1]` |
| Overshoot then settle | back-out | `[0.2, 0.9, 0.3, 1.25]` (y2 above 1 overshoots the next key) |
| Anticipation dip before a move | back-in | `[0.4, -0.3, 0.7, 0.4]` (y1 below 0 pulls back first) |
| Constant machines, spinning wheels, camera tracking a runner | linear | `linear` |
| Hard cut, freeze, pop | step | `step` (holds the key value until the next key) |

Never ease every segment the same way: uniform `easeInOut` everywhere is what makes keyframe animation look robotic. Mix fast-in/slow-out on actions with slow-in/fast-out on wind-ups.

## Timing table (30 fps)

| Action | Frames | Seconds |
| --- | --- | --- |
| Blink / flinch / hit snap | 2 to 4 | 0.07 to 0.13 |
| Jab, from guard to extension | 4 to 6 | 0.13 to 0.2 |
| Heavy strike, wind-up | 8 to 14 | 0.27 to 0.47 |
| Heavy strike, release to contact | 3 to 5 | 0.1 to 0.17 |
| Impact hold (readable contact) | 3 to 6 | 0.1 to 0.2 |
| Recovery back to guard | 8 to 15 | 0.27 to 0.5 |
| Head turn | 6 to 10 | 0.2 to 0.33 |
| Weight shift, foot to foot | 10 to 18 | 0.33 to 0.6 |
| Sit down / stand up | 25 to 45 | 0.8 to 1.5 |
| Fall to the floor | 15 to 30 | 0.5 to 1 |
| Walk step / run step | 15 / 8 to 10 | 0.5 / 0.27 to 0.33 |
| Moving hold (alive, not frozen) | 12 to 24 | 0.4 to 0.8 |

Rules of thumb: heavier body or bigger doll, longer wind-up and longer settle (a `remaja` teen can be 10 to 15 percent faster than a large adult). Distance scales time: a reach twice as far is about 1.3 times as long, not twice. Entrances can be slower than exits.

## The 12 principles on a 17-joint doll

1. **Squash and stretch**: the doll is rigid, so fake it with the spine chain. Compress: `hipsPos` down 5 to 12 cm, `spine` and `chest` flex forward, knees bend. Stretch: hips up, spine and chest extended, arms reaching. Two to four frames on landings and impacts.
2. **Anticipation**: move opposite first. Before a right cross: chest and hips rotate away (Y), weight sinks (`hipsPos` y -0.04 to -0.08), right elbow draws back. Size: 10 to 30 percent of the action, 4 to 12 frames. Skip it only for the fastest jabs and for surprise hits (the victim never anticipates).
3. **Staging**: one main action per moment. While the lead strikes, others hold or move small. Turn the doll (object `rotation` Y) so the action is in profile or three-quarter to the camera; a punch straight at the lens loses its length unless it is a deliberate POV shot.
4. **Straight ahead / pose to pose**: see above.
5. **Follow-through and overlap**: parts stop at different times. Order of arrival: hips, then chest, then head and arms 2 to 4 frames later. In practice key `head` and the wrists a few frames after the body key, or shift those channel keys with `keys_edit`.
6. **Slow in / slow out**: the easing table. Linear spatial motion only for constant travel.
7. **Arcs**: wrists, ankles and head travel on arcs. Check the path with onion skin in the app, or by snapshots at three in-between frames. Fix a straight path with a breakdown pose or `ik_reach` to an off-line point at mid-time.
8. **Secondary action**: the free hand guards the face during a punch, the head whips after the hips on a hit reaction. Keep it 30 to 50 percent of the main action and start it 2 to 3 frames later.
9. **Timing**: number of frames defines weight and mood (table above).
10. **Exaggeration**: library clips are realistic and read small on a doll in a wide shot. Push key poses 20 to 40 percent further than real (`joint_set` larger angles; joint limits clamp the absurd ones), and add travel on the object `position`.
11. **Solid drawing**: avoid twins (both arms or legs doing the same thing at once). Offset left and right by a few frames and degrees; put weight clearly on one leg.
12. **Appeal**: clear silhouettes, line of action through spine and head, a held pose before and after each big move.

## Weight and contacts

- The weight is over the supporting foot. During a shift, the hips travel first (`hipsPos` x of about plus or minus 0.05 to 0.1), then the free foot lifts.
- **Foot pins**: `ik_pin` a foot while the hips move so it does not slide; `ik_bake` (or `key_add` with `bakePins: true`) turns the result into plain keys before you hand off, export or apply other clips.
- **Reaching**: `ik_reach` puts a wrist or ankle on a world point (a door handle, an opponent's chin), with `pole` to steer the elbow or knee. It writes joint rotations, so key them afterwards.
- Body sizes: `hipsPos` keys are stored in adult units and scaled by the body, so jumps and crouches keep the feet on the floor on any preset.

```json tool-call
{
  "tool": "batch",
  "arguments": {
    "commands": [
      { "type": "ik_pin", "object": "Lead", "limb": "L_foot", "pinned": true },
      { "type": "ik_pin", "object": "Lead", "limb": "R_foot", "pinned": true },
      { "type": "joint_set", "object": "Lead", "joint": "hips", "position": [0.06, -0.12, 0] },
      { "type": "key_add", "object": "Lead", "frame": 12, "bakePins": true, "easing": "easeInOut" }
    ]
  }
}
```

## Mixing hand keys with library clips

- `anim_apply` replaces the keys of the joints it writes inside its time range, and a later clip that overlaps an earlier clip run drops the rest of that earlier run. Hand keys outside the range are kept. So: **bake clips first, hand-key on top afterwards**, and re-run your hand keys if you re-bake.
- The object channels (`position`, `rotation`, `scale`) are never touched by clips: they are a free additive layer. Use them for travel (`inPlace: true` on the clip plus position keys), recoil (a 10 to 20 degree object tilt on a hit), knockback slides and spins.
- Use `duration` to trim a looped clip to the beat (`loops: 10, duration: 2.4`), `speed` to retime a clip (1.2 to 1.5 makes library strikes snappier), `mirror` to swap the striking side.
- After the last clip a doll holds that clip's final frame, and a later clip drops the rest of an earlier run it overlaps, so a long idle laid first does not come back: fill gaps with short trimmed idles in time order.

## Blending clips (no pops)

Fluid, natural motion is the goal: a doll must never snap from one pose to the next. Clip boundaries pop when the end pose of one run and the start pose of the next differ. Blend every boundary:

1. Apply the next clip at its start time `t` as usual.
2. Remove its first few keys so Doloyo interpolates from the previous run's last key straight into the clip: 2 frames for hit reactions (they must stay snappy), 3 to 4 for strikes and moves, 6 for idles and holds. Use a `target` list of the joint channels plus `"hipsPos"` so object travel keys are never touched.
3. Give the previous run's last key `easeInOut` (`key_set_easing` on the frame before `t`) so the bridge starts and ends softly.

```json tool-call
{
  "tool": "batch",
  "arguments": {
    "commands": [
      { "type": "key_remove", "object": "Lead", "frame": 105, "target": ["hips", "spine", "chest", "neck", "head", "L_shoulder", "L_elbow", "L_wrist", "R_shoulder", "R_elbow", "R_wrist", "L_hip", "L_knee", "L_ankle", "R_hip", "R_knee", "R_ankle", "hipsPos"] },
      { "type": "key_remove", "object": "Lead", "frame": 106, "target": ["hips", "spine", "chest", "neck", "head", "L_shoulder", "L_elbow", "L_wrist", "R_shoulder", "R_elbow", "R_wrist", "L_hip", "L_knee", "L_ankle", "R_hip", "R_knee", "R_ankle", "hipsPos"] },
      { "type": "key_remove", "object": "Lead", "frame": 107, "target": ["hips", "spine", "chest", "neck", "head", "L_shoulder", "L_elbow", "L_wrist", "R_shoulder", "R_elbow", "R_wrist", "L_hip", "L_knee", "L_ankle", "R_hip", "R_knee", "R_ankle", "hipsPos"] },
      { "type": "key_set_easing", "object": "Lead", "frame": 104, "easing": "easeInOut" }
    ]
  }
}
```

(`key_remove` fails when no channel has a key on that frame, which matters inside a `batch`: with `keyEvery: 2` only remove every second frame.) Other ways to smooth a boundary: start the next clip 2 to 4 frames before the previous one ends, or key a hand-made transition pose between them with ease-in-out.

Then check: render 4 to 6 consecutive frames about 0.1 s apart around at least four clip boundaries and look for snaps of the hips, head or hands.

Fluidity checklist beyond the boundaries:
- Follow-through and settle after every strike (the clip's recovery, or an overshoot key), never a dead stop on the extension.
- Weight shifts and breathing in holds (idle loops, or a 1 to 3 degree chest/head drift).
- Root motion on arcs and eased: every object `position` / `rotation` key that starts or stops a move is eased (ease-out into a stop, ease-in out of one); linear only during constant travel such as a run.
- Feet: `ik_pin` planted feet while the hips or object move in a hand-keyed passage, then `ik_bake`; check the hips never float above or dip through the floor at the joins.

## Holds that stay alive

A fully frozen doll looks dead after about 0.5 s. A moving hold: keep the pose but drift `chest` 1 to 3 degrees, `head` 2 to 5 degrees and `hipsPos` y 1 to 2 cm over 12 to 24 frames, eased in-out. Or bake `ual1/Idle_Loop` (or `ual2/Idle_FoldArms_Loop`, `ual1/Crouch_Idle_Loop`) under the hold.

## Checklist before handing over

- Every key pose reads as a silhouette from the render camera angle.
- No segment that moves through space is linear, unless it is constant travel or a camera track.
- Contacts do not slide (pins baked) and nothing sinks under or floats above the floor (check the lowest frames of falls and crouches).
- Overlap exists: head and hands land after the hips.
- Holds breathe; no doll is frozen for more than about 0.6 s unless it is a deliberate freeze.
- See `references/curves-and-spacing.md` for spacing charts, bezier presets and fixing common problems.
