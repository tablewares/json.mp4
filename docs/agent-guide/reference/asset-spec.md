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
| `assetType` | required | string | ⛔ Must match a folder name under `src/assets/`. Unknown → throw listing available types (`getAsset`). |
| `anchor` | required | object | See below. ⛔ `position` must be one of the 9 valid anchors. |
| `contentOverride` | optional | object | Shape = the asset's `manifest.contentOverrideSchema`. ⛔ Missing a `required` field from that schema → validate throw. |
| `styleOverride` | optional | object | Shape = the asset's `manifest.styleOverrideSchema`. Unknown fields silently ignored; missing fields fall back to manifest `defaultStyle`. |
| `enterAt` | optional | float `[0,1]` | Fraction of scene duration when the asset enters. Default `0`. |
| `exitAt` | optional | float `[0,1]` | Fraction of scene duration when the asset exits. Default `1`. |

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

## enterAt/exitAt are fractions, not frames

These are multiplied by the scene's resolved `durationInFrames`. A value
of `0.9` = "leave 10% of the scene as tail". The resolver produces
`enterAtFrame` and `exitAtFrame` in absolute frames for the renderer. If a
scene has no narration, `durationInFrames` is
`config.defaultSceneDurationInFrames`.

## Width / height

If `styleOverride.width`/`height` are set, they override the asset
manifest's `defaultSize`. The resolved size is what `resolveAnchor` uses
to center the box on the anchor — so changing size shifts position
predictably, never breaks the anchor contract.
