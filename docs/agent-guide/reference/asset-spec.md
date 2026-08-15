# Asset spec — one entry inside scene.assets[]

Documents the shape of a single asset as authored in a scene file. This is
distinct from `../assets/` (authoring a new asset *component* + manifest).

Source: `src/pipelines/pipeline2-resolve/resolve.js` (`resolveScene`)
        `src/templating/anchor.js` (anchor resolution)
        `src/registry/styleRegistry.js` (styleOverride resolution)
        `src/registry/assetRegistry.js` (assetType lookup + manifest)

## Shape

```json
{
  "id": "titleText",
  "assetType": "TextBlock",
  "anchor": { "position": "top-left", "offsetXPercent": 6, "offsetYPercent": 10 },
  "contentOverride": { "text": "..." },
  "styleOverride":   { "typography": "heading1", "align": "left" },
  "enterAt": 0,
  "exitAt":  0.9
}
```

## Keys

| key | required | type | notes |
|---|---|---|---|
| `id` | optional | string | Stable per scene. Used by transitions' `carryAssetId`. If omitted, a random `assetType-xxxxxx` id is generated — fine for non-carried assets, **never omit for an asset you intend to carry across a cut**. |
| `assetType` | required | string | ⛔ Must match a folder name under `studio/assets/` or `studio/graphics/`. Unknown → throw listing available types (`getAsset`). |
| `anchor` | required | object | See below. ⛔ `position` must be one of the 9 valid anchors. |
| `contentOverride` | optional | object | Shape = the asset's `manifest.contentOverrideSchema`. ⛔ Missing a `required` field from that schema → validate throw. |
| `styleOverride` | optional | object | Shape = the asset's `manifest.styleOverrideSchema`. Unknown fields silently ignored; missing fields fall back to manifest `defaultStyle`. |
| `enterAt` | optional | float `[0,1]` **or** timing-anchor object | Fraction of scene duration when the asset enters. Default `0`. Also accepts the timing-anchor object shape (see below). |
| `exitAt` | optional | float `[0,1]` **or** timing-anchor object | Fraction of scene duration when the asset exits. Default `1`. Also accepts the timing-anchor object shape (see below). |
| `effects` | optional | array | Per-asset visual effects (filter / grain / scanlines), scoped to this asset's box. See `asset-effects.md`. Defaults to absent (no-op). |

## anchor shape

```json
{ "position": "top-left", "offsetXPercent": 6, "offsetYPercent": 10 }
```

- `position` — required. One of: `center | top | bottom | left | right |
  top-left | top-right | bottom-left | bottom-right`.
  ⛔ Unknown → `resolveAnchor` throw listing valid positions.
- `offsetXPercent` — optional, default `0`. Signed. Percent of
  **composition width** (not asset width) to nudge from the anchor point.
- `offsetYPercent` — optional, default `0`. Signed. Percent of
  **composition height**.

Resolution pulls the asset's declared box back so the *anchor point* (not
its top-left corner) lands where requested. Result is
`{ position: 'absolute', left, top, transformOrigin }`. You never see or
author pixels.

## contentOverride vs styleOverride (the rule)

- `contentOverride` = what the asset shows (text string, image src, alt).
  Validated against the asset manifest's `contentOverrideSchema`.
- `styleOverride`  = how the asset looks (color, radius, easing,
  typography, align, width, height). Validated against
  `styleOverrideSchema`. Tokens are resolved against `styles/theme.json`.

If you're unsure which section a key belongs to, open the asset's
`manifest.json` — the two schemas are side-by-side and named explicitly.

## enterAt/exitAt — fractions or timing anchors

### Legacy: fractions (0–1)

A bare number is multiplied by the scene's resolved `durationInFrames`. A
value of `0.9` = "leave 10% of the scene as tail". The resolver produces
`enterAtFrame` and `exitAtFrame` in absolute frames for the renderer. If a
scene has no narration, `durationInFrames` is
`config.defaultSceneDurationInFrames`.

### Timing-anchor objects — fire relative to another asset or camera action

`enterAt`/`exitAt` also accept the same timing-anchor shape
`transitionOut.effects` uses (`shared.schema.json#/definitions/timingAnchor`),
resolved via `src/timing/effectTiming.js` (`resolveTimingAnchor`). One of
three keys discriminates the shape:

```json
"enterAt": { "relativeToAsset": "heroImage", "edge": "exit", "offsetFrames": -6 }
"enterAt": { "relativeToCameraAction": 0, "offsetFrames": 12 }
"enterAt": { "offsetPercent": -10 }
```

| key | type | notes |
|---|---|---|
| `relativeToAsset` | string (asset id) | Fire relative to an earlier asset's `enterAtFrame` (`edge: "enter"`, the default) or `exitAtFrame` (`edge: "exit"`). The target asset **must be authored earlier** in `scene.assets[]` — the resolver builds an incrementally-populated `resolvedAssetsById` map during pass 1. ⛔ Unknown id → throw listing known assets and the ordering rule. |
| `edge` | `"enter"` \| `"exit"` | Default `"enter"`. Which edge of the target asset to anchor to. |
| `relativeToCameraAction` | number (index) or string (action id) | Fire relative to a camera action's resolved frame. The scene must have `camera.actions` authored. ⛔ Unknown index → throw listing available indices. |
| `offsetFrames` | number | Signed frame offset from the resolved anchor point. Default `0`. |
| `offsetPercent` | number | Legacy form. Percent of the scene's resolved end: `0` = last frame, `-10` = 90% of the scene. For legacy effect-frame callers; assets typically use the fraction form above or the relative forms, not `offsetPercent`. |

Camera-relative anchors compute the action's frame as
`round(action.at * (motionDuration - 1))` where `motionDuration` is
`camera.durationInFrames ?? sceneDuration / camera.speed`. The result is
always clamped to `[0, sceneDurationInFrames]`.

Same ordering rule as `checkAssetRefs` and `resolveSceneRefs`: a referencing
asset must appear AFTER its target in `scene.assets[]`. Both forms
(fraction and object) are strictly backward-compatible — a bare number is
byte-identical to the previous behavior.

## Width / height

If `styleOverride.width`/`height` are set, they override the asset
manifest's `defaultSize`. The resolved size is what `resolveAnchor` uses
to center the box on the anchor — so changing size shifts position
predictably, never breaks the anchor contract.
