Parallax & Camera Depth Guide

This document describes the "2.5D" parallax mechanism used to create depth in scenes during camera pans and zooms. By assigning different depth values to assets, you can simulate a multi-plane environment where background elements move slower than foreground elements.

1. The depth Parameter

Depth is authored within an asset's styleOverride object. It is a multiplier that determines how much that specific asset responds to the camera's transform.

Field: styleOverride.depth (Number)
Default: 1

Depth Value Reference

Value: 0
Effect: Pinned
Use Case: HUD elements, kicker text, or UI overlays that must stay locked to the frame
  regardless of camera motion.
────────────────────────────────────────
Value: 0 < d < 1
Effect: Background
Use Case: Background photos, maps, or atmosphere. Lower values move/zoom less, creating
  a sense of distance.
────────────────────────────────────────
Value: 1
Effect: Anchor
Use Case: The default plane. Assets at depth 1 follow the camera's base zoom/pan exactly
  (1:1).
────────────────────────────────────────
Value: d > 1
Effect: Foreground
Use Case: Elements that should "pop" or move faster than the subject, such as floating
  particles or foreground frames.



2. Continuous Zoom (easeZoom)

By default, the camera zoom snaps instantly to the zoomPercent of the current action. To create a smooth, continuous push-in or pull-out across a segment, enable easeZoom.

Field: scene.camera.easeZoom (Boolean)
Default: false

- false: Zoom jumps to the value of the current action immediately.
- true: Zoom interpolates linearly between the current action and the next action over the course of the segment.



3. Design Recipes (The "Vox" Style)

To achieve a high-end documentary collage look, use the following layering strategy:

The 2.5D Map Push
1. Base Layer (depth: 0.3 - 0.6): A high-res map or background photo. Apply a slight blurPx to sell the depth of field.
2. Subject Layer (depth: 1): The primary cutout, chart, or text block the camera is focusing on.
3. Accent Layer (depth: 1.2 - 1.5): Small floating elements or "crumbs" that fly past the camera during the zoom.
4. UI Layer (depth: 0): A "Source: Reuters" label or a timestamp that stays perfectly still.
5. Camera: Set easeZoom: true for a cinematic, non-stop push.



4. CLI Examples

Adding a depth-aware asset
bash
node scripts/agent-cli.mjs add-asset <projId> <sceneId> '{
  "assetType": "BackdropImage",
  "contentOverride": { "src": "map.jpg" },
  "styleOverride": { "depth": 0.4, "blurPx": 2 }
}'


Setting a smooth parallax camera
bash
node scripts/agent-cli.mjs set-camera <projId> <sceneId> '{
  "easeZoom": true,
  "actions": [
    { "at": 0, "anchor": { "position": "center" }, "zoomPercent": 100 },
    { "at": 1, "anchor": { "position": "center" }, "zoomPercent": 200 }
  ]
}'