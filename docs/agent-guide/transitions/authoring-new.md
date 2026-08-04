# Authoring a new transition

A transition is a Remotion presentation that runs across a scene boundary.
Add one when the shipped `default` / `slideContinuity` don't express the
handoff you need. Same folder-scan discovery as assets — no registration
code.

Source: `src/registry/assetRegistry.js` (`scanFolder` over `studio/transitions/`)
        `src/pipelines/pipeline2-resolve/resolve.js` (`buildTransitionBundle`)

## Required files

```
studio/transitions/<Name>/
  manifest.json       # contract + what it consumes
  <Name>.jsx          # the Remotion presentation component
```

Folder name = the `type` string used in scene `transitionOut.type`.

## manifest.json shape

```json
{
  "transitionType": "slideContinuity",
  "component": "SlideContinuity.jsx",
  "description": "Carries a named asset's resolved color + position across the cut ...",
  "defaultDurationInFrames": 24,
  "consumes": {
    "outgoingSceneStyles": true,
    "incomingSceneStyles": true,
    "carriedAssets": true
  },
  "params": {
    "carryAssetId": { "type": "string", "description": "asset id (must exist in both outgoing and incoming scene) to morph across the cut" }
  }
}
```

| key | required | notes |
|---|---|---|
| `transitionType` | required | Must equal the folder name. |
| `component` | required | Filename of the `.jsx` in this folder. |
| `description` | recommended | One line. |
| `defaultDurationInFrames` | required | Fallback for `transitionOut.durationInFrames` when the scene omits it. |
| `consumes` | required | Booleans: `outgoingSceneStyles`, `incomingSceneStyles`, `carriedAssets`. Tell the truth — the resolver branches on `carriedAssets`. |
| `params` | optional | Object of `{ name: { type, description } }` documenting the params your component accepts. |

## Component contract (`<Name>.jsx`)

When `consumes.carriedAssets` is true and the scene passes
`params.carryAssetId`, `buildTransitionBundle` snapshots the matching
outgoing + incoming assets and attaches:

```
props = {
  ...transitionOut.params,        // whatever the scene passed
  carryFrom: { ...resolvedPosition, ...resolvedStyle },  // outgoing asset
  carryTo:   { ...resolvedPosition, ...resolvedStyle }   // incoming asset
}
```

Your component morphs `carryFrom` → `carryTo` over
`durationInFrames`. It receives the combined frame window of the cut
(Remotion's transition presentation API) — use `useCurrentFrame()` within
that window.

When `consumes.carriedAssets` is false (e.g. `default`, `shatterWipe`),
the component just gets `...params` and `durationInFrames` — no asset
snapshots. It performs a generic handoff (fade/slide/scatter/etc.).

## After authoring

1. Validate a project that uses the new transition type — the registry
   picks it up automatically.
2. Add a row to `using-transitions.md`'s shipped-transitions table.
3. ⛔ If you set `consumes.carriedAssets: true`, you *must* handle
   `carryFrom`/`carryTo` in the component — the resolver will send them
   and throw if the named asset isn't on both sides.
