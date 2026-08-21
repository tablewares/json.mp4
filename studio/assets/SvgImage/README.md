# SvgImage

An SVG-based asset that embeds a static SVG image and traces a self-drawing
dashed/dotted boundary around it.

1. Copy this folder to make a variant, or edit in place for one-off tweaks.
2. Point `content.src` at your own SVG under `public/` (default:
   `svg/Bitcoin.svg`).
3. Adjust the default size, default style, and `boundary*` schema fields to
   match your asset.

The component receives:
- `resolvedPosition`: computed layout from anchor + nudge
- `resolvedStyle`: token-resolved style + width/height
- `content`: the resolved content override (`src`)
- `timing`: enter/exit frame window, plus any narration timing data

## SVG root, not a div

The component's root element is an `<svg viewBox="0 0 width height">` sized
from `resolvedStyle.width`/`height`, with `resolvedPosition` spread directly
onto it. The image draws inside via `<image href={staticFile(src)} .../>` —
the same `staticFile()` convention `ImageReveal` uses for its media sources
(paths are relative to `public/`; absolute http(s) URLs pass through).

## Self-traced boundary line (real pixels, not the bounding box)

`useAlphaSilhouette(src, { width, height, inset })` (from
`assets/_shared/boundaryDrawer.jsx`) rasterizes the actual image onto an
offscreen canvas, reads its alpha channel, and traces a closed polygon
around the non-transparent pixels — so a round logo on a transparent square
canvas gets a round boundary, not a square one. That polygon is handed to
`<BoundaryDrawer points={...}>`, which draws it in with the same
stroke-dashoffset technique `WavyLine`/`DrawLine` use for self-drawing
lines, starting a little after the asset's own entrance so the outline
"circles" the image once it has already landed.

Toggle it off with `styleOverride.showBoundary: false`, or tune it via the
`boundary*` style keys documented in `manifest.json`. `boundaryInset` is
baked into the traced silhouette itself (expanding it radially outward from
its centroid) rather than being a flat rect padding.

The boundary is genuinely drawn in over time (a `<mask>` progressively
reveals the dashed stroke — see `assets/_shared/boundaryDrawer.jsx`'s doc
comment for why a plain dash-offset animation on its own doesn't achieve
this), and it starts after a delay from the image's own entrance so the
image visibly lands first and the outline traces in afterward. Tune the
delay with `boundaryDelayFraction` (default 0.15, a fraction of the asset's
active window) or `boundaryDelayFrames` (absolute frames, overrides the
fraction). Set either to `0` for the boundary to start drawing immediately
alongside the image.

Reuse `useAlphaSilhouette` + `BoundaryDrawer` in any other SVG asset that
draws a raster/vector image with real transparency. For assets whose content
is a rectangular panel or text block instead, use the sibling
`useMeasuredBounds` (DOM `getBBox()`) + `BoundaryDrawer bounds={...}` pair
instead — same component, bbox-rect mode.

## Optional SVG shader (tone / blur / tint / glow)

`styleOverride.shader` applies an SVG-native `<filter>` graph (built by
`assets/_shared/svgShader.jsx`'s `SvgShaderFilter`) to the image, plus an
optional glow halo (`SvgGlow`) shaped like the image's own traced alpha
silhouette rather than a rectangular CSS drop-shadow. All fields are
**literal values — raw numbers/hex, never style-registry tokens**:

```json
"styleOverride": {
  "shader": {
    "blur": 0,
    "brightness": 1,
    "contrast": 1,
    "saturate": 1,
    "hueRotateDeg": 0,
    "tintFill": "#D4AF37",
    "tintStrength": 0.35,
    "glowFill": "#FFD166",
    "glowStrength": 12
  }
}
```

Absent/empty `shader` (or every field left at its identity default) is a
strict no-op — `isShaderActive()` returns false and the image renders with
no `filter` attribute at all, byte-identical to before this feature existed.

This is distinct from the repo's existing per-asset `effects[]` array
(`docs/agent-guide/reference/asset-effects.md`, CSS `filter` string on the
wrapper div) — `shader` builds a real SVG filter primitive graph inside the
asset's own `<svg>`, which is what makes the glow able to read the traced
silhouette shape instead of the rectangular image box.

### Presets via the alias system (not hardcoded in the component)

Curated "looks" (gold tint, cold glow, brushed metal, chrome shine, etc.)
are NOT hardcoded into `SvgImage.jsx` or `svgShader.jsx` — they're
registered as `shader.<name>` aliases the same way the repo's existing
`effects.*`/`motion.*` presets are, via `node scripts/cli.js alias create
shader.<name> '<expansion-json>'` (persisted to
`studio/library/aliases/*.json`, loaded automatically by pipeline2 on every
resolve/render). Reference one with a nested `$alias`:

```json
"styleOverride": {
  "align": "center",
  "shader": { "$alias": "shader.goldTint" }
}
```

`resolveAliasesDeep` expands `styleOverride.shader` to the alias's literal
object before the component ever runs — the component itself only ever sees
concrete numbers/hex, never `$alias`. See `node scripts/discovery.mjs
aliases shader` for the live list, or `node scripts/discovery.mjs alias
shader.<name>` for one preset's full expansion.

## Metallic texture and shine (not just glow)

Two distinct, additive fields cover "make it look like metal" — glow alone
(a soft blurred halo) doesn't read as a metal surface, so these are separate
primitives an author combines as needed:

- **`metallicStrength`** (+ `metallicLightFill`, `metallicSurfaceScale`,
  `metallicSpecularConstant`, `metallicAzimuth`, `metallicElevation`,
  `metallicFrequency`) — a STATIC brushed-metal/foil texture baked into the
  same `<filter>` graph as the tone/tint fields: `feTurbulence` generates a
  noise bump map, `feSpecularLighting` (with a directional `feDistantLight`)
  simulates a light source catching that bump map's ridges, masked to the
  image's own alpha so the texture never spills onto the transparent canvas
  around a round logo. Reads the same on every frame — a physical metal
  surface doesn't shimmer on its own either.
- **`shineFill`** (+ `shineWidth`, `shineAngleDeg`, `shineOpacity`,
  `shineLoop`, `shinePeriodFrames`) — an ANIMATED diagonal highlight band
  that sweeps across the image's traced silhouette, the classic "light
  catching a moving reflective surface" shimmer (coin/foil/chrome). Timed to
  the asset's own active window by default (one pass); set `shineLoop: true`
  for a persistent ambient shimmer instead. Rendered as a separate layer
  (`SvgShineSweep`) painted over the image, NOT part of the static filter
  graph — SVG `<filter>` primitives can't read Remotion's frame clock, so
  the moving band is a clipped/masked gradient `<rect>` instead.

Combine both for a full "shiny coin" look:

```json
"styleOverride": {
  "shader": {
    "metallicStrength": 0.6,
    "metallicSurfaceScale": 3,
    "shineFill": "#FFFFFF",
    "shineWidth": 50,
    "shineOpacity": 0.6
  }
}
```

or reach for the curated `shader.brushedMetal` / `shader.chromeShine`
presets below instead of hand-tuning the raw fields.
