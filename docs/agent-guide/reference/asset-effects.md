# asset effects — the `effects[]` array on a scene asset

Per-asset visual effects (CSS filters + grain/scanline overlays) scoped to
ONE asset's own bounding box. Distinct from the other two effect surfaces
in the framework:

- **post-effects** (`postEffects.js`, pipeline 3) — a composition-wide ffmpeg
  pass applied to the entire frame after Remotion renders. No per-asset
  scoping.
- **scene effects** (`scene.transitionOut.effects[]`) — freestanding assets
  positioned by anchor at a timing frame. *Not* bound to an existing asset's
  box; rendered by `SceneEffectLayer` at their own resolved position.

Asset effects attach to an asset via the `effects` key on that asset's entry
in `scene.assets[]` and are clipped to that asset's resolved `left/top/width/
height` box — grain, scanlines or a CSS filter on one image never bleed onto
a neighboring text block.

Source: `src/effects/assetEffects.js` (resolve + render math)
        `src/pipelines/pipeline2-resolve/resolveScene.js` (wires `resolvedEffects`)
        `src/pipelines/pipeline3-render/Composition.jsx` (`AssetEffectOverlay`)
        `src/pipelines/pipeline1-validate/schema/scene.schema.json` (`assetEffect` def)
        `src/agent/validators.js` (`checkAssetEffects`)

## Strict no-op when absent

An asset with no `effects` key → `resolveAssetEffects` returns `null` →
`computeAssetEffectStyle(null)` returns
`{ filter: undefined, overlays: [] }`. The render path sets `filter:
undefined` and `overflow: undefined`, producing byte-identical output to a
pre-effects manifest. You never need to opt out or set a flag.

## Shape

```json
{
  "assetType": "ImageReveal",
  "anchor": { ... },
  "contentOverride": { "src": "assets/terminal.png" },
  "effects": [
    { "type": "filter", "grayscale": 0.85, "contrast": 1.15, "brightness": 0.85, "sepia": 0.15 },
    { "type": "grain", "intensity": 0.45, "monochrome": true },
    { "type": "scanlines", "opacity": 0.2, "lineHeight": 2 }
  ]
}
```

Entries are applied in order: the `filter` entry becomes the CSS `filter`
string on the asset's wrapper; `grain` and `scanlines` entries become
absolutely-positioned overlay children painted inside that same wrapper (so
they inherit the `overflow: hidden` clip).

## Effect types

### `filter`

| key | type | range | default | notes |
|---|---|---|---|---|
| `type` | string | `"filter"` | — | ⛔ required |
| `grayscale` | number | 0–1 | `0` | CSS `grayscale()` |
| `contrast` | number | ≥ 0 | `1` (no-op) | CSS `contrast()`; `1` omitted from the string |
| `brightness` | number | ≥ 0 | `1` (no-op) | CSS `brightness()`; `1` omitted |
| `sepia` | number | 0–1 | `0` | CSS `sepia()` |
| `blur` | number | ≥ 0 | `0` | CSS `blur(Npx)` |

Only one `filter` entry is meaningful — `buildCssFilter` picks the *first*
`type: "filter"` entry and ignores any later ones. The emitted string is the
space-joined CSS functions, e.g.
`"grayscale(0.85) sepia(0.15) contrast(1.15) brightness(0.85)"`. Omitted /
default values are dropped from the string.

### `grain`

| key | type | range | default | notes |
|---|---|---|---|---|
| `type` | string | `"grain"` | — | ⛔ required |
| `intensity` | number | 0–1 | `0.35` | opacity of the grain overlay (`mixBlendMode: overlay`) |
| `monochrome` | boolean | — | `true` | when true, an `<feColorMatrix saturate="0">` strips color from the turbulence |

Rendered as an inline SVG: an
`<feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2">`
fed through an optional saturate-0 matrix then painted over a full-bleed
`<rect>`. The overlay is absolutely positioned at `inset: 0` inside the
asset's wrapper, so it's clipped to the asset's box (because the wrapper
gets `overflow: hidden` when any overlay is present).

### `scanlines`

| key | type | range | default | notes |
|---|---|---|---|---|
| `type` | string | `"scanlines"` | — | ⛔ required |
| `opacity` | number | 0–1 | `0.25` | opacity of the scanline div |
| `lineHeight` | number | ≥ 1 | `2` | pixel pitch of the repeating gradient |

Rendered as an absolutely-positioned `<div>` with a
`repeating-linear-gradient` (1px dark line, then `lineHeight`px gap). The
gradient repeats vertically across the asset's full height.

## Defaults summary

| effect | key | default |
|---|---|---|
| `filter` | `grayscale` | `0` |
| `filter` | `contrast` | `1` |
| `filter` | `brightness` | `1` |
| `filter` | `sepia` | `0` |
| `filter` | `blur` | `0` |
| `grain` | `intensity` | `0.35` |
| `grain` | `monochrome` | `true` |
| `scanlines` | `opacity` | `0.25` |
| `scanlines` | `lineHeight` | `2` |


## Validation

`checkAssetEffects` in `src/agent/validators.js` calls
`resolveAssetEffects` on the `effects` array and returns any thrown error
message as a warning (not a hard throw — it's surfaced via the
`ProjectBuilder.addAsset`/`updateAsset` `warnings` array). Throws come
from:

- ⛔ `asset.effects[i] must be an object` — a non-object entry.
- ⛔ `Unknown asset effect type "X" at effects[i]. Available: grain, scanlines, filter` — a `type` value outside the known set.

The Ajv schema (`scene.schema.json`'s `assetEffect` definition) is
`additionalProperties: false` and `required: ["type"]`, so unknown keys or
a missing `type` are rejected at validate time too.

## What the resolved field looks like

`resolveAssetEffects` returns an array of normalized descriptors (or
`null` when no `effects` key was authored):

```json
[
  { "type": "filter", "grayscale": 0.85, "contrast": 1.15, "brightness": 0.85, "sepia": 0.15, "blur": 0 },
  { "type": "grain", "intensity": 0.45, "monochrome": true },
  { "type": "scanlines", "opacity": 0.2, "lineHeight": 2 }
]
```

This attaches as `resolvedEffects` alongside `resolvedMotion` on each
resolved asset (`src/pipelines/pipeline2-resolve/resolveScene.js`). Pipeline
3 (`Composition.jsx`) reads `resolvedEffects` via
`computeAssetEffectStyle()` to produce:

```json
{
  "filter": "grayscale(0.85) sepia(0.15) contrast(1.15) brightness(0.85)",
  "overlays": [
    { "type": "grain", "intensity": 0.45, "monochrome": true },
    { "type": "scanlines", "opacity": 0.2, "lineHeight": 2 }
  ]
}
```

`filter` is applied as the CSS `filter` on the asset's wrapper `<div>`.
`overlays` are painted as children of that same wrapper via
`AssetEffectOverlay` — each overlay inherits the wrapper's
`overflow: hidden`, keeping the effect clipped to the asset's box.
