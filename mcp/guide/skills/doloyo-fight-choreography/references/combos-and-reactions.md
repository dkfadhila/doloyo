# Combos, reactions and escalation

## Reaction map

| Hit lands on | Victim clip | Object layer | Camera |
| --- | --- | --- | --- |
| Head, light (jab) | `ual1/Hit_Head` | 0.05 to 0.1 m back | none or a 2-frame shake |
| Head, heavy (cross, hook, uppercut) | `ual1/Hit_Head`, then `ual2/Idle_Shield_Break` if it staggers | 0.2 to 0.35 m back, Y turn 10 to 20 degrees | punch-in, light shake |
| Body | `ual1/Hit_Chest` | 0.15 to 0.3 m back, fold forward (rotation X toward striker 8 to 12 degrees, 6 frames) | punch-in on the striker's shoulder line |
| Guard broken | `ual2/Idle_Shield_Break` | 0.3 m back | quick push |
| Knockdown | `ual2/Hit_Knockback` (fast) or `ual1/Death01` (staggered, slow) | 0.6 to 1.5 m slide during the fall | hold wide or tilt down; low angle from behind the striker |
| Gets back up | `ual2/LayToIdle` after a knockdown | | crane down to a low angle |
| Swept / tripped | `ual2/Hit_Knockback` started 2 frames after the sweep contact | slide 0.3 m | wide, low |

Rules:
- A reaction starts on the contact frame (clip start = striker clip start + contact offset / speed). One frame late is fine, early is not.
- A knocked-down doll stays down: after `Hit_Knockback` or `Death01` it holds the lying pose (the last clip's last frame) unless you apply `ual2/LayToIdle`. Do not lay an idle over it by mistake.
- Never two identical reactions in a row on the same doll.

## Combo rhythms

Write combos as named move chains with targets and the defender's answer, not as "fast punches":

| Name | Chain (attacker) | Defender | Timing |
| --- | --- | --- | --- |
| Opener | jab, jab, cross | covers, covers, eats the cross | 0.25, 0.25, then 0.4 s |
| Three light, one heavy | jab, cross, chop, hook | blocks, blocks, slips, gets hit | 0.2 s apart, 0.3 s before the hook |
| Counter | thug cross, lead block, lead hook | | block on the thug's contact frame; hook 0.3 s later |
| Body-head | cross to the body, hook to the head | folds, then snaps back | 0.35 s apart |
| Level change | thug swings high, lead slides under, sweep | thug knocked down | slide 0.4 s, sweep contact 0.15 s after the slide exit |
| Launcher | uppercut, then a lunge (`ual2/Sword_Dash`) while the thug is in the air | knockback | uppercut contact, lunge contact 0.35 s later |
| Finisher | breath hold 0.4 s, lunge or overhead (`ual2/OverhandThrow`), knockback | `ual2/Hit_Knockback` or `ual1/Death01` | punch-in on contact, pull-back after |

## One against many

- The lead fights one thug at a time; the others circle or hold guard in the background (idle loops, slow object travel), never standing frozen.
- Rotate the lead (object `rotation` Y) to face each new opponent 3 to 6 frames before the attack: the head turn reads as anticipation.
- Order of difficulty: easiest thug first (one or two hits), then a faster one (exchange, level change), then the big one (reversal, the lead takes damage, then the finisher).
- After every knockdown, a wide-ish shot (or a whip pan) shows who is left.

## Escalation ladder for 30 s

1. Cold open: one hit and a reaction, medium shot, inside 1.5 s.
2. Exchange one: short, the lead dominates (knockdown 1).
3. Exchange two: faster, with a level change (slide, roll, jump).
4. Reversal: the lead is hit hard or knocked down and gets up (`ual2/LayToIdle`). Close-ups.
5. Relocation or chase: tracking shots, speed.
6. Breath: a standoff with the big thug, low hero angle on the lead, push-in.
7. Finisher in three acts, final held wide.

## Spacing cheat sheet (adult dolls)

| Action | Chest-to-chest distance |
| --- | --- |
| Clinch, knee | 0.4 to 0.5 m |
| Hook, uppercut | 0.55 to 0.7 m |
| Jab, cross, chop | 0.7 to 0.9 m |
| Kick, lunge (`Sword_Dash`), shoulder charge | 1.0 to 1.3 m before, closing during the move |
| Standoff | 2 to 4 m |

Keep the line between two fighters at an angle to the camera (see `doloyo-camera`): side-on only in close shots.
