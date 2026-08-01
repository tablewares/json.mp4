# styles/theme.json — the style registry

Global token registry. Every visual value in every scene can be either a
token defined here (the default path) or a literal override (rare,
one-off). Keeping most values as tokens is what keeps a whole video
visually coherent — change `shade1` here, every scene using it updates.

Source: `src/registry/styleRegistry.js`
        `src/pipelines/pipeline1-validate/validate.js` (loads via manifest.styles)

## Shape

```json
{
  "colors": { "shade1": "#0B0E14", "main1": "#F5F7FA", "accentBg": "#3D7BFD", "transparent": "#00000000" },
  "typography": {
    "heading1": { "fontFamily": "Inter, sans-serif", "fontSize": 72, "fontWeight": 700, "lineHeight": 1.1, "colorToken": "main1" }
  },
  "spacing": { "sceneMargin": 96, "gutter": 32 },
  "easing":  { "gentleSpring": { "damping": 16, "mass": 0.7, "stiffness": 110 } }
}
```

## Keys

| section | required | value type | resolved by |
|---|---|---|---|
| `colors` | required | `{ token: "#RRGGBB" \| "rgba(...)" }` | `resolveColorToken` |
| `typography` | optional | `{ token: { fontFamily, fontSize, fontWeight, lineHeight, colorToken } }` | `resolveTypographyToken` |
| `spacing` | optional | `{ token: number }` | pass-through (not auto-resolved) |
| `easing` | optional | `{ token: { damping, mass, stiffness } }` | `resolveEasingToken` |

## Resolution rules (styleRegistry.js)

- **Color**: a string value anywhere a color is expected is treated as a
  token and looked up in `colors`. ⛔ Unknown token →
  `Unknown color token "..." Known tokens: ...`. If you need an ad-hoc
  color, pass it as a literal object/string at the override site, not here.
- **Typography**: each entry's `colorToken` (if present) is itself looked
  up in `colors` and replaced with the real color string at resolve time.
  ⛔ Unknown typography token → lists known tokens.
- **Easing**: token names referenced by asset `styleOverride.easing` are
  resolved here. ⛔ Unknown easing token → throw.
- **Asset style merge**: `resolveAssetStyle` does
  `{...assetManifest.defaultStyle, ...styleOverride}`. Any field the
  override doesn't set falls through to the asset's declared default, and
  any string field whose key contains "color" is resolved as a color
  token, "typography" → typography token, "easing" → easing token.

## Adding tokens

Add a key to the relevant section. That's the entire change — any scene
or asset already referencing that token name picks it up. Do not remove a
token while scenes still reference it (resolve will throw listing the
offending scene).
