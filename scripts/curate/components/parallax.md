# Parallax and camera depth

2.5D parallax mechanism for simulating depth during camera pans/zooms. By
giving assets different `depth` values, the background moves slower than the
foreground while the camera transforms, producing a multi-plane look.

Authoring surface:
- `styleOverride.depth` on any asset — multiplier on how much that plane responds to the camera. Additive: depth absent on an asset behaves identically to the single-plane renderer (depth = 1).
- `scene.camera.easeZoom` — makes zoom interpolate continuously across camera actions rather than snap per action.

There is no `add-music`-style raw manifest write needed here. Depth rides on
`styleOverride` (a normal `add-asset` / `update-asset` field); `easeZoom` rides
on `scene.camera`, set via the camera CLI commands.

## 1. The `depth` parameter

Field: `styleOverride.depth` (number). Default: 1.

| Range       | Effect      | Use |
|-------------|-------------|-----|
| 0           | Pinned      | HUD elements, kicker text, UI overlays that must stay locked to the frame regardless of camera motion |
| 0 < d < 1   | Background  | Background photos, maps, atmosphere — move/zoom less, creating distance |
| 1           | Anchor      | Default plane. Follows the camera's base zoom/pan 1:1 |
| d > 1       | Foreground  | Elements that should "pop" or move faster than the subject (floating particles, foreground frames) |

Negative values are not supported by the renderer — keep `depth` in `[0, ∞)`.

## 2. Continuous zoom (`easeZoom`)

By default the camera zoom snaps instantly to the `zoomPercent` of the current action. Enable `easeZoom` for a smooth, continuous push-in/pull-out.

Field: `scene.camera.easeZoom` (boolean). Default: false.

- false: zoom jumps to the current action's `zoomPercent` immediately at that action's `at`.
- true: zoom interpolates linearly between the current action's `zoomPercent` and the next action's `zoomPercent` across the segment.

`zoomPercent` is in percent (≥ 1), not a fraction — 100 is unity, 200 is 2x, etc.

## 3. Per-action easing (`easing`) — the "swoosh" zoom

Each camera action (or the top-level `start`/`end` shorthand) accepts an
`easing` field: `'linear'` (default) | `'easeIn'` | `'easeOut'` | `'easeInOut'`.
It shapes the pace of the leg LEAVING that action toward the next one — same
convention as `motion.rotate.easing`. It affects the anchor pan always, and
the zoom too when `easeZoom: true`.

`easeOut` on a short `at` window reads as a fast "snap"; `linear` (or a very
long window) reads as a slow, continuous drift. Combining short eased legs
with one long linear leg is how you build the Vox-style "snap halfway →
subtly continue zooming → snap fully in" camera move
(see `scripts/curate/solutions/taste/vox-camera-work.md`) without any new
render logic — it's the `camera.swooshSnap` alias below.

## 4. Design recipe (Vox-style "2.5D map push")

To get a high-end documentary collage look:

1. Base layer (depth in `[0.3, 0.6]`): high-res map or background photo. Apply `blurPx` in a small px range to sell depth of field.
2. Subject layer (depth 1): primary cutout, chart, or text block the camera is focusing on.
3. Accent layer (depth in `[1.2, 1.5]`): small floating elements or "crumbs" that fly past the camera during the zoom.
4. UI layer (depth 0): "Source: ..." label or timestamp that stays perfectly still.
5. Camera: `easeZoom: true` for a cinematic, non-stop push.

Order in `assets[]` only matters within the same depth value (stable), so stack planes by depth, not by array position.

## CLI examples

Add a depth-aware asset:

```bash
node scripts/agent-cli.mjs add-asset <projectId> <sceneId> '{
  "assetType": "BackdropImage",
  "contentOverride": { "src": "<path-under-public/" },
  "styleOverride": { "depth": <number-in-0..1>, "blurPx": <number> }
}'
```

Patch just the depth of an existing asset (other style keys untouched):

```bash
node scripts/agent-cli.mjs update-asset <projectId> <sceneId> <assetId> '{
  "styleOverride": { "depth": <number> } }'
```

Set a smooth parallax camera from scratch (replaces any existing scene camera):

```bash
node scripts/agent-cli.mjs set-camera <projectId> <sceneId> '{
  "easeZoom": true,
  "actions": [
    { "at": 0, "anchor": { "position": "center" }, "zoomPercent": <number-≥-100> },
    { "at": 1, "anchor": { "position": "center" }, "zoomPercent": <number-≥-100> }
  ]
}'
```

Vox-style "snap halfway → subtly continue zooming → snap fully in" via the `camera.swooshSnap` alias (see `discovery.mjs alias camera.swooshSnap` for the full var list):

```bash
node scripts/agent-cli.mjs set-camera <projectId> <sceneId> '{
  "$alias": "camera.swooshSnap",
  "anchor": { "position": "center" },
  "durationInFrames": <frames-≲-1.5s-at-project-fps>
}'
```

Or author the four actions directly for full control over the snap/drift/snap timing:

```bash
node scripts/agent-cli.mjs set-camera <projectId> <sceneId> '{
  "easeZoom": true,
  "actions": [
    { "at": 0,    "anchor": { "position": "center" }, "zoomPercent": 100, "easing": "easeOut" },
    { "at": 0.12, "anchor": { "position": "center" }, "zoomPercent": 130, "easing": "linear"  },
    { "at": 0.88, "anchor": { "position": "center" }, "zoomPercent": 140, "easing": "easeIn"  },
    { "at": 1,    "anchor": { "position": "center" }, "zoomPercent": 165, "easing": "easeIn"  }
  ]
}'
```

Append one camera action without disturbing existing ones:

```bash
node scripts/agent-cli.mjs add-camera-action <projectId> <sceneId> '{
  "at": <number-0..1>, "anchor": { "position": "<one-of-9-anchors>" }, "zoomPercent": <number-≥-100> }'
```

Patch an existing scene camera (shallow merge; `actions` replace wholesale, so pass the full actions array when you mean to change actions):

```bash
node scripts/agent-cli.mjs update-camera <projectId> <sceneId> '{ "easeZoom": true }'
```

Clear the scene camera entirely (back to a static centered view):

```bash
node scripts/agent-cli.mjs remove-camera <projectId> <sceneId>
```

## Common pitfalls

- Don't expect any parallax effect when `depth` is unset on every asset — the renderer collapses to the original single-plane transform. Anchor plane (1) + camera alone reads as a plain zoom/pan.
- Camera anchors accept `followAssetId` ( follow another asset's resolved center, nudge by composition-space %) in addition to the named-corner form — useful when the camera should track a moving element.
- `zoomPercent` is in percent (≥ 1, minimum enforced by schema). 100 = unity. Fractions like 1.5 will fail validation.
- `easeZoom` is additive — disabling it on a previously continuous camera restores the legacy snap behavior, it does not error.
- `easing` on an action only has a visible effect on ZOOM when `easeZoom: true` is also set; it always affects the anchor pan regardless. A camera with only one action (or all actions at the same `zoomPercent`) won't show any easing difference since there's nothing to interpolate.
