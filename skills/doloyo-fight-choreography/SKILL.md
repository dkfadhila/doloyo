---
name: doloyo-fight-choreography
description: Action and fight choreography for Doloyo dolls with the doloyo MCP tools (anim_list, anim_apply with start/duration/speed/inPlace, object position and rotation keys, joint keys, ik_pin). Use when the user wants a fight, brawl, duel, martial-arts beat, chase with a takedown, hit reactions, knockdowns, a combo or a finisher, or when an existing fight looks slow, stiff, unreadable or like two dolls standing and swinging. Includes the measured contact timings of the built-in Quaternius clips.
---

# Doloyo fight choreography

Doloyo dolls are grey, faceless and small on screen, so a fight reads only through **silhouette, timing and spacing**. The built-in clips (Quaternius UAL1/UAL2, CC0) give realistic but modest strikes and reactions; your job is to sequence them into beats, sharpen the timing, add travel and recoil on the object channels, and let the camera (see `doloyo-camera`) sell each hit.

## Ground rules

1. **Open hot.** Contact (a strike, a block, a shove) within the first 1.5 s, framed medium or closer. No slow walk-up, no empty establishing shot. Establish geography during the action.
2. **Every hit is four beats**: anticipation, strike, impact hold, reaction or recoil. Skip anticipation only for surprise hits and fast jabs.
3. **Reactions sell the hit, not the strike.** A punch with no visible reaction did not land. Match the reaction to the target: head hit = head and chest snap back plus a step back; body hit = fold forward (hunch), feet stay; leg hit = knee drops; a heavy hit = knockback off the feet.
4. **Rhythm breathes.** Fast exchanges (3 to 5 actions per second) alternate with short breaths (0.3 to 0.8 s standoff, circling, a taunt). The same tempo for more than about 5 s goes numb.
5. **Escalate.** Each exchange is bigger than the last: first trades, then a knockdown, then a reversal (the lead gets hit hard), then the finisher.
6. **Space so hits read.** Strikers stand 0.6 to 0.9 m apart (chest to chest) for punches, 1.0 to 1.3 m for kicks and lunges. Closer and arms pass through bodies; farther and nothing connects. Contacts happen in profile or three-quarter to the camera, never hidden behind a body.
7. **Variety.** At least three different attack types (straight, hook, kick or knee, lunge, chop, sweep), and a change of level at least twice (low sweep or roll, jump or aerial). Do not repeat the same move against the same opponent.
8. **No turret fighting.** A doll that stands still and swings is dead weight. Every strike shifts the body: a step in, a turn, travel on `position`.
9. **Finisher in three acts**: break (open the guard or launch), bloom (the big hit, punch-in, slow it with a hold), aftermath (the loser lands, the camera pulls back, a held final image). Put a 0.3 to 0.5 s breath (near freeze) right before it, after at least 1.5 s of fast action.
10. **End on the strongest image** (the winner over the fallen, the last thug hitting the floor), not on a polite fade.

## Doloyo mechanics for fights

- **Bake clips with explicit timing**: `anim_apply { clip, objects: [id], start, duration?, speed?, inPlace: true }`. `start` places the clip; `duration` trims it (cut the long idle tails off strikes); `speed` 1.2 to 1.6 sharpens library strikes; `mirror: true` swaps the striking side.
- **Later clips supersede earlier ones**: a clip that overlaps an earlier run replaces it from its start **and drops the rest of that earlier run**; after the last clip the doll holds its final pose. Consequence: a long idle laid first does not come back after a strike. Work per doll **in time order** and fill every gap with a trimmed guard idle (`ual1/Idle_Loop`, `start` = end of the action, `duration` = the gap), or the doll freezes in the strike's last frame. Apply a clip at an earlier time after a later one and it wipes the later one: if you must redo a beat, re-apply everything after it too. Hand-made joint keys are kept, but are replaced inside a new clip's range: hand-key accents last.
- **Root motion via the object**: use `inPlace: true` and drive travel with `object_transform` + `key_add` on `position` and `rotation` (`target: ["position","rotation"]`). That keeps doll-to-doll spacing under your control. Object channels are never touched by clips.
- **Recoil and knockback** on the object: a hit adds 0.15 to 0.4 m of `position` away from the striker over 4 to 8 frames (ease-out), and optionally a 8 to 20 degree object tilt (`rotation` X or Z) that springs back. A knockdown slides the body 0.5 to 1.5 m while `ual2/Hit_Knockback` plays.
- **Foot pins** for planted stances during hand-keyed punches: `ik_pin` the front foot, move the hips, then `ik_bake`. After baking, more clips can go on top.
- **Kicks are hand-keyed** (the library has no kick clip). Pose-to-pose with the values in `references/hand-keyed-strikes.md`.
- **Fluid, never robotic**: blend every clip boundary (remove the first 2 frames of a reaction, 3 to 4 of a strike or move, 6 of an idle, and ease the previous key; see "Blending clips" in `doloyo-keyframe-motion`), let strikes finish their recovery or settle, keep idles breathing between exchanges, ease every start and stop of object travel and recoil, and scrub frames around transitions before the final render.
- **Readability of the cast**: dolls are grey. Make the lead different by character and size, e.g. lead `mannequin-f` (smooth, slim) against thugs `doll-procedural` (wooden art-doll segments) or `mannequin-m` with `body: { preset: "dewasa", heightScale: 1.1 }`. Keep the lead nearest the camera or central in most shots, and give the lead the cleanest silhouettes.

## Beat anatomy (frames at 30 fps)

| Beat | Frames | Doloyo |
| --- | --- | --- |
| Anticipation | 4 to 12 | chest and hips turn away, weight sinks, fist draws back (part of most clips; add it by hand or start the clip 2 to 4 frames earlier) |
| Strike | 3 to 6 | the clip's extension window (table below), speed 1.2 to 1.5 |
| Impact hold | 2 to 5 | victim reaction starts on the contact frame; camera punch-in and shake on the same frame |
| Reaction | 6 to 25 | `Hit_Head`, `Hit_Chest`, `Idle_Shield_Break`, `Hit_Knockback`, `Death01`, plus object recoil |
| Recover / reset | 8 to 20 | back to guard, or a new beat starts before the old one ends (overlap = flow) |

Place the victim's reaction clip so that its first frame lands **on the striker's contact frame** (clip start + contact offset from the table). One frame late is fine; early looks like the victim flinches before being touched.

## Built-in clips for fights (measured)

Contact times are seconds from the clip start (`anim_apply` start), measured on the clips at speed 1. Divide by `speed` if you speed a clip up.

| Clip | Length | Use | Contact / key moment |
| --- | --- | --- | --- |
| `ual1/Punch_Jab` | 0.87 | left jab | full extension 0.20 to 0.37; trim with `duration: 0.55` |
| `ual1/Punch_Cross` | 1.00 | right cross, the bread-and-butter power punch | extension 0.27 to 0.53; `duration: 0.7` |
| `ual2/Melee_Hook` | 0.47 | lunging right hook, drops low and travels 0.3 m | contact 0.27 to 0.3; follow with `ual2/Melee_Hook_Rec` (0.6) |
| `ual2/Sword_Regular_A` / `_B` | 0.43 / 0.53 | open-hand chop or backfist (no sword prop) | 0.23 |
| `ual2/Sword_Regular_Combo` | 3.0 | chop combo, four to five hits | R 0.23, R 0.70, R 1.20, L 1.43, R 1.57 |
| `ual2/Sword_Heavy_Combo` | 4.33 | heavy swinging combo | R 0.47, R 1.77, R 2.60 |
| `ual1/Sword_Attack` | 1.53 | big diagonal swing, hammer fist | 0.43 |
| `ual2/OverhandThrow` | 1.33 | overhead hammer blow | 0.37 |
| `ual2/Sword_Dash` | 1.57 | lunging thrust, palm strike from range | 0.30 |
| `ual2/Shield_Dash` | 1.10 | low shoulder charge | 0.30 to 0.57 |
| `ual2/Zombie_Scratch` | 1.80 | clumsy thug swipe (good for a big slow attacker) | 0.60 |
| `ual2/Sword_Block` | 1.23 | arm-up block or parry | 0.13 to 0.2 |
| `ual2/Idle_Shield_Break` | 1.07 | guard broken, staggers back | snap at 0.13 |
| `ual1/Hit_Chest` | 0.33 | small body flinch | peak 0.1 |
| `ual1/Hit_Head` | 0.43 | small head snap (subtle; add object recoil) | peak 0.1 to 0.27 |
| `ual2/Hit_Knockback` | 0.83 | knocked off the feet onto the back | airborne 0.17 to 0.3, floor 0.37, lying from 0.6 |
| `ual1/Death01` | 2.40 | staggers, then falls backward, stays down | falls 0.7 to 1.0, lying from 1.1 |
| `ual2/LayToIdle` | 1.53 | gets up from lying on the back | standing by 1.4 (use after a knockdown) |
| `ual1/Roll` | 1.47 | forward roll, in place (add 1.5 to 2 m travel) | on the floor 0.4 to 0.7, up by 1.2 |
| `ual2/Slide_Start` / `Slide_Loop` / `Slide_Exit` | 0.83 / 2 / 0.5 | slide under an attack, slide tackle | low from 0.3 |
| `ual2/NinjaJump_Start` / `NinjaJump_Idle_Loop` / `NinjaJump_Land` | 0.97 / 2 / 1.27 | athletic jump (add a height arc on `position`) | takeoff about 0.25, land squash 0.17 |
| `ual1/Jump_Start` / `Jump_Loop` / `Jump_Land` | 1.33 / 2.5 / 1.27 | plain jump | land squash 0.17 |
| `ual1/Crouch_Idle_Loop` | 2.93 | low guard, coiled | |
| `ual1/Idle_Loop`, `ual2/Idle_FoldArms_Loop`, `ual2/Idle_No_Loop` | loops | guard idle, taunt, "no" | |
| `ual1/Sprint_Loop`, `ual1/Jog_Fwd_Loop`, `ual1/Walk_Loop`, `ual2/Zombie_Walk_Fwd_Loop` | loops | travel (inPlace plus position keys) | sprint step about 0.33 |

Check the live list with `anim_list` (query `"hit"`, `"sword"`, `"punch"`, `"jump"`).

## A worked exchange

Lead at x = -0.75 facing +X, Thug at x = 0.75 facing -X. The thug throws a cross that the lead blocks, the lead answers with a hook to the head and a cross to the body. Calls go in time order; a short guard idle opens the beat and trimmed idles close it so nobody freezes. (Between 0.74 and 1.12 the thug holds the end of his cross, which is short enough to read as a held guard.)

```json tool-call
[
  { "tool": "anim_apply", "arguments": { "clip": "ual1/Idle_Loop", "objects": ["Lead", "Thug"], "start": 0, "duration": 0.2, "inPlace": true, "keyEvery": 2 } },
  { "tool": "anim_apply", "arguments": { "clip": "ual1/Punch_Cross", "objects": ["Thug"], "start": 0.2, "duration": 0.7, "speed": 1.3, "inPlace": true } },
  { "tool": "anim_apply", "arguments": { "clip": "ual2/Sword_Block", "objects": ["Lead"], "start": 0.3, "duration": 0.6, "inPlace": true } },
  { "tool": "anim_apply", "arguments": { "clip": "ual2/Melee_Hook", "objects": ["Lead"], "start": 0.9, "speed": 1.2, "inPlace": true } },
  { "tool": "anim_apply", "arguments": { "clip": "ual1/Hit_Head", "objects": ["Thug"], "start": 1.12, "inPlace": true } },
  { "tool": "anim_apply", "arguments": { "clip": "ual2/Melee_Hook_Rec", "objects": ["Lead"], "start": 1.29, "speed": 1.3, "inPlace": true } },
  { "tool": "anim_apply", "arguments": { "clip": "ual1/Punch_Cross", "objects": ["Lead"], "start": 1.6, "duration": 0.7, "speed": 1.3, "inPlace": true } },
  { "tool": "anim_apply", "arguments": { "clip": "ual1/Hit_Chest", "objects": ["Thug"], "start": 1.81, "inPlace": true } },
  { "tool": "anim_apply", "arguments": { "clip": "ual1/Idle_Loop", "objects": ["Lead"], "start": 2.14, "duration": 1, "inPlace": true, "keyEvery": 2 } },
  { "tool": "anim_apply", "arguments": { "clip": "ual1/Idle_Loop", "objects": ["Thug"], "start": 2.14, "duration": 1, "inPlace": true, "keyEvery": 2 } }
]
```

Then the object layer: the thug recoils 0.25 m on the hook and 0.35 m on the cross (ease-out), and the lead steps in to keep the distance.

```json tool-call
{
  "tool": "batch",
  "arguments": {
    "commands": [
      { "type": "object_transform", "object": "Thug", "position": [0.75, 0, 0], "rotation": [0, -90, 0] },
      { "type": "key_add", "object": "Thug", "time": 1.1, "target": ["position", "rotation"], "easing": { "type": "bezier", "c": [0.05, 0.7, 0.1, 1] } },
      { "type": "object_transform", "object": "Thug", "position": [1.0, 0, 0.05], "rotation": [0, -105, 0] },
      { "type": "key_add", "object": "Thug", "time": 1.3, "target": ["position", "rotation"], "easing": "easeInOut" },
      { "type": "object_transform", "object": "Thug", "position": [1.0, 0, 0.05], "rotation": [0, -95, 0] },
      { "type": "key_add", "object": "Thug", "time": 1.8, "target": ["position", "rotation"], "easing": { "type": "bezier", "c": [0.05, 0.7, 0.1, 1] } },
      { "type": "object_transform", "object": "Thug", "position": [1.35, 0, 0.05], "rotation": [0, -95, 0] },
      { "type": "key_add", "object": "Thug", "time": 2.05, "target": ["position", "rotation"] },
      { "type": "object_transform", "object": "Lead", "position": [-0.75, 0, 0], "rotation": [0, 90, 0] },
      { "type": "key_add", "object": "Lead", "time": 0.85, "target": ["position", "rotation"], "easing": "easeInOut" },
      { "type": "object_transform", "object": "Lead", "position": [-0.45, 0, 0], "rotation": [0, 90, 0] },
      { "type": "key_add", "object": "Lead", "time": 1.15, "target": ["position", "rotation"], "easing": "easeInOut" },
      { "type": "object_transform", "object": "Lead", "position": [-0.2, 0, 0], "rotation": [0, 90, 0] },
      { "type": "key_add", "object": "Lead", "time": 1.85, "target": ["position", "rotation"] }
    ]
  }
}
```

## Structures that work

- **15 s fight**: 0 to 1.5 contact; 1.5 to 5 close exchange (MCU/MS); 5 to 7 level change (roll, jump, sweep; wide); 7 to 9 turning point (the lead gets hit, close-up); 9 to 12 build (standoff, low push); 12 to 15 finisher in three acts.
- **30 s one-versus-three**: 0 to 2 cold open hit; 2 to 7 thug 1 (exchange, knockdown); 7 to 12 thug 2 (faster, level change, knockdown); 12 to 15 reversal (lead takes a hit or is knocked down, gets up); 15 to 21 chase or relocation (track); 21 to 26 the big thug, breath frame; 26 to 30 finisher and held final image. See the `doloyo-director` skill for the full worked example.

More combos, reaction mapping and hand-keyed kicks: `references/combos-and-reactions.md`, `references/hand-keyed-strikes.md`.
