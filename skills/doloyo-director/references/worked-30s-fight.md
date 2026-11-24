# Worked example: a 30 s 9:16 street fight

One mannequin against three thugs on a night street, 1080x1920, 30 fps, built entirely through MCP calls by a script (about 80 `anim_apply`, 60 `batch`, 19 `image_add` calls).

## Set and cast

- Set: a large cube floor, a row of box buildings (cubes) with night facade pictures as locked image planes, a dark street texture plane, an alley between two buildings, lamp posts (thin cylinders), crates and a dumpster (cubes), a moonlit sky as the render-camera background (`image_add` mode `camera`).
- Lead: `mannequin-f` (smooth, slim). Thugs: `doll-procedural` (wooden art doll), the last one with `body: { preset: "dewasa", heightScale: 1.1 }`. The two silhouettes never get confused, even in wides.

## Beat sheet

| Time | Beat | Point |
| --- | --- | --- |
| 0 to 1.5 | Thug A swings, the lead blocks and lands a cross | hook: contact inside 1 s |
| 1.5 to 4.3 | jab, front kick, duck under his cross, rising hook: Thug A knocked down | the lead dominates |
| 4.3 to 9.3 | Thug B charges, she slides under his lunge, chop combo, uppercut; he runs | faster, level change |
| 9.3 to 13.0 | chase down the street to an alley | speed, relocation |
| 13.0 to 16.9 | the big Thug C ambushes her from the alley: she is knocked down, gets up | reversal |
| 16.9 to 21.4 | kick drops Thug B, she rolls under C's swipe, two chops and a cross stagger C | comeback |
| 21.4 to 23.7 | standoff, slow push on a low hero angle, a near freeze | breath before the finisher |
| 23.7 to 25.6 | C's swing blocked, jab, lunge: C knocked flying | finisher (break, bloom) |
| 25.6 to 30 | pull back and up; she folds her arms over the two fallen thugs | aftermath, final image |

## Shot list

| Time | Shot / move | Action |
| --- | --- | --- |
| 0.00 to 0.93 | MS over Thug A's shoulder, push-in, punch-in on impact | block, cross lands |
| 0.93 to 1.93 | cut: MFS reverse over the lead, small punch-in | jab, Thug A staggers |
| 1.93 to 2.90 | cut: low wide oblique (hero angle), punch-in + shake | front kick lands |
| 2.90 to 4.30 | cut: MFS high oblique, then a fast pull-back | duck, rising hook, knockdown |
| 4.30 to 5.40 | whip pan to Thug B, low over-the-shoulder behind the lead, push | Thug B charges |
| 5.40 to 6.85 | ground-level truck | slide under the lunge |
| 6.85 to 8.35 | cut: MS over Thug B's shoulder, punch-in on each hit | chop combo |
| 8.35 to 9.35 | cut: low angle side-on, tilt up | uppercut, Thug B turns to run |
| 9.35 to 10.70 | cut: low front three-quarter track ahead of the runners | chase, both in depth |
| 10.70 to 12.00 | cut: high wide track | chase along the facades |
| 12.00 to 13.28 | low static at the alley mouth, pan | Thug B runs in, Thug C steps out |
| 13.28 to 13.90 | cut: low behind the lead looking up at C, punch-in + heavy shake, camera recoils | overhand lands, she flies at the lens |
| 13.90 to 15.30 | cut: high angle over C's shoulder, slow push | she lies on the street, B joins |
| 15.30 to 16.95 | crane down to a low hero angle in front of her (moon behind) | she gets up |
| 16.95 to 17.90 | cut: MS oblique, punch-in + shake | B charges into a front kick |
| 17.90 to 19.55 | cut: high wide oblique, truck | C swipes, she rolls past him |
| 19.55 to 21.45 | cut: MFS high oblique from behind C, punch-ins | two chops and a cross |
| 21.45 to 23.70 | cut: low hero angle past C's hip, slow push-in, then a breath hold | standoff |
| 23.70 to 24.85 | cut: MCU side-on two-shot, punch-in | block, jab |
| 24.85 to 25.60 | cut: ground-level wide, punch-in + heavy shake | lunge, C knocked flying |
| 25.60 to 30.00 | pull-back + crane up + slow track, then hold | arms folded over the fallen |

21 shots, average 1.4 s; no shot size held longer than about 2 s except the deliberate standoff push and the final pull-back.

## Clips

Strikes: `ual1/Punch_Cross`, `ual1/Punch_Jab`, `ual2/Melee_Hook` + `ual2/Melee_Hook_Rec`, `ual2/Sword_Regular_Combo`, `ual2/Sword_Regular_A`, `ual2/Sword_Regular_B`, `ual2/Sword_Dash`, `ual2/Shield_Dash`, `ual2/OverhandThrow`, `ual2/Zombie_Scratch`, `ual2/Sword_Block`. Movement: `ual2/Slide_Start` + `ual2/Slide_Exit`, `ual1/Roll`, `ual1/Sprint_Loop`, `ual1/Jog_Fwd_Loop`, `ual1/Walk_Loop`. Reactions: `ual1/Hit_Head`, `ual1/Hit_Chest`, `ual2/Idle_Shield_Break`, `ual2/Hit_Knockback`, `ual1/Death01`, `ual2/LayToIdle`. Holds: `ual1/Idle_Loop` (gap filler), `ual2/Idle_FoldArms_Loop`, `ual2/Idle_No_Loop`. Hand-keyed: two front kicks, a duck, an uppercut.

## Techniques that made the difference

- Per doll, events in time order; every gap filled with a trimmed `ual1/Idle_Loop`; reactions placed on the striker's contact frame (`start + contact / speed`).
- Clip blending: after each `anim_apply`, the first 2 (reactions), 3 to 4 (strikes, moves) or 6 (idles) frames of the new run are removed and the previous key gets `easeInOut`, so Doloyo interpolates from the old pose into the new clip.
- Object recoil on every hit (0.1 to 0.5 m away from the striker, strong ease-out), knockback slides of 1.2 to 1.6 m, step-ins by the striker to keep the distance.
- Camera keys computed from the dolls' path data with an orbit helper, so retiming a beat moves the camera with it. Cuts are adjacent-frame keys; impacts add a 3-frame fov punch-in and a 6-frame decaying target shake.
- Critique loop: five preview renders at 360x640, 15 fps. Problems found and fixed: over-the-shoulder shots where the near thug covered the lead (camera raised to 2.0 to 2.2 m and moved 1.2 to 1.5 m aside), a kick shot too close for 9:16 (angle reduced to 40 degrees, distance up), a low hero shot that showed the lead's back (camera moved in front of her), the grey edge of the floor visible behind low angles (floor enlarged, dark plane under everything), a lunge that passed through the target (contact distance increased), a stale preview file (exports never overwrite: new filename per preview).
