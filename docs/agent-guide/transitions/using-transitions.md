# Using a shipped transition

Transitions live in `studio/transitions/<Name>/` as a `manifest.json` + a
`<Name>.jsx` component. You reference one from a scene's `transitionOut`
block. Omitting `transitionOut` selects `default`.

## Shipped transitions

| type | folder | one-line | consumes outgoing/incoming styles | carries an asset |
|---|---|---|---|---|
| `default` | `studio/transitions/default/` | Fade + slight slide. Used when no continuity is requested | no | no |
| `shatterWipe` | `studio/transitions/shatterWipe/` | Splits outgoing/incoming into a grid of tiles that fly apart from center (or reassemble inward); `params` `cols`/`rows`/`throwDistance`. Carry-less cut, more polished than `default` | no | no |
| `slideContinuity` | `studio/transitions/slideContinuity/` | Carries a named asset's resolved color + position across the cut so it visually "becomes" the next scene's version of itself | yes / yes | yes (`params.carryAssetId`) |

As new transitions are added, append a row here.

## Authoring from a scene

```json
// scene-001.json
{
  "transitionOut": {
    "type": "slideContinuity",
    "durationInFrames": 24,
    "params": { "carryAssetId": "heroImage" }
  }
}
```

| key | required | notes |
|---|---|---|
| `type` | optional (default `"default"`) | Must match a folder under `studio/transitions/`. Unknown type → falls back to `default` (silent). |
| `durationInFrames` | optional | Falls back to the transition manifest's `defaultDurationInFrames`. |
| `params` | optional | Merge into the transition component's `props`. Asset-specific (see the transition's manifest `params`). |

## The carryAssetId contract

For any transition whose manifest `consumes.carriedAssets` is true:

- ⛔ The id in `params.carryAssetId` must appear in **both** this scene
  (outgoing) and the next scene (incoming). Resolve-time throw names the
  missing side:
  `Transition "..." on scene "..." requested carryAssetId "..." but it wasn't found in both the outgoing and incoming scene.`
- The resolved bundle gets `props.carryFrom` (position+style snapshot from
  the outgoing asset) and `props.carryTo` (same from the incoming asset).
  The transition component morphs one into the other.

## How the bundle is attached

`resolve.js` pass 2 sets `outgoing.transitionOut` and the same object as
`incoming.transitionIn`. So a transition component always has both sides
without re-reading any scene file.
