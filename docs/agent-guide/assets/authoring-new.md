# Authoring a new asset

Add a new visual primitive when no shipped asset fits. The framework has
no switch statements — the asset registry scans `src/assets/` at
resolve-time. A new asset is just a new folder.

Source: `src/registry/assetRegistry.js` (`scanFolder`)
        `src/registry/styleRegistry.js` (`resolveAssetStyle`)

## Required files

```
src/assets/<AssetName>/
  manifest.json     # contract: schemas + defaults
  <AssetName>.jsx   # the Remotion component
```

Folder name = the `assetType` string used in scene files. They must match
(the registry keys by folder name).

## manifest.json shape

```json
{
  "assetType": "ImageReveal",
  "component": "ImageReveal.jsx",
  "description": "An image that reveals with a clip-path wipe and settles with a slight scale-in.",
  "defaultSize": { "width": 640, "height": 640 },
  "defaultStyle": {
    "borderRadius": 24,
    "easing": "gentleSpring",
    "revealDirection": "left-to-right"
  },
  "contentOverrideSchema": { "type": "object", "required": ["src"], "properties": { ... } },
  "styleOverrideSchema":   { "type": "object", "properties": { ... } }
}
```

| key | required | notes |
|---|---|---|
| `assetType` | required | Must equal the folder name. |
| `component` | required | Filename of the `.jsx` in this folder. |
| `description` | recommended | One line. Surfaces in tooling/diagnostics. |
| `defaultSize` | required | `{ width, height }` px. The box the anchor resolver centers. |
| `defaultStyle` | optional | Object. Merged under any `styleOverride` from the scene. Any string field whose key contains "color" → resolved as color token; `typography` → typography token; `easing` → easing token. |
| `contentOverrideSchema` | optional | Ajv JSON schema. Validates the scene's `contentOverride` for this asset. |
| `styleOverrideSchema` | optional | Ajv schema for `styleOverride`. |

## Component contract (`<AssetName>.jsx`)

The component receives exactly what `resolveScene` builds (see
`resolve.js` `resolvedAssets[]`):

```
props = {
  id,
  assetType,
  componentPath,
  content,          // = the scene's contentOverride (or {})
  resolvedPosition, // { position, left, top, transformOrigin }
  resolvedStyle,    // tokens already resolved to concrete values + width/height
  timing: { durationInFrames, enterAtFrame, exitAtFrame }
}
```

The component owns its own entrance / idle / exit animation keyed off
`timing.enterAtFrame` / `timing.exitAtFrame` inside Remotion's
`useCurrentFrame()` for the scene. It should use `resolvedStyle` for all
visual values (tokens are already resolved — never re-resolve). Position
comes from `resolvedPosition` — apply it directly as the wrapping div's
style.

## Default style → token resolution

`defaultStyle` values may be token strings (e.g. `"easing":
"gentleSpring"`). `resolveAssetStyle` will resolve them against
`styles/theme.json` at resolve time. So you can (and should) express
defaults in tokens where a token exists — the asset stays coherent with
the project's style registry without the scene having to pass anything.

## After authoring

1. Run `node src/pipelines/pipeline1-validate/validate.js <manifest>` —
   the asset is picked up automatically; no registration code to edit.
2. Add a row to `using-assets.md`'s shipped-assets table.
3. If the asset needs richer usage notes, add `<AssetName>.md` in this
   folder and link it from `using-assets.md`.
