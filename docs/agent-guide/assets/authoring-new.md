# Authoring a new asset

Add a new visual primitive when no shipped asset fits. The framework has
no switch statements — the asset registry scans `studio/assets/` (and
`studio/graphics/`) at resolve-time. A new asset is just a new folder.

Source: `src/registry/assetRegistry.js` (`scanFolder`)
        `src/registry/styleRegistry.js` (`resolveAssetStyle`)

## Required files

```
studio/assets/<AssetName>/
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

## Multiple asset roots

The framework scans one or more *asset roots*, not just `studio/assets/`.
Every asset root has the same shape — a directory whose immediate
subfolders are `<AssetName>/manifest.json + <AssetName>.jsx` pairs — and
the registries on both sides of the render pipeline (Node-side resolve and
webpack-side render) union every root into one lookup keyed by folder
name.

Defaults: asset roots = `["studio/assets", "studio/graphics"]`,
transition roots = `["studio/transitions"]`. A folder name (the
`assetType` / `transitionType` string scenes reference) **must be unique
across every root** — a duplicate throws at load (`Duplicate assetType
"..."` from `assetRegistry.js`, `Duplicate assetType "..."` / `Duplicate
transitionType "..."` from `Composition.jsx`). The error names the
colliding type so the offending folder is easy to find.

### Adding a new asset root

Both registries must learn the new root or resolve and render disagree.

1. **Node side (pipeline1 + pipeline2)** —
   `src/registry/assetRegistry.js`. Pass the new roots explicitly:

   ```js
   import { loadAssetRegistry, loadTransitionRegistry } from "../../registry/assetRegistry.js";

   // string or array; relative paths resolve against assetRegistry.js
   const assetRegistry = loadAssetRegistry(["../assets", "../custom-assets"]);
   const transitionRegistry = loadTransitionRegistry(["../transitions", "../custom-transitions"]);
   ```

   `DEFAULT_ASSET_ROOTS` / `DEFAULT_TRANSITION_ROOTS` (exported from the
   same module) are the roots used when no argument is passed; edit them
   to change the project-wide default. Callers that already use the
   no-arg form (`loadAssetRegistry()`) pick the new default up
   automatically.

2. **Webpack side (pipeline3)** —
   `src/pipelines/pipeline3-render/Composition.jsx`. Webpack's
   `require.context` needs a literal base directory at compile time, so
   each root gets its own triple in `ASSET_ROOT_CONTEXTS` /
   `TRANSITION_ROOT_CONTEXTS`:

   ```jsx
   const ASSET_ROOT_CONTEXTS = [
     [require.context("../../assets", true, /\/manifest\.json$/),
      require.context("../../assets", true, /\.(jsx|tsx|js|ts)$/), "src/assets"],
     // new root — the two require.context base paths MUST be literal strings:
     [require.context("../../custom-assets", true, /\/manifest\.json$/),
      require.context("../../custom-assets", true, /\.(jsx|tsx|js|ts)$/), "src/custom-assets"],
   ];
   ```

   The label string is the `rootLabel` surfaced in load-time errors. Do
   not parameterize the directory through a variable — webpack must see
   the literal to inline the context module.

### Manifest field contract (both sides read the same fields)

`assetType` / `transitionType` is the registry key (falls back to folder
name if absent). `component` is the entry filename, e.g. `"TextBlock.jsx"`.
Older render code read `manifest.name` / `manifest.main`, which never
existed on the shipped manifests — both registries now read the real
fields and throw at load if `manifest.component` points at a file that
isn't in its root's module context.
