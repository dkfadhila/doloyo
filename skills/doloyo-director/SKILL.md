---
name: doloyo-director
description: End-to-end workflow for directing a short animated piece in Doloyo over the doloyo MCP tools, from idea to final MP4. Use when the user asks for a complete short, a clip for TikTok/Reels/Shorts, a fight scene video, a music or dance video, an ad-like doll scene, or "make a video" with Doloyo, and whenever several skills (fight, camera, keyframe motion) must work together. Covers the beat sheet, blocking, camera pass, polish, preview renders, a scored critique loop and the final render, with a worked 30 s 9:16 example.
---

# Doloyo director

You are the director: story first, then performance, then camera, then polish. Each pass ends with pictures you actually look at. The other skills hold the craft details: `doloyo-fight-choreography` (action beats and clip timings), `doloyo-camera` (shots, moves, 9:16 framing), `doloyo-keyframe-motion` (easing, spacing, holds, blending clips).

## 0. Setup

1. `bridge_status` (pairing), `guide_read` once, `scene_get`.
2. Ask (or decide) the format: duration, aspect (9:16 portrait is 1080x1920), fps (30 for action, 24 for a filmic feel).
3. `timeline_set { fps, duration }`. Build the set: shapes (`object_add` cube/cylinder + `object_transform`), reference images as textured planes or a camera background (`image_add` with a local file), floor.
4. Cast: `object_add` mannequins with `character` and `body`. Make the lead readable: different character or size from everyone else (dolls are grey only).

Script it. For anything beyond a few beats, write a small script (Node with the MCP SDK client, or any language your MCP client can drive) that holds the beat sheet as data and sends the calls; re-running the whole build from scratch is the fastest way to iterate.

## 1. Beat sheet

A table of time ranges with: what happens (who does what to whom), the emotional point, and the intended shot. Rules:

- Hook in the first 1.5 s (action, medium or closer).
- Every 3 to 5 s something changes: a new opponent, a level change, a location, a reversal.
- A turning point around 40 to 60 percent of the runtime; the climax in the last fifth; end on the strongest image.
- Contrast: fast against slow, close against wide, loud action against a held breath.

## 2. Blocking (performance)

- Positions and facing first: a plan of where each doll stands at each beat (x, z, facing yaw). Keep fighting distances honest (see the fight skill's spacing table).
- Per doll, in time order: library clips with `anim_apply` (`start`, `duration`, `speed`, `inPlace: true`), short trimmed idles in every gap, hand-keyed poses where no clip fits.
- Object travel and recoil as eased `position` / `rotation` keys (`target: ["position","rotation"]`).
- Blend clip boundaries (see `doloyo-keyframe-motion`, "Blending clips"): no hard pops.

## 3. Camera pass

- A shot list next to the beat sheet: time range, size, angle, move, motive. Average shot length 1 to 2 s for action, 2 to 4 s for drama.
- Compute camera positions from the dolls' positions at that time (an orbit helper around the action midpoint, or an over-the-shoulder offset from the near doll), so camera and action stay locked when you retime.
- Cuts are adjacent-frame keys; whips are 3 to 6 frame target swings; impacts get a punch-in (fov) and a short shake on the contact frame.

## 4. Preview and critique loop

1. Render a cheap preview: `render_export { format: "mp4", width: 360, height: 640, fps: 15 }` (a full 30 s takes well under a minute on a GPU). Exports never overwrite: give each preview a new `filename` or delete the old one, or you will review a stale file.
2. Extract frames: every 1 s for the overview, plus 4 to 6 consecutive frames (about 0.1 s apart) around at least four clip transitions to catch pops (ffmpeg: `-ss <t> -frames:v 1`, then tile).
3. Look at them and score each sampled frame 0 to 2 on:
   - **Readability**: who is who and what is happening; the lead identifiable; the action not hidden behind a body.
   - **Framing**: nobody cut at the joints or out of frame, no empty frames, headroom, nothing important in the bottom 12 percent of a 9:16 frame.
   - **Camera variety**: size or angle changed within the last 3 s; a motivated move.
   - **Impact**: contacts land with a reaction, a hold and a camera accent.
   - **Fluidity**: no pops at clip boundaries, no floating or sinking, no feet skating badly, nobody frozen for more than about 0.6 s.
4. Fix the lowest scores first (usually: an over-the-shoulder where the near doll covers everything, a shot too close for 9:16, a pop at a clip boundary), re-render, re-check the same timestamps.
5. Stop when every sampled frame scores at least 1 on everything and the average is clearly above the previous version.

## 5. Final

- `render_export { format: "project" }` (keep the editable file) and `render_export { format: "mp4", width: 1080, height: 1920, fps: 30 }`.
- Verify the file: duration, size, fps (`ffprobe`), and look at a last set of frames from the final file itself.

## Common failures

| Symptom | Fix |
| --- | --- |
| The near doll fills the frame in an over-the-shoulder | camera higher than the near doll's shoulder (2.0 m or more for big dolls), 1.2 to 1.5 m to the side, target weighted toward the far doll |
| A full shot of two side-by-side dolls in 9:16 cuts both off | shoot along the fight line (20 to 50 degrees) or go wider |
| The kick or lunge visually passes through the target | increase the distance at contact; the clip's reach is longer than you think |
| The background is the grey edge of the floor | make the floor much larger or cover it with a dark plane; avoid looking toward empty set edges |
| Low angles show nothing but sky | fine for a hero shot, but keep at least the head and shoulders and some set in frame |
| The doll freezes after a strike | the supersede rule dropped the old idle; fill the gap with a trimmed idle |
| A reaction happens before the hit | place reaction clips at the striker's start + contact offset / speed |

The worked 30 s example (beat sheet, shot list, clip list and the techniques used) is in `references/worked-30s-fight.md`.
