docs/ are for code in src or assets
scripts/curate is how to make renders and solutions or how to use existing schemas

## Pattern: id / relative / shared timing

Every authorable node in `src/pipelines/pipeline1-validate/schema/` follows
one contract. When adding a new schema field or a new schema file, hold it
to this contract rather than inventing a new shape:

1. **Everything gets a required `id`.** Anything another node might need to
   target — `relativeToAsset`, `anchor.followAssetId`, `transitionOut.params.carryAssetId(s)`,
   physics `towardAssetId`/`targetAssetId`/`carryFromScene.assetId` — must
   be addressable. `scene.assets[].id` is required (not optional) for this
   reason. If you add a new referenceable node type, give it a required
   `id` from the start; retrofitting it later means auditing every existing
   manifest.

2. **Everything can be positioned relative to something else.** The named
   corner + signed % nudge vocabulary (`{ position, offsetXPercent,
   offsetYPercent }`, `ANCHOR_ALIGN` in `src/templating/anchor.js`) is the
   spatial primitive. `followAssetId` (+ `anchorEdge`) swaps the frame
   corner for another earlier-authored asset's box, resolved through the
   one shared `resolveAnchorPoint` (`src/templating/anchor.js`) — both
   camera anchors (`camera.schema.json#/definitions/cameraAnchor`) and
   asset anchors (`scene.schema.json#/definitions/assetSpec.anchor`) use
   this exact function. Don't hand-roll a second "point relative to
   another box" resolver — extend `resolveAnchorPoint`.

3. **Everything that fires at a moment in time uses the same timing
   anchor.** `shared.schema.json#/definitions/timingAnchor` is the single
   vocabulary: `relativeToAsset`, `relativeToCameraAction`,
   `relativeToWord`, `offsetPercent`, `edge`, `offsetFrames`. It's resolved
   by one function, `resolveTimingAnchor` (`src/timing/effectTiming.js`),
   from every consumer site: asset `enterAt`/`exitAt`
   (`resolveScene.js`), scene `effects[].timing` (`resolveTransitions.js`),
   and camera `actions[].at` (`src/templating/camera.js`). The
   newest-authored form is always an EXACT unit first (`frame` on
   `scene.effects[]`, a bare fraction on `camera.actions[].at`), with the
   `timingAnchor` object as the flexible/legacy-compatible fallback — see
   `effects.schema.json`'s `sfxEffect`/`visualEffect` for the reference
   shape (`frame` primary, `timing`/`offsetPercent` deprecated bridge).
   When adding a new timed feature, `$ref` `timingAnchor` rather than
   inventing a new percent/frame field.

Everything can also carry the `"$alias": "category.name"` shorthand
(`shared.schema.json#/definitions/aliasRef`, expanded by
`resolveAliasesDeep` in pipeline2 before validate's shaped schemas would
otherwise reject the loose `$alias` key at the authored-JSON layer — so
aliases only work through the agent CLIs / resolve, never hand-authored
raw into a scene file expecting validate to expand them).

Discovery for all of this is exposed live, not hand-maintained twice:
`scripts/discovery.mjs` reads the asset/transition/alias/theme registries;
`scripts/schema-cli.mjs` reads the schema files directly (dereferenced
`$ref`s, flattened `oneOf`). See `index.html` at the repo root for a
browsable map of both.
