# Camera

Scene-level camera: pans across the composition and zooms in/out along timed
actions. Authored under `scene.camera` (per-scene, optional). Two equivalent
authoring forms — a quick `start`/`end` two-keypoint form, and a full
`actions[]` array for multi-keystone moves. Resolved by
`src/templating/camera.js` into a `camera` block on the resolved scene.

There is no `add-music`-style raw manifest write needed here. Camera rides on
`scene.camera`, set via the camera CLI commands (or inline on `add-scene`).

## Forms

### 1. Start/end (two keypoints)

The simplest form — pan/zoom from one anchor to another over the full scene:

```bash
node scripts/agent-cli.mjs set-camera <projectId> <sceneId> '{
  "start":            { "position": "center", "offsetXPercent": 0 },
  "end":              { "position": "top-left", "offsetXPercent": 5 },
  "zoomStartPercent": 120,
  "zoomEndPercent":   180,
  "durationInFrames": 60,
  "speed":            1.0,
  "easeZoom":         true
}'
```

`start`/`end` are `cameraAnchor` specs (see "Anchors" below). The resolver
synthesizes them into a 2-element `actions[]` at `at:0` and `at:1`, so the
rest of the pipeline only ever sees the `actions[]` form.

### 2. Actions array (multi-keypoint)

For a move with more than two keypoints, or keypoints at intermediate times:

```bash
node scripts/agent-cli.mjs set-camera <projectId> <sceneId> '{
  "easeZoom": true,
  "actions": [
    { "at": 0,   "anchor": { "position": "center" },     "zoomPercent": 100 },
    { "at": 0.5, "anchor": { "followAssetId": "hero" },  "zoomPercent": 200 },
    { "at": 1,   "anchor": { "position": "bottom-right" }, "zoomPercent": 150 }
  ]
}'
```

Each `action` is `{ at, anchor?, zoomPercent?, id? }`:
- `at`: fraction of scene duration, `[0, 1]`. **Required.**
- `anchor`: a `cameraAnchor` (defaults to the action's own position or center).
- `zoomPercent`: zoom level at this keypoint (≥ 1). Default 100. See "Zoom" below.
- `id`: optional string for reference; resolved actions preserve it.

Actions are sorted by `at` on resolve, so array order doesn't matter.

## Anchors (`cameraAnchor`)

Each anchor is one of two shapes — schema enforces `oneOf`:

**A. Named corner** — `{ position, offsetXPercent, offsetYPercent }`:
```json
{ "position": "top-left", "offsetXPercent": 5, "offsetYPercent": -3 }
```
- `position`: enum `center | top | bottom | left | right | top-left | top-right | bottom-left | bottom-right`. **Required.**
- `offsetXPercent` / `offsetYPercent`: signed composition-space % nudge from the named anchor. Default 0.

**B. Follow an asset** — `{ followAssetId, edge, offsetXPercent, offsetYPercent }`:
```json
{ "followAssetId": "hero", "edge": "enter", "offsetXPercent": 0 }
```
- `followAssetId`: id of an asset in this scene. Camera tracks that asset's
  resolved center + the nudge. **Required** for this form.
- `edge`: enum `enter | exit`. Picks whether the camera locks to the asset's
  position at the asset's `enterAt` frame or its `exitAt` frame (the asset
  may have moved between them via `motion`). Default `enter`.
- `offsetXPercent` / `offsetYPercent`: signed % nudge from the asset center.

`followAssetId` here is on **camera anchors** — distinct from the
`anchorEdge` field added to **asset anchors** (WavyLine connectors, etc.) by
`edge-logic`. Asset-anchor edges pick a point on the target's own box;
camera-anchor `edge` picks which *time* of the followed asset to sample.

## Zoom

`zoomPercent` is in **percent**, ≥ 1 (minimum enforced by schema).
- 100 = unity (1:1)
- 200 = 2× zoom in
- `zoomPercent` appears both at the top level (used only by the start/end
  form) and per-action. Per-action wins when both are set: precedence inside
  the resolver is `zoomPercent` → `zoomEndPercent` → `zoomStartPercent` → 100.
- `zoomStartPercent` / `zoomEndPercent` are honored in the start/end form
  (mapped to the `at:0` / `at:1` actions respectively). In the `actions[]`
  form, use per-action `zoomPercent` instead.

## `durationInFrames` and `speed`

- `durationInFrames`: number ≥ 1. Optional. When set, the camera move
  completes within this many frames (a sub-window of the scene). Omit for the
  camera to span the scene's full resolved duration.
- `speed`: number ≥ 0.01. Default 1. Multiplier on the tween speed — higher
  reaches the end anchor sooner and dwells; lower eases through longer.

Both are preserved on the resolved `camera` block as-is; `easeZoom` does not
change them.

## `easeZoom`

Boolean, default false. Covered in `parallax.md` — repeated here for
completeness:
- `false` (legacy): zoom snaps instantly to the current action's
  `zoomPercent` at that action's `at`.
- `true`: zoom interpolates linearly between consecutive actions' zoom values
  across the segment.

Additive — disabling on a previously continuous camera restores the snap
behavior, it does not error.

## CLI commands

```bash
# set scene camera from scratch (replaces any existing)
node scripts/agent-cli.mjs set-camera <projectId> <sceneId> '<spec>'

# append one action without disturbing existing ones
node scripts/agent-cli.mjs add-camera-action <projectId> <sceneId> '{ "at": ..., "anchor": {...}, "zoomPercent": ... }'

# shallow-merge patch (scalars overwrite; `actions` replace wholesale — pass the full array to change actions)
node scripts/agent-cli.mjs update-camera <projectId> <sceneId> '{ "easeZoom": true }'

# clear the scene camera (back to a static centered view)
node scripts/agent-cli.mjs remove-camera <projectId> <sceneId>
```

`update-camera` overwrites each scalar (`durationInFrames`, `speed`,
`zoomPercent`, `zoomStartPercent`, `zoomEndPercent`, `easeZoom`) when present
and replaces `actions` wholesale — pass the full actions array when you mean
to change actions, not just the new one (use `add-camera-action` for that).

## Common pitfalls

- **`zoomPercent` ≥ 1, not a fraction.** 100 = unity; 1.5 will fail validation.
- **`at` is a fraction of scene duration, `[0,1]`** — not a frame number.
  Frame 45 of a 90-frame scene is `at: 0.5`.
- **`actions` replace wholesale on `update-camera`.** If you only mean to add
  one keypoint, use `add-camera-action` — it preserves the existing array.
- **A `followAssetId` anchor references an asset in the *same* scene.**
  Resolved at scene pass-1; the resolver throws with the scene id and missing
  id rather than silently centering.
- **`edge` on a camera `followAssetId` anchor ≠ `anchorEdge` on an asset
  anchor.** Different fields, different vocabularies. See `edge-logic.md`
  for the asset-side `anchorEdge`.
