# Edge Logic Implementation

Implemented support for specifying a point on a target asset's own box when using `followAssetId` anchors, rather than always defaulting to the target's center.

## Changes

### 1. `src/templating/anchor.js`
- Updated `resolveAnchorPoint` to accept an optional `anchorEdge` key.
- If `anchorEdge` is provided, it uses the `ANCHOR_ALIGN` vocabulary to pick a point on the target asset's resolved box.
- Defaults to `"center"` to maintain backward compatibility.

### 2. `src/pipelines/pipeline2-resolve/resolveRefs.js`
- Updated `resolveOneRef` connector logic (handling `fromAssetId` and `toAssetId`).
- It now passes `fromEdge`, `toEdge`, and their corresponding offset percentages from the asset's content to the endpoint resolver.

### 3. `studio/assets/WavyLine/manifest.json`
- Updated `contentOverrideSchema` to include:
    - `fromEdge`, `fromOffsetXPercent`, `fromOffsetYPercent`
    - `toEdge`, `toOffsetXPercent`, `toOffsetYPercent`
- Updated the `points` array schema to include `anchorEdge` for items using `followAssetId`.

## Impact
Assets that "follow" other assets (like WavyLine connectors or camera anchors) can now originate or terminate at specific edges (e.g., "bottom", "top-left") of the target asset's bounding box.