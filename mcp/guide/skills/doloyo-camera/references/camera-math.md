# Camera math for Doloyo

Doloyo's `fov` is the **vertical** field of view. At distance `d` from the target the frame covers

- height `H = 2 * d * tan(fov / 2)`
- width `W = H * aspect` (9:16 portrait: `W = 0.5625 * H`; 16:9 landscape: `W = 1.778 * H`)

So the distance for a frame height `H` is `d = H / (2 * tan(fov / 2))`.

## Distance per shot size (camera to subject, meters)

Frame heights used: ECU 0.35 m, CU 0.6 m, MCU 0.85 m, MS 1.1 m, MFS 1.6 m, FS 2.3 m (a 1.75 m doll plus room), WS 4 m.

| fov | 2·tan(fov/2) | ECU | CU | MCU | MS | MFS | FS | WS |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 25 | 0.443 | 0.79 | 1.35 | 1.92 | 2.48 | 3.61 | 5.19 | 9.0 |
| 30 | 0.536 | 0.65 | 1.12 | 1.59 | 2.05 | 2.99 | 4.29 | 7.5 |
| 40 | 0.728 | 0.48 | 0.82 | 1.17 | 1.51 | 2.20 | 3.16 | 5.5 |
| 50 | 0.933 | 0.38 | 0.64 | 0.91 | 1.18 | 1.71 | 2.47 | 4.3 |
| 60 | 1.155 | 0.30 | 0.52 | 0.74 | 0.95 | 1.39 | 1.99 | 3.5 |

Portrait width at the same distance is 0.56 times the height: a 9:16 full shot (H 2.3 m) is only about 1.3 m wide. Two dolls side by side 1.5 m apart do not fit a portrait full shot side-on.

Lens feel: fov 20 to 30 = long lens, compressed, calm, good for low hero angles from far; 35 to 45 = neutral; 50 to 70 = wide, dynamic, exaggerated depth, good for close low angles and fast tracking. Above about 75 the dolls distort.

Target height: chest of a standing adult doll about 1.3 m, head 1.6 m, hips 0.95 m, a doll lying on the floor 0.15 to 0.3 m. Child and baby bodies are smaller (see Body sizes in the guide).

## Projected separation of two fighters

Fighters `s` meters apart. Camera angle `a` measured from the fight line (0 = looking along the line over one shoulder, 90 = flat side-on):

- across the frame: `s * sin(a)`
- in depth: `s * cos(a)`

| a | across | depth | note |
| --- | --- | --- | --- |
| 20 | 0.34 s | 0.94 s | OTS; perfect for portrait |
| 35 | 0.57 s | 0.82 s | oblique; portrait medium shots |
| 50 | 0.77 s | 0.64 s | oblique; landscape medium, portrait wide |
| 90 | 1.0 s | 0 | side-on; close shots only |

## Orbit helper

Place a camera around a midpoint `M` of the action, given the fight-line direction `u` (horizontal unit vector from fighter A to fighter B), angle `a` from that line (degrees, positive = toward the +Z side for a line along +X), elevation `e` (degrees, negative = camera below the target looking up), distance `d` and target height `ty`.

```js
// returns { position, target } for camera_set
function orbitCam(M, u, a, e, d, ty) {
  const r = Math.PI / 180;
  const n = [-u[2], 0, u[0]];                    // horizontal perpendicular of u
  const hx = -u[0] * Math.cos(a * r) + n[0] * Math.sin(a * r);
  const hz = -u[2] * Math.cos(a * r) + n[2] * Math.sin(a * r);
  const flat = d * Math.cos(e * r);
  const y = Math.max(0.15, ty + d * Math.sin(e * r)); // never under the floor
  return { position: [M[0] + hx * flat, y, M[2] + hz * flat], target: [M[0], ty, M[2]] };
}
// a = 0: camera behind A looking at B (OTS of A). a = 180: behind B looking at A.
```

For an orbit, call it at angles `a0, a0 + 15, a0 + 30, ...` and key each result (linear easing inside the arc, an ease-out on the last key). Keep every orbit within 90 degrees during contact.

## Following a moving subject

Sample the subject's path (your own position keys, or the times you wrote them) every 0.3 to 0.5 s and key the camera at `subject + offset`, with the target slightly ahead of the subject (0.3 to 0.8 m in the travel direction). Linear easing between samples, an ease-out on the last one. Keep the offset constant during a track so the background slides and the subject stays put; change the offset to make the shot evolve (start behind and low, end three-quarter front).

## Shake and drift numbers

| Effect | Amplitude (position) | Duration | Pattern |
| --- | --- | --- | --- |
| Handheld drift | 2 to 5 cm, target 1 to 3 cm | continuous, a key every 12 to 20 frames | irregular, easeInOut |
| Light hit shake | 2 to 3 cm | 3 to 4 frames | +, -, +/2, 0 |
| Heavy hit shake | 5 to 8 cm and target 3 to 5 cm | 5 to 8 frames | +, -, +, -/2, +/4, 0 |
| Landing thump | camera y -4 to -8 cm | 2 frames down, 6 back | ease-out back up |

Shake keys are per frame (`key_add` with consecutive `frame` values), linear easing. Shake is a seasoning: only on hits that matter.
