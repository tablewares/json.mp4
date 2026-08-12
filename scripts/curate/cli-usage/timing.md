# Timing anchors

A `timingAnchor` (`shared.schema.json`) pins the start frame of a transition
boundary effect or camera event to a meaningful point on the timeline. Three
selector keys, checked in a fixed precedence by `resolveTimingAnchor`
(`src/timing/effectTiming.js`); `offsetFrames` refines the asset- and
camera-relative selectors.

Used by:
- `transition.schema.json` effect items — each `effects[]` entry accepts an
  optional `timing` of this shape (see `build.md` / `transitions.md`).
- `camera.schema.json` `cameraAction.at` is a simpler fraction form, but the
  `relativeToCameraAction` selector on a *timing anchor* is the way an effect
  keys itself to a camera keypoint.

## Shape

```json
{
  "offsetPercent":           -10,
  "relativeToAsset":         "hero",
  "relativeToCameraAction":  2,
  "edge":                    "enter",
  "offsetFrames":            6
}
```

- `offsetPercent` (number, optional / **legacy**): percent of scene duration
  measured from the scene's **end** frame, not from frame 0. The legacy
  formula is `sceneDuration * (1 + offsetPercent/100)`:
  - `0` lands on the scene's resolved **end** frame.
  - `-100` lands on the scene's **start** frame (the convention `inject-effects`
    uses for `anchor:"enter"`).
  - `+50` lands at 150% of scene duration, **clamped** to the scene's end
    frame.
  - `-10` lands at 90% of the scene's length (10% before the end).
  This is the pre-existing shape, preserved byte-for-byte for every shipped
  manifest.
- `relativeToAsset` (string, optional): the id of an asset in this scene.
  Anchor lands at that asset's `enterAt` or `exitAt` frame (selected by
  `edge`), plus `offsetFrames`.
- `relativeToCameraAction` (number | string, optional): a keypoint on the
  scene's resolved camera. Number = index into the sorted `actions[]` array
  (0-based); string = the action's `id` (`cameraAction.id`). Lands at that
  action's `at * motionDuration` frame, plus `offsetFrames`. `motionDuration`
  is `camera.durationInFrames` (or `sceneDuration / camera.speed` when
  unset).
- `edge` (string, optional): enum `enter | exit`. For `relativeToAsset`,
  picks the asset's enter (`enterAt`) or exit (`exitAt`) frame. Default
  `"enter"`. No effect on the other selectors.
- `offsetFrames` (number, optional): a signed frame nudge, added to whatever
  the asset- or camera-relative selector picked. Default 0. **Does not apply
  to the legacy `offsetPercent` path** — use `offsetPercent` itself to nudge
  that one.

## Resolution precedence

`resolveTimingAnchor(anchor, ctx)` checks in this order and returns on the
first match — not "exactly one of":

1. Bare number → treated as `offsetPercent` (legacy shorthand).
2. `relativeToAsset` is set → `resolveAssetRelative`: look up the asset in
   `resolvedAssetsById`, read `enterAtFrame`/`exitAtFrame` per `edge`, add
   `offsetFrames`, clamp to `[0, sceneDuration]`.
3. `relativeToCameraAction` is set → `resolveCameraRelative`: find the
   action by numeric index or string id, compute `match.at * motionDuration`,
   add `offsetFrames`, clamp.
4. Else → `resolveEffectFrame(offsetPercent ?? 0, sceneDuration)` (legacy
   percent-of-scene-end).

The schema doesn't enforce mutual exclusion — `additionalProperties:false`
is off so any combination validates — but only the first-present selector
applies. Pass only the one you mean.

## Where `timing` sits on an effect

A transition boundary effect carries an optional `timing` object. The
resolver in `resolveTransitions.js` reads `effect.timing ?? effect` — i.e.
the structured `timing` object is preferred, and when absent the effect's
own top-level `offsetPercent` / `relativeToAsset` / `relativeToCameraAction`
are read as the anchor directly (legacy co-location). So authoring
`timing` is the structured way; top-level fields are the legacy way; the two
shouldn't be mixed on one effect.

## CLI usage

`timing` lives inside an effect item, not at the top level. Author it on a
boundary effect via `add-effect`:

```bash
# SFX at 3 frames after the hero asset enters
node scripts/agent-cli.mjs add-effect <projectId> <sceneId> '{
  "id": "hit",
  "kind": "sfx",
  "path": "audio/hit.mp3",
  "volume": 0.6,
  "timing": { "relativeToAsset": "hero", "edge": "enter", "offsetFrames": 3 }
}'

# visual effect that lands at the camera's 2nd keypoint (index 1)
node scripts/agent-cli.mjs add-effect <projectId> <sceneId> '{
  "id": "flash",
  "kind": "visual",
  "assetType": "TextHighlight",
  "anchor": { "position": "center" },
  "contentOverride": { "text": "" },
  "timing": { "relativeToCameraAction": 1 }
}'

# legacy: SFX at 90% of scene length (10% before the end frame)
node scripts/agent-cli.mjs add-effect <projectId> <sceneId> '{
  "id": "outro", "kind": "sfx", "path": "audio/outro.mp3",
  "timing": { "offsetPercent": -10 }
}'
```

For the simple case (an effect at the start or end of every scene),
`inject-effects` with `anchor:"enter"`/`"exit"` is shorthand — it writes
`offsetPercent:-100` (start frame) or `0` (end frame) for you (see
`build.md`).

## Common pitfalls

- **`offsetPercent` is percent-of-scene-END, not of scene duration from 0.**
  `0` is the last visible frame, `-100` is the first. The `inject-effects`
  convention (`-100` for enter, `0` for exit) only makes sense in this axis.
  For "50% of the scene" use `relativeToAsset` with a known asset, or
  compute the frame in head and reach for `offsetPercent:-50` (half a scene
  before the end).
- **`relativeToCameraAction` is the resolved `actions[]` index, not the
  authored one.** Camera actions are sorted by `at` on resolve, so index 0
  is always the earliest `at`, regardless of array order in the manifest. If
  you set `id` on the action, reference by string id — stable across
  reorderings.
- **`edge` only affects `relativeToAsset`.** Setting `edge:"exit"` with
  `offsetPercent` does nothing; use `offsetPercent` to land at the end frame
  directly (it already lands there by default with `0`).
- **`offsetFrames` doesn't refine `offsetPercent`.** It only nudges the
  asset- and camera-relative selectors. For the legacy path, nudge by
  adjusting `offsetPercent` itself.
- **An effect's own top-level `offsetPercent` is the legacy co-location.**
  When `effect.timing` is absent, the whole effect is read as the anchor
  (so a top-level `relativeToAsset` works too). Don't mix — author `timing`
  on any new effect.
