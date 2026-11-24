---
name: doloyo-camera
description: Camera language for Doloyo's animated render camera (camera_set + key_add on the camera, easing, fov). Use when you frame or animate the camera for a Doloyo render, plan shots for a short or a fight, need portrait 9:16 (TikTok, Reels, Shorts) framing, or a render looks flat, static, side-on, empty or confusing. Covers shot sizes, angles, named moves (push-in, pull-back, track, crane, whip pan, punch-in, handheld drift, low hero angle, over-shoulder), hard cuts with adjacent keys, combo recipes and variety rules.
---

# Doloyo camera

Doloyo renders through one **render camera** (kind `camera`, default name `Render Camera`). It has three keyable channels: `position` (the eye), `target` (the look-at point) and `fov` (vertical field of view, degrees). There is no roll and no lens blur. `render_export` uses this camera for png, png_seq, webm and mp4 with the aspect of the export size; `viewport_snapshot` shows the editor view, not the camera, so check camera framing with a small `render_export` (`format: "png"`, seek first, e.g. 360x640) or a low-res mp4 preview.

Animate it like any object: set values, key them.

```json tool-call
{
  "tool": "batch",
  "arguments": {
    "commands": [
      { "type": "camera_set", "position": [2.2, 0.6, 2.4], "target": [0, 1.2, 0], "fov": 40 },
      { "type": "key_add", "object": "Render Camera", "frame": 0, "easing": { "type": "bezier", "c": [0.2, 0, 0, 1] } },
      { "type": "camera_set", "position": [1.3, 0.8, 1.5], "target": [0, 1.3, 0], "fov": 36 },
      { "type": "key_add", "object": "Render Camera", "frame": 36 }
    ]
  }
}
```

Interpolation facts that matter:

- `position` and `target` interpolate in **straight lines** between keys (per channel, with the easing of the key that starts the segment). An arc or orbit needs a key every 15 to 20 degrees, otherwise the camera cuts across the chord and gets closer to the subject mid-move.
- **Two keys on adjacent frames = a hard cut.** At 30 fps there is no frame between frame 120 and 121, so the shot simply changes. Doloyo has no edit timeline, but it does have cuts. A `step` easing on a key holds that shot until the next key, which is also a cut.
- `fov` is a zoom (flattens, no parallax); moving `position` is a dolly (parallax, depth). Use dolly for emotion and space, fov for snap punch-ins and compression.

## Shot sizes (what the frame height covers)

| Size | Covers | Use for |
| --- | --- | --- |
| Extreme wide (EWS) | the whole street, dolls tiny | geography, scale, an aerial drop |
| Wide (WS) | full bodies plus a lot of space | big moves, knockdowns, throws, chases, the finisher's aftermath |
| Full (FS) | head to feet with a little room | footwork, kicks, rolls, a doll falling |
| Medium-full (MFS) | knees up | exchanges with legs involved, a stance |
| Medium (MS) | waist up | punches, blocks, grabs |
| Medium close (MCU) | chest up | fast hand exchanges, a reaction |
| Close (CU) | head and shoulders, one fist | impact punctuation, a decision |
| Extreme close (ECU) | a fist, a foot, a face | 0.2 to 0.5 s accents only |

Match size to the action amplitude: small moves (jabs, blocks) close, big moves (aerials, spins, knockdowns, sweeps) wide. A tiny action in a wide shot reads as nothing; a big action in a close shot reads as noise. Distances for every size and fov are in `references/camera-math.md`.

## Angles

- **Oblique 30 to 60 degrees off the fight line** for anything medium or wider. A flat 90-degree side-on view of two full bodies looks like a 2D fighting game and has no depth. Side-on is fine for MCU and closer.
- **Low angle (camera 0.3 to 0.8 m high, looking up 10 to 30 degrees)**: power, the hero before a big move, a giant thug. The classic "hero shot".
- **High angle (looking down 30 to 60 degrees)**: geography, a doll on the floor, the loser after the finisher, an aerial attack coming down.
- **Over-the-shoulder (OTS)**: camera behind one fighter's shoulder, the other faces the lens. Great in portrait: the two fighters are stacked in depth instead of side by side.
- **Frontal POV**: the strike comes straight at the lens. Only for 0.2 to 0.5 s.
- Keep the **180-degree rule** across cuts: stay on one side of the line between the two fighters, so A stays screen-left of B. Cross it only during a visible move (an arc around them), never on a cut.

## Named moves in Doloyo terms

| Move | Channels | Recipe |
| --- | --- | --- |
| Push-in (dolly in) | `position` toward `target` | 0.6 to 2 s, ease-out or smooth standard; builds tension |
| Pull-back (dolly out) | `position` away | reveal, aftermath, finisher; ease-out so it lands soft |
| Punch-in (snap zoom) | `fov` down 25 to 40 percent | 3 to 5 frames, `[0.05, 0.7, 0.1, 1]`; on the impact frame |
| Track / truck | `position` and `target` move together | parallel to the subject's travel; linear while the subject runs |
| Follow (chase) | both, sampled from the subject path | key every 0.3 to 0.5 s, linear, lead the subject by 0.3 to 0.8 m |
| Crane up / down | `position` y (target y less) | crane up with a jump, down to a low hero angle |
| Tilt | `target` y only | follow a doll falling or launching |
| Pan | `target` x/z only | reveal the next opponent |
| Whip pan | `target` swings 40 to 120 degrees | 3 to 6 frames, bezier `[0.7, 0, 0.3, 1]`; a "cut" with energy |
| Arc / orbit | `position` on a circle, key every 15 to 20 degrees | at most 90 degrees during contact, 180 degrees in a standoff, never a decorative 360 |
| Handheld micro-drift | small offsets on `position` and `target` | 2 to 5 cm every 0.4 to 0.7 s, easeInOut, irregular |
| Impact shake | alternate `position` offsets | 3 to 6 frames of plus/minus 3 to 6 cm, decaying, right on the hit |
| Freeze-ish hold | no movement or a 1 to 2 percent creep | 0.3 to 0.6 s breath before a finisher, or the final frame |

Ready-made key lists for each move are in `references/move-recipes.md`.

## Combo recipes

- **Charge / rush in**: push-in on the attacker, track with the run, whip pan or hard cut onto the impact.
- **Big hit / finisher**: low push on the wind-up, punch-in on contact, then pull-back with a slow track, ending in an almost-still hold (the "freeze").
- **Aerial**: crane up with the jump, high angle at the apex, tilt down and pull back for the landing.
- **Reversal**: OTS from the side that is losing, quick push, cut to OTS reversed when the tables turn.
- **Group fight**: wide oblique to establish who is where, then medium shots that pan or whip from opponent to opponent; return to wide after every knockdown so the audience recounts heads.

## Variety and rhythm rules

- **Same move for at most about 2 s**, **same shot size for at most about 3 s**. Then change something: size, angle, direction or speed.
- The first 1.5 s must show action in a medium or closer shot. Do not open on a slow empty establishing wide; establish during the action.
- Every move needs a motive: follow a doll, reveal something, add tension, land an impact. A move without a reason is noise.
- Alternate speed: fast moves (whips, punch-ins, cuts) against slow ones (push-in, drift, holds). Continuous same-speed motion flattens everything.
- Before a finisher, hold the camera still (or creep) for 0.3 to 0.5 s after at least 1.5 s of fast cutting. The contrast is the effect.
- Do not end on a slow fade-away. End on the strongest image: the pull-back and hold on the winner.
- Hard cuts: match motion direction across the cut (a doll moving right exits right and the next shot keeps moving right), keep the 180-degree line, and change size or angle by a clear amount (at least about 30 degrees or one shot size), or it looks like a glitch.

## Portrait 9:16 framing

The frame is tall and narrow. With fov 40, the horizontal view is only about 23 degrees.

- **Stack the action in depth, not side by side.** Two fighters 1.5 m apart side-on need about 5 to 6 m of distance to both fit, which makes them small. Shoot along the fight line (OTS, 20 to 50 degrees off it) so one is near and one is far.
- Full bodies fill the height: a standing doll in a full shot takes 70 to 85 percent of the frame height.
- **Headroom**: in MS and closer, the top of the head sits 5 to 10 percent below the frame top; eyes on the upper third line. In wides, leave sky or buildings above, the floor below.
- **Leading space** goes vertical or into depth: a running doll should run diagonally toward or away from the lens rather than across the frame, which it would cross in under a second.
- Keep the action out of the bottom 12 percent and the top 8 percent (platform UI covers them).
- Low angles work very well in portrait: they turn the tall frame into "towering".
- Check every shot at its start, middle and end with a small render: nobody cut off at the joints (frame at mid-thigh or mid-chest, not at knees or ankles), nobody out of frame, no empty frames.

## Workflow

1. Plan a shot list (time range, size, angle, move, motive) next to the action beats. See the `doloyo-director` skill.
2. Compute positions with the helper in `references/camera-math.md` (orbit around the fight midpoint by angle, elevation and distance).
3. Key the camera in one or a few `batch` calls; use adjacent-frame keys for cuts.
4. Render stills at each shot's start, middle and end (`playhead_seek`, then `render_export` png at 360x640), or a 15 fps low-res mp4, and look at them.
5. Fix framing, then do the final render.
