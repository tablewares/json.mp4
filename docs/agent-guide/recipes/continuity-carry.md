# Recipe: continuity carry across two scenes

Carry the same asset's identity (color + position) across a scene cut so
it visually "becomes" the next scene's version of itself, instead of
cutting and re-entering. This is the difference between "AI slideshow" and
"video".

Uses the `slideContinuity` transition. Adapted from
`src/manifest/example-project/scenes/scene-001.json` → `scene-002.json`.

## The contract

- The outgoing scene's `transitionOut` selects `slideContinuity` and names
  a `carryAssetId`.
- That asset id must exist in BOTH scenes with the same `id`.
- The resolver snapshots the outgoing asset's resolved position+style as
  `carryFrom` and the incoming's as `carryTo`; the transition morphs one
  into the other.

## Outgoing scene (`scene-001.json`)

```json
{
  "id": "scene-001",
  "narrationRef": "n1",
  "background": "shade1",
  "transitionOut": {
    "type": "slideContinuity",
    "durationInFrames": 24,
    "params": { "carryAssetId": "heroImage" }
  },
  "assets": [
    { "id": "titleText", "assetType": "TextBlock", "anchor": { "position": "top-left", "offsetXPercent": 6, "offsetYPercent": 10 }, "contentOverride": { "text": "Why most AI videos look like slideshows" }, "styleOverride": { "typography": "heading1", "align": "left" }, "enterAt": 0, "exitAt": 0.9 },
    { "id": "heroImage", "assetType": "ImageReveal", "anchor": { "position": "right", "offsetXPercent": -8, "offsetYPercent": 0 }, "contentOverride": { "src": "...", "alt": "hero" }, "styleOverride": { "borderRadius": 32, "revealDirection": "left-to-right", "width": 640, "height": 640 }, "enterAt": 0.05, "exitAt": 1 }
  ]
}
```

## Incoming scene (`scene-002.json`)

```json
{
  "id": "scene-002",
  "narrationRef": "n2",
  "background": "shade2",
  "assets": [
    { "id": "heroImage", "assetType": "ImageReveal", "anchor": { "position": "top-left", "offsetXPercent": 8, "offsetYPercent": 12 }, "contentOverride": { "src": "...", "alt": "hero" }, "styleOverride": { "borderRadius": 16, "revealDirection": "left-to-right", "width": 420, "height": 420 }, "enterAt": 0, "exitAt": 1 },
    { "id": "bodyText", "assetType": "TextBlock", "anchor": { "position": "bottom-right", "offsetXPercent": -6, "offsetYPercent": -10 }, "contentOverride": { "text": "Because they resolve every asset independently, with no shared registry and no continuity." }, "styleOverride": { "typography": "body1", "align": "right" }, "enterAt": 0.1, "exitAt": 0.95 }
  ]
}
```

## Why this reads as continuity

- Same `id` (`heroImage`) on both sides → the carried asset.
- Background shifts `shade1` → `shade2` (both tokens from the same
  theme.json), so the mood pivots without a hard cut.
- The image changes size (`640 → 420`) and anchor (`right → top-left`)
  across the cut; the transition interpolates position+style rather than
  re-entering, so the eye tracks the same object into a new layout.

## Gotchas

- ⛔ Omitting `id` on the carried asset on either side will make the
  resolver throw naming the missing side — `carryAssetId` must match a
  real `id` on both scenes.
- You can change *everything else* about the carried asset across the cut
  (size, anchor, style) — the transition handles the morph. You just
  can't change its `id`.
