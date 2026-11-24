# Hand-keyed strikes

The clip library has punches, chops, lunges and reactions but no kicks or knees. Key them pose-to-pose. Values are joint rotations in degrees for a doll facing +Z (use the object `rotation` to face it at the opponent). Reminders: thigh forward = negative X on `L_hip` / `R_hip`; knee bend = positive X; elbow bend = negative X; arm forward = negative X on the shoulder; spine, chest and head positive X = bend forward, negative X = lean back.

Apply each pose with `pose_apply` and an inline pose (unlisted joints reset to rest), or with `partial: true` to change only some joints, then `key_add`. `target: "all"` also keys the object `position` / `rotation` / `scale`, which would pin the doll's travel keys to the current spot, so on a doll that travels pass the 17 joint names plus `"hipsPos"` as the `target` array instead. The hips do not drop by themselves: bending the support knee lifts that foot off the floor. Either lower `hipsPos` y a little (about -0.02 m per 15 degrees of knee bend) or `ik_pin` the support foot before posing and `ik_bake` afterwards.

## Fighting guard

```json
{ "joints": {
  "chest": [4, 0, 0], "head": [-2, 0, 0],
  "L_shoulder": [-60, 0, 20], "L_elbow": [-110, 0, 0],
  "R_shoulder": [-45, 0, -25], "R_elbow": [-120, 0, 0],
  "L_hip": [-14, 0, 4], "L_knee": [16, 0, 0], "R_hip": [8, 0, -4], "R_knee": [12, 0, 0] } }
```

## Front kick (right leg), 4 keys

| Key | Frame offset | Joints | Easing to next |
| --- | --- | --- | --- |
| Guard | 0 | the guard above | `easeIn` |
| Chamber | +5 | guard arms; `R_hip` [-95,0,0], `R_knee` [110,0,0], `L_knee` [18,0,0], `chest` [-4,0,0] | `[0.05, 0.7, 0.1, 1]` |
| Extension (contact) | +8 | `R_hip` [-95,0,0], `R_knee` [8,0,0], `R_ankle` [-20,0,0], `L_hip` [-10,0,0], `L_knee` [18,0,0], `chest` [6,0,0] (that is forward, toward the target), arms guard | hold 2 to 3 frames |
| Retract and land | +11 then +18 | chamber again at +11, guard at +18 | `easeOut` |

Contact distance: the foot reaches about 0.9 to 1.0 m in front of the hips for an adult doll, so stand the target's chest 1.0 to 1.1 m away. Add 0.1 to 0.2 m of object travel toward the target between chamber and extension for a stepping kick.

## Knee strike (right), 3 keys

| Key | Offset | Joints |
| --- | --- | --- |
| Clinch | 0 | `L_shoulder` [-80,0,10], `R_shoulder` [-80,0,-10], `L_elbow` [-60,0,0], `R_elbow` [-60,0,0], `chest` [8,0,0] |
| Knee up (contact) | +5 | as clinch plus `R_hip` [-110,0,0], `R_knee` [125,0,0], `chest` [14,0,0], arms pulled down (`L_shoulder` [-55,0,10], `R_shoulder` [-55,0,-10]) |
| Back down | +12 | clinch |

The target folds: `ual1/Hit_Chest` on the contact frame plus an object tilt forward (rotation X +12 toward the striker) for 6 frames.

## Uppercut (right), 3 keys

| Key | Offset | Joints |
| --- | --- | --- |
| Load | 0 | `hipsPos` [0,-0.08,0], `chest` [10,-25,0], `R_shoulder` [-20,0,-20], `R_elbow` [-95,0,0], knees 25 |
| Rise (contact) | +4 | `hipsPos` [0,0,0], `chest` [-8,20,0], `R_shoulder` [-125,0,-10], `R_elbow` [-75,0,0], `head` [-6,0,0] |
| Recover | +12 | guard |

Victim: `ual1/Hit_Head` on the contact frame, plus `position` y up 0.05 to 0.1 for 4 frames (a small lift) and a step back. For a launcher, follow with `ual2/Hit_Knockback`.

## Stomp or ground punch on a fallen doll

Load: `R_hip` [-80,0,0], `R_knee` [90,0,0]. Contact 4 frames later: `R_hip` [-25,0,0], `R_knee` [20,0,0], `chest` [12,0,0]. Use a high angle camera; the victim shudders (2 frames object y -0.03, back).

## Recoil layer on the victim (object channels)

| Hit | position (away from the striker) | rotation | timing |
| --- | --- | --- | --- |
| Jab | 0.05 to 0.1 m | head only, via the clip | 3 to 4 frames, ease-out |
| Cross / hook | 0.2 to 0.35 m | object Y turn 10 to 20 degrees away from the fist | 5 to 7 frames, ease-out, then settle |
| Kick to the body | 0.3 to 0.5 m | fold: X +10 toward the striker | 6 frames |
| Heavy (knockback) | 0.6 to 1.5 m while `ual2/Hit_Knockback` plays | | 8 to 14 frames, ease-out |

Remember to key the position before the hit too (same value as the previous key) so the slide does not start early.
