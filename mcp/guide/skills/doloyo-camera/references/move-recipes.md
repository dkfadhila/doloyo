# Camera move recipes

All examples assume two fighters facing each other along X around the origin (Lead at x = -0.7, Thug at x = 0.7, both on the floor), 30 fps, a 9:16 render and a camera named `Render Camera`. Shift the numbers to your scene. Every block is a single `batch`, so it is one undo step.

## Low-angle hero push-in (wind-up before a big move)

Camera low and three-quarter front of the lead, pushing in while the lead loads up. Ease-out arrival right before the strike.

```json tool-call
{
  "tool": "batch",
  "arguments": {
    "commands": [
      { "type": "camera_set", "position": [-2.4, 0.35, 2.6], "target": [-0.6, 1.25, 0], "fov": 42 },
      { "type": "key_add", "object": "Render Camera", "frame": 240, "easing": { "type": "bezier", "c": [0.2, 0, 0, 1] } },
      { "type": "camera_set", "position": [-1.7, 0.45, 1.7], "target": [-0.6, 1.3, 0], "fov": 40 },
      { "type": "key_add", "object": "Render Camera", "frame": 270 }
    ]
  }
}
```

## Punch-in plus shake on the impact frame

The strike lands at frame 300. FOV snaps in over 3 frames, the camera shakes for 5 frames, then the fov relaxes over 12 frames. The `target` channel is keyed alone for the shake so the punch-in keys on `fov` stay independent.

```json tool-call
{
  "tool": "batch",
  "arguments": {
    "commands": [
      { "type": "camera_set", "fov": 40 },
      { "type": "key_add", "object": "Render Camera", "frame": 299, "target": "fov", "easing": { "type": "bezier", "c": [0.05, 0.7, 0.1, 1] } },
      { "type": "camera_set", "fov": 27 },
      { "type": "key_add", "object": "Render Camera", "frame": 302, "target": "fov", "easing": "step" },
      { "type": "camera_set", "fov": 27 },
      { "type": "key_add", "object": "Render Camera", "frame": 306, "target": "fov", "easing": "easeInOut" },
      { "type": "camera_set", "fov": 34 },
      { "type": "key_add", "object": "Render Camera", "frame": 318, "target": "fov" },
      { "type": "camera_set", "target": [0.6, 1.3, 0] },
      { "type": "key_add", "object": "Render Camera", "frame": 300, "target": "target" },
      { "type": "camera_set", "target": [0.66, 1.34, 0] },
      { "type": "key_add", "object": "Render Camera", "frame": 301, "target": "target" },
      { "type": "camera_set", "target": [0.55, 1.27, 0] },
      { "type": "key_add", "object": "Render Camera", "frame": 302, "target": "target" },
      { "type": "camera_set", "target": [0.63, 1.32, 0] },
      { "type": "key_add", "object": "Render Camera", "frame": 303, "target": "target" },
      { "type": "camera_set", "target": [0.6, 1.3, 0] },
      { "type": "key_add", "object": "Render Camera", "frame": 305, "target": "target" }
    ]
  }
}
```

## Hard cut

Shot A holds until frame 359, shot B starts at frame 360. Change size and angle clearly (here a medium OTS becomes a low wide oblique), keep the line.

```json tool-call
{
  "tool": "batch",
  "arguments": {
    "commands": [
      { "type": "camera_set", "position": [-2.0, 1.45, 0.5], "target": [0.6, 1.25, 0], "fov": 38 },
      { "type": "key_add", "object": "Render Camera", "frame": 359, "easing": "step" },
      { "type": "camera_set", "position": [2.6, 0.5, 4.2], "target": [0, 0.9, 0], "fov": 46 },
      { "type": "key_add", "object": "Render Camera", "frame": 360 }
    ]
  }
}
```

## Whip pan to the next opponent

The camera stays put; the target swings from the first opponent to the second over 5 frames, slow-fast-slow, landing with a hint of overshoot.

```json tool-call
{
  "tool": "batch",
  "arguments": {
    "commands": [
      { "type": "camera_set", "position": [0, 1.4, 3.2], "target": [0.7, 1.2, 0], "fov": 40 },
      { "type": "key_add", "object": "Render Camera", "frame": 420, "easing": { "type": "bezier", "c": [0.7, 0, 0.3, 1.08] } },
      { "type": "camera_set", "target": [-2.5, 1.2, -1.5] },
      { "type": "key_add", "object": "Render Camera", "frame": 425 }
    ]
  }
}
```

## Tracking a run (chase)

Lead runs from x = 0 to x = 8 between frames 480 and 600 (4 s). The camera keeps a constant offset three-quarter front and low, keyed every 15 frames, linear, target ahead of the runner. Generate the keys in a loop in your own code; the first three are shown.

```json tool-call
{
  "tool": "batch",
  "arguments": {
    "commands": [
      { "type": "camera_set", "position": [1.8, 0.7, 2.6], "target": [0.6, 1.1, 0], "fov": 48 },
      { "type": "key_add", "object": "Render Camera", "frame": 480, "easing": "linear" },
      { "type": "camera_set", "position": [2.8, 0.7, 2.6], "target": [1.6, 1.1, 0] },
      { "type": "key_add", "object": "Render Camera", "frame": 495, "easing": "linear" },
      { "type": "camera_set", "position": [3.8, 0.7, 2.6], "target": [2.6, 1.1, 0] },
      { "type": "key_add", "object": "Render Camera", "frame": 510, "easing": "linear" }
    ]
  }
}
```

## Crane up with a jump, high angle at the apex

```json tool-call
{
  "tool": "batch",
  "arguments": {
    "commands": [
      { "type": "camera_set", "position": [1.5, 0.6, 3.0], "target": [0, 1.2, 0], "fov": 45 },
      { "type": "key_add", "object": "Render Camera", "frame": 600, "easing": "easeIn" },
      { "type": "camera_set", "position": [1.2, 3.8, 2.4], "target": [0, 1.6, 0], "fov": 45 },
      { "type": "key_add", "object": "Render Camera", "frame": 618, "easing": "easeOut" },
      { "type": "camera_set", "position": [1.0, 4.2, 2.0], "target": [0, 0.6, 0], "fov": 42 },
      { "type": "key_add", "object": "Render Camera", "frame": 640 }
    ]
  }
}
```

## Finisher: pull-back, slow track, hold

The finisher lands at frame 810. The camera starts tight, pulls back and up while it drifts sideways, and comes to an almost complete stop on a wide oblique of the winner with the loser on the floor.

```json tool-call
{
  "tool": "batch",
  "arguments": {
    "commands": [
      { "type": "camera_set", "position": [-1.3, 1.1, 1.2], "target": [0.2, 1.1, 0], "fov": 34 },
      { "type": "key_add", "object": "Render Camera", "frame": 810, "easing": { "type": "bezier", "c": [0.1, 0.6, 0.2, 1] } },
      { "type": "camera_set", "position": [-2.6, 1.9, 3.6], "target": [0.1, 0.9, 0], "fov": 40 },
      { "type": "key_add", "object": "Render Camera", "frame": 860, "easing": "easeInOut" },
      { "type": "camera_set", "position": [-2.75, 1.95, 3.8], "target": [0.1, 0.9, 0], "fov": 40 },
      { "type": "key_add", "object": "Render Camera", "frame": 900 }
    ]
  }
}
```

## Handheld micro-drift over a held medium shot

Irregular spacing and amplitudes; never a perfect sine.

```json tool-call
{
  "tool": "batch",
  "arguments": {
    "commands": [
      { "type": "camera_set", "position": [1.6, 1.35, 1.9], "target": [0, 1.3, 0] },
      { "type": "key_add", "object": "Render Camera", "frame": 120, "target": ["position", "target"], "easing": "easeInOut" },
      { "type": "camera_set", "position": [1.63, 1.37, 1.88], "target": [0.02, 1.31, 0] },
      { "type": "key_add", "object": "Render Camera", "frame": 134, "target": ["position", "target"], "easing": "easeInOut" },
      { "type": "camera_set", "position": [1.58, 1.34, 1.93], "target": [-0.01, 1.29, 0.01] },
      { "type": "key_add", "object": "Render Camera", "frame": 151, "target": ["position", "target"], "easing": "easeInOut" },
      { "type": "camera_set", "position": [1.61, 1.36, 1.9], "target": [0.01, 1.3, 0] },
      { "type": "key_add", "object": "Render Camera", "frame": 163, "target": ["position", "target"] }
    ]
  }
}
```

## Over-the-shoulder exchange (portrait favorite)

Camera behind the thug's right shoulder, slightly high, the lead faces the lens; the thug's shoulder and head fill a corner of the frame. Use `orbitCam` with `a` about 160 to 170 (behind B), `e` 5 to 10, `d` 1.6 to 2.2, fov 36 to 42, target at the lead's chest.
