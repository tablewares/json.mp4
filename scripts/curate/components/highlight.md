# Highlighter

A neon marker stroke sweeping across rendered text, like a highlighter dragged
across the label. Two surfaces in this repo:

1. **`TextHighlight` asset** — standalone marker over a label it renders itself.
2. **`highlighter` style key on `KineticText`** — inline marker sweeping that asset's own glyphs in step with its active window.

Both share the same core behavior: a colored band animates left-to-right (or
right-to-left with `direction: "left"`) over the text, or a thin underline when
`mode`/`underline` is set. Field shapes differ between the two — see each
section below.

No dedicated CLI command — `highlighter` is a `styleOverride` field (KineticText)
and TextHighlight is set via its own `styleOverride` fields. Pass them inside
`add-asset` or `update-asset` JSON.

## TextHighlight (standalone)

Useful for the vox-style callout: drop on top of an already-rendered text asset
(anchors and timing intentionally overlap — set the marker's `enterAt` a touch
later than the text asset's so the marker sweeps once the text is settled).

Schema source: `node scripts/agent-cli.mjs asset TextHighlight`.

```bash
node scripts/agent-cli.mjs add-asset <projectId> <sceneId> '{
  "assetType": "TextHighlight",
  "contentOverride": { "text": "<label-the-marker-sweeps-across>" },
  "anchor": { "position": "<one-of-9-anchors>" },
  "enterAt": <number-0..1>,
  "exitAt": <number-0..1>,
  "styleOverride": {
    "markerColorToken": "<color-token>",
    "markerHeight":     <number-px>,
    "markerOpacity":    <number-0..1>,
    "markerBlur":       <number-px>,
    "direction":        "<left|right|top|bottom>",
    "underline":        <boolean>,
    "easing":           "<easing-token>",
    "typography":       "<typography-token>"
  }
}'
```

Field ranges (verbatim from the CLI schema):
- `markerHeight`: any positive number (px).
- `markerOpacity`: `[0, 1]`. 0 = invisible, 1 = fully opaque.
- `markerBlur`: any non-negative number (px gaussian blur on the band).
- `direction`: enum `left` | `right` | `top` | `bottom`. `right` is the classic left-to-right sweep.
- `underline`: boolean — renders a thin underline instead of a filled band.
- `markerColorToken` / `typography` are theme tokens, not raw hex; don't pass `#RRGGBB` literals to these fields.

Patch the sweep without re-creating the asset:

```bash
node scripts/agent-cli.mjs update-asset <projectId> <sceneId> <assetId> '{
  "styleOverride": { "markerColorToken": "<color-token>", "direction": "left" } }'
```

## Inline highlighter on KineticText

The KineticText asset accepts an optional `highlighter` object under
`styleOverride` — inline marker sweeping its own glyphs in step with its active
window. Same effect as the standalone asset with one fewer asset to author.

The inline variant exposes a richer keyset than the standalone — angle the
schema like sound below (`node scripts/agent-cli.mjs asset KineticText`
also echoes the block).

```bash
node scripts/agent-cli.mjs add-asset <projectId> <sceneId> '{
  "assetType": "KineticText",
  "contentOverride": { "text": "<text>" },
  "styleOverride": {
    "highlighter": {
      "enabled":               <boolean>,
      "color":                 "<raw-hex-#RRGGBB-or-token>",
      "colorToken":            "<color-token>",
      "mode":                  "<band|underline>",
      "height":                <number-px>,
      "barThickness":          <number-px>,
      "opacity":               <number-0..1>,
      "blur":                  <number-px>,
      "direction":             "<left|right>",
      "sweepStartFraction":    <number-0..1>,
      "sweepDurationFraction": <number-0.01..1>
    }
  }
}'
```

Set `highlighter: null` (or omit) to render without a marker.

Key field ranges (verbatim from the KineticText manifest):
- `enabled`: boolean. **Required to activate** — the block alone does nothing; must be `true` to draw.
- `color`: raw hex `#RRGGBB` (resolved via the color-token resolver, so a theme token also accepted).
- `colorToken`: explicit theme color token name; takes precedence over `color` when both set.
- `mode`: enum `band` (filled marker over text) | `underline` (thin stroke beneath text). Note: `underline` is a *mode value* here, not a boolean like on the standalone asset.
- `height`: band height in px (band mode only). Omit to auto-fit each band to its wrapped line's measured glyph height. Default: auto.
- `barThickness`: underline thickness in px (underline mode only). Default 4.
- `opacity`: `[0, 1]`, multiplied by the host asset's enter/exit envelope. Default 0.75.
- `blur`: gaussian blur in px on the band (band mode only). Default 4.
- `direction`: enum `left` | `right`. **Inline variant does not support `top` / `bottom`.** Default `right`.
- `sweepStartFraction`: `[0, 1]` — where in the active window the sweep begins, as a fraction. Default 0.
- `sweepDurationFraction`: `[0.01, 1]` — sweep length as a fraction of the active window. Default 0.7. Lower = sharper swipe, higher = slower sweep.

## Common pitfalls

- On the standalone `TextHighlight` asset, `content.text` is required — the asset renders that text behind the marker so the highlight sits over real type. For a marker over a *different* asset's rendered text, don't duplicate the text string here; overlap the `TextHighlight` asset onto the text asset via `anchor` + a slightly later `enterAt`.
- `direction` on the inline `highlighter` only accepts `left` / `right` (no top/bottom on the inline variant). The standalone asset supports all four.
- `highlighter` on KineticText is `object | null` in schema — `enabled` must be `true` for any of the other keys to take effect. A bare `{ }` or one without `enabled: true` does not activate the sweep.
- Underline is a *mode value* on the inline variant (`mode: "underline"`) but a *boolean* on the standalone asset (`underline: true`). Don't mix the two conventions.
- Color keys: standalone uses `markerColorToken` (token only); inline uses `color` (raw hex or token) and/or `colorToken` (token only, wins on conflict). Run `asset TextHighlight` / `asset KineticText` for the exact field names before authoring.
