# scenes/<id>.json

One file per scene. Owns its own assets, optional background, optional
outgoing transition, and an optional `narrationRef` that ties it to a
timing window. The scene file is the unit an agent edits — never edit the
manifest to change scene content.

Source: `src/pipelines/pipeline1-validate/validate.js` (loads + id match)
        `src/pipelines/pipeline2-resolve/resolve.js` (`resolveScene`)
        `src/templating/anchor.js` (resolves each asset's anchor)
        `src/registry/styleRegistry.js` (resolves `background` + style tokens)

## Shape

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
  "assets": [ /* see asset-spec.md */ ]
}
```

## Keys

| key | required | type | notes |
|---|---|---|---|
| `id` | required | string | ⛔ MUST match the `id` in the `manifest.scenes[]` entry pointing at this file. Enforced in `validateProject`. |
| `narrationRef` | optional | string | If set, must match a `narration.entries[].id`. Drives this scene's duration via TTS. If omitted → `config.defaultSceneDurationInFrames`. |
| `background` | optional | color token \| literal | Resolved by `resolveColorToken`. Unknown token → throw listing known tokens. |
| `assets` | optional | array | Defaults to `[]`. Each entry is an asset spec — see `asset-spec.md`. |
| `transitionOut` | optional | object | Defines the handoff to the *next* scene. See below. If omitted, `default` transition is used. |

## transitionOut shape

```json
{
  "type": "slideContinuity",          // must exist under studio/transitions/
  "durationInFrames": 24,             // optional; falls back to manifest defaultDurationInFrames
  "params": { "carryAssetId": "heroImage" }
}
```

- ⛔ `type` must exist under `studio/transitions/<Name>/`. Unknown type falls
  back to `default` (not an error) unless you intend a specific one —
  check spelling.
- ⛔ If the chosen transition's `manifest.consumes.carriedAssets` is true
  AND you pass `params.carryAssetId`, that asset id must appear in BOTH
  this outgoing scene AND the incoming scene. Missing on either side →
  throw naming the missing side
  (`buildTransitionBundle` in `resolve.js`).
- The resolved transition bundle (with `carryFrom` / `carryTo` pixel
  snapshots) is attached to `outgoing.transitionOut` and the same object
  is also set as `incoming.transitionIn` — so a transition knows both
  sides without re-reading either scene file.

## What the resolved scene looks like

After pipeline 2, this file becomes a resolved scene object (see
`resolveScene` in `resolve.js`):

```json
{
  "id": "scene-001",
  "durationInFrames": 90,
  "background": "#0B0E14",
  "assets": [ /* each asset now has resolvedPosition, resolvedStyle, timing */ ],
  "transitionIn":  null | { type, durationInFrames, componentPath, props },
  "transitionOut": null | { type, durationInFrames, componentPath, props }
}
```

Pipeline 3 only ever sees the resolved form — it never opens this scene
file.
