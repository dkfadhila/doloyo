# Curves, spacing and fixes

## Spacing in frames

Spacing is how far a part moves per frame. Close spacing = slow, wide spacing = fast. With a 10-frame segment from 0 to 100 percent (computed with the same cubic bezier Doloyo uses):

| Easing | Per-frame positions (percent, roughly) | Feel |
| --- | --- | --- |
| `linear` | 10 20 30 40 50 60 70 80 90 100 | mechanical |
| `easeIn` | 2 6 13 21 32 43 55 69 84 100 | heavy start, fast end |
| `easeOut` | 16 31 45 57 68 79 87 94 98 100 | fast start, soft landing |
| `easeInOut` | 2 8 19 33 50 67 81 92 98 100 | smooth journey |
| `[0.05, 0.7, 0.1, 1]` | 62 78 87 92 95 97 99 99 100 100 | strike: most of the motion in the first 2 frames |
| `[0.2, 0.9, 0.3, 1.25]` | 42 73 92 101 106 108 107 106 103 100 | overshoot and settle |

## Bezier presets for Doloyo

Pass as `{ "type": "bezier", "c": [x1, y1, x2, y2] }` on `key_add`, `key_set_easing` or inside `batch`. x1 and x2 must be in 0..1; y can leave 0..1 to overshoot.

| Name | c | Use |
| --- | --- | --- |
| Smooth standard | `[0.2, 0, 0, 1]` | default on-screen move, camera reframes |
| Emphasized arrival | `[0.05, 0.7, 0.1, 1]` | strikes, punch-ins, snaps into a pose |
| Accelerate away | `[0.3, 0, 1, 1]` | exits, falling, wind-up release |
| Gentle float | `[0.4, 0, 0.2, 1]` | ambient drift, slow camera |
| Back out (overshoot) | `[0.2, 0.9, 0.3, 1.25]` | landing settle, camera stopping on a hit |
| Back in (anticipation) | `[0.4, -0.3, 0.7, 0.4]` | built-in wind-up before a move |
| Elastic snap | `[0.68, -0.55, 0.27, 1.55]` | cartoon only; use sparingly |
| Whip | `[0.7, 0, 0.3, 1]` | whip pans, fast turns: slow-fast-slow with a very fast middle |

The app has a curve editor (Graph view of the timeline) where the same curves can be dragged by hand; agents set them numerically.

## Overshoot and settle on joints

For a hit reaction or a landing, use three keys instead of a single eased one:

1. Contact pose (key A).
2. Overshoot 3 to 5 frames later: 15 to 30 percent past the final angle (key B, eased out).
3. Settle 6 to 10 frames after B at the final angle (key C, eased in-out).

Or a single back-out bezier on key A straight to the final pose, which is cheaper and usually enough for small joints.

## Problems and fixes

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| Floaty, weightless | even spacing, same easing everywhere, no holds | stronger ease-out on arrivals, shorter actions, 3 to 6 frame holds on contacts |
| Robotic | every joint keyed on the same frames | offset head and wrists by 2 to 4 frames (`keys_edit` with `to`) |
| Feet slide | hips or object moved with the feet free | `ik_pin` the planted foot, then `ik_bake` |
| Doll sinks into the floor | `hipsPos` y too low for the pose, or a clip blending into a crouch | raise `hipsPos` y; check the lowest frames with snapshots |
| Pop between two clips | the end pose of clip A is far from the start of clip B | overlap 2 to 4 frames, or add a breakdown key between |
| Limb flips the long way round | more than about 120 degrees on one joint in one segment | add a breakdown key at mid-time |
| Hand goes through the body | lerp path crosses the torso | breakdown with the elbow out, or `ik_reach` to a point beside the body at mid-time |
| Action unreadable in the shot | pose does not read from the camera angle | rotate the doll (object `rotation` Y) to three-quarter, exaggerate the pose, hold it longer |
| Everything feels the same speed | no contrast | alternate fast actions with holds; vary segment lengths (rule: no two consecutive beats the same length) |

## Moving holds recipe

```json tool-call
{
  "tool": "batch",
  "arguments": {
    "commands": [
      { "type": "joint_set", "object": "Lead", "joint": "chest", "rotation": [4, 2, 0] },
      { "type": "joint_set", "object": "Lead", "joint": "head", "rotation": [-3, 6, 0] },
      { "type": "key_add", "object": "Lead", "frame": 60, "target": ["chest", "head"], "easing": "easeInOut" },
      { "type": "joint_set", "object": "Lead", "joint": "chest", "rotation": [6, -1, 0] },
      { "type": "joint_set", "object": "Lead", "joint": "head", "rotation": [-1, 2, 0] },
      { "type": "key_add", "object": "Lead", "frame": 78, "target": ["chest", "head"], "easing": "easeInOut" }
    ]
  }
}
```
