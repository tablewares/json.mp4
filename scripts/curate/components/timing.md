# Asset Timing Anchors

Replaces manual fraction guessing with dynamic event-relative timing for `enterAt` and `exitAt`.

## The Order Rule
**Targets must precede references.** An asset can only anchor to a camera action or an asset authored *earlier* in the `scene.assets` array.

## Anchor Shapes

### 1. Asset-Relative
Fire relative to another asset's entrance or exit.
```json
"enterAt": { 
  "relativeToAsset": "asset-id", 
  "edge": "exit", 
  "offsetFrames": 10 
}
```
- `edge`: `"enter"` or `"exit"`.
- `offsetFrames`: Delay (positive) or lead (negative) from the edge.

### 2. Camera-Relative
Fire relative to a specific camera action.
```json
"exitAt": { 
  "relativeToCameraAction": "action-id", 
  "offsetFrames": -5 
}
```

### 3. Percent-Relative
Fire relative to the scene duration (similar to legacy, but explicit).
```json
"enterAt": { "offsetPercent": 0.25 }
```

## Legacy Support
Bare numbers (e.g., `"enterAt": 0.5`) remain supported as fractions of the scene's duration.

## Constraints
- **Clamping:** All resolved frames are clamped to `[0, sceneDurationInFrames]`.
- **Verification:** Invalid anchor objects trigger non-fatal warnings during `add-asset` / `update-asset`.
