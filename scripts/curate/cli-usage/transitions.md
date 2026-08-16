# Transitions

Per-scene transition on the cut between two scenes — authored as
`scene.transitionOut` (the outgoing scene's exit transition); the resolver
mirrors it onto the incoming scene's `transitionIn`. Schema:
`transition.schema.json` (`transitionRef`).

This doc covers the transition contract — `type`, `durationInFrames`,
`params`, and the boundary `effects[]` shape. For multi-asset continuity
and scene-style passthrough (the resolved `carriesFrom`/`carriesTo`/
`outgoingSceneStyles`/`incomingSceneStyles` props), see
`to_be_indexed/style-transition.md`.

## Shape

```json
{
  "type":              "slideContinuity",
  "durationInFrames":  24,
  "params":            { "carryAssetId": "hero" },
  "effects":           []
}
```

- **`type`** (string, required): a transition registry id (see `node
  scripts/agent-cli.mjs transitions`). Defaults to `"default"` if omitted
  (a hard cut).
- **`durationInFrames`** (number, optional): overlap window in frames.
  Defaults to the type's manifest `defaultDurationInFrames`.
- **`params`** (object, optional): free-form bag handed to the transition
  component. Schema is `{"type":"object"}` — unconstrained, so any param
  validates. The transition's `manifest.json` documents which params it
  reads; see `node scripts/agent-cli.mjs transition <Type>` for the per-type
  schema.
- **`effects`** — **REMOVED from `transitionOut`** in the post-refactor
  effects system. Effects are now detached scene-level entries living on
  `scene.effects[]` (`effects.schema.json`), timed by an exact `frame`
  instead of `timingAnchor`/`offsetPercent`. See `build.md`
  (`add-effect`, `inject-effects`) and `docs/transition_effects.md`'s
  post-refactor note for the new shape. The `transitionOut` object now
  owns only `{ type, durationInFrames, params }`.

## Set / patch / clear

```bash
# set scene's outgoing transition from scratch (replaces any existing)
node scripts/agent-cli.mjs set-transition <projectId> <sceneId> '{
  "type": "slideContinuity",
  "durationInFrames": 24,
  "params": { "carryAssetId": "hero" }
}'

# shallow-merge patch — only the keys you pass are touched
# `params` merges key-by-key; `durationInFrames`/`type` overwrite wholesale
# throws if the scene has no transitionOut yet (use set-transition first)
node scripts/agent-cli.mjs update-transition <projectId> <sceneId> '{
  "durationInFrames": 36,
  "params": { "carryAssetId": "body" }
}'

# clear scene's transitionOut (back to hard cut)
node scripts/agent-cli.mjs remove-transition <projectId> <sceneId>

# read what's there before editing
node scripts/agent-cli.mjs list-transitions <projectId>
```

## `params` — what each type reads

`params` is opaque to the schema; the transition's manifest declares what it
expects. Run `node scripts/agent-cli.mjs transition <Type>` for the exact
keys. Two patterns the registry uses today:

- **`carryAssetId`** (string): single-asset continuity — the asset id to
  morph across the cut. Asset must exist in both the outgoing and incoming
  scene. Resolved to `carryFrom`/`carryTo` on the bundle's `props`.
- **`carryAssetIds`** (array of strings): multi-asset continuity — multiple
  carried elements. Resolved to `carriesFrom`/`carriesTo` keyed-by-id maps.
  See `to_be_indexed/style-transition.md`.

## `consumes` manifest flags — what the resolver wires

Each transition's `manifest.json` declares a `consumes` block. The resolver
reads three flags; a flag set to `true` makes the resolver populate the
corresponding props on the bundle:

| Flag                       | Activates                          | Resolved into                       |
|----------------------------|------------------------------------|-------------------------------------|
| `consumes.carriedAssets`   | `carryAssetId` / `carryAssetIds`   | `carryFrom`/`carryTo` or `carriesFrom`/`carriesTo` |
| `consumes.outgoingSceneStyles` | always (when set)              | `outgoingSceneStyles` = `{ background }` |
| `consumes.incomingSceneStyles` | always (when set)              | `incomingSceneStyles` = `{ background }` |

The bundle's `props` always starts as a copy of the spec's `params`, so
author-side params and resolver-side props coexist on the same object the
component receives.

To enable these for a custom transition, set the flags in its `manifest.json`
and have the component read the corresponding props — see
`to_be_indexed/style-transition.md` for the component-side usage pattern.

## `scene.effects[]` — detached effects (post-refactor)

Boundary effects are now hosted on the **scene-level `effects[]` array**
(`effects.schema.json#/definitions/effectsArray`), distinct from the previous
`scene.transitionOut.effects` location. The `transitionOut` object now owns
only `{type, durationInFrames, params}` — no `effects` key. Each effect
entry is a `sfx` or `visual` block pinned to an **exact scene-local `frame`**
(the primary post-refactor shape). The legacy `timing`/`offsetPercent` shape
below is kept as a backward-compat bridge for the 7 migrated shipped manifests
— `resolveSceneEffects` falls back to it only when `frame` is absent.

Frame-first authoring:

```json
"effects": [
  { "id": "whoosh", "kind": "sfx",   "frame": 120,                       "path": "audio/sfx.mp3",    "volume": 0.6 },
  { "id": "flash",  "kind": "visual","frame": 18,                         "assetType": "ImageReveal", "anchor": { "position": "center" }, "contentOverride": { "src": "assets/flash.png", "alt": "" }, "durationInFrames": 6 }
]
```

Legacy `timing`/`offsetPercent` form (only as a backward-compat bridge —
new authoring should prefer `frame`):

```json
"effects": [
  { "id": "whoosh", "kind": "sfx",   "path": "audio/sfx.mp3", "volume": 0.6, "timing": { "offsetPercent": 0 } },
  { "id": "flash",  "kind": "visual", "assetType": "ImageReveal", "anchor": { "position": "center" }, "contentOverride": { "src": "assets/destination.png", "alt": "" }, "durationInFrames": 6, "timing": { "relativeToAsset": "hero", "edge": "exit" } }
]
```

- `kind` (string, required): `sfx` | `visual`.
- `id` (string, optional): auto-numbered `fx-${i}` / `sfx-${i}` if omitted.
- `frame` (number, optional but primary now): exact scene-local frame at
  which the effect fires (sfx: starts; visual: enters/view-spans from). 0 =
  scene start; `scene.durationInFrames` = visible end. Wins over `timing`/
  `offsetPercent` when present.
- `timing` (object, optional, legacy): a `timingAnchor` (see `timing.md`).
- `offsetPercent` (number, optional, legacy): percent of scene duration from
  the end frame. See `timing.md` for the formula.
- For `sfx`: `path` (string, relative to `public/`), `volume` (number, default
  1), `durationInFrames` (number, optional — null means "play to end of file").
- For `visual`: `assetType` (string, required), `anchor` (object, required),
  `contentOverride` / `styleOverride` (objects, optional), `durationInFrames`
  (number, default 30). Resolved through the same asset pipeline as a normal
  scene asset — use `envelope` for the shape.

Author via `add-effect` / `inject-effects` (see `build.md`). `inject-effects`
always resolves + reads the project timeline FIRST and writes a `frame` for
each effect — never an `offsetPercent` (legacy percent model is for
hand-edits on migrated scenes only).

## Common pitfalls

- **`params` is unconstrained by schema.** A typo in a param name (e.g.
  `carryAsdsetId`) validates and silently no-ops. Run `transition <Type>`
  before setting `params`, not from memory.
- **`carryAssetId` must exist in both scenes.** The resolver throws — naming
  the type, the outgoing scene id, and the missing id — rather than silently
  dropping the carry. Same for every id in `carryAssetIds`.
- **`update-transition` throws when no `transitionOut` exists.** Use
  `set-transition` first; `update-transition` is for patching an existing
  one.
- **`durationInFrames` defaults to the type's manifest value, not 0.** A
  transition with `durationInFrames` omitted still produces a real overlap
  window (e.g. 24 frames for `slideContinuity`).
- **Last scene has no `transitionOut`.** `resolve.js` skips the bundle (no
  incoming scene to cut to) but still honors authored `effects[]` on the
  final scene's exit boundary — so `inject-effects` with `anchor:"exit"` on
  the last scene isn't silently dropped.
- **Effects live on `scene.effects[]`, not `transitionOut.effects` (post-refactor).**
  Transit boundary effects were detached during the refactor; `transitionOut`
  now owns only `{type, durationInFrames, params}`. Scene-level effects are
  authored on the detached `scene.effects[]` array (see `effects.schema.json`)
  and timed by an exact `frame` (legacy `timing`/`offsetPercent` is a
  backward-compat bridge). `add-effect` writes to `scene.effects[]`; don't
  hand-edit `transitionOut` to host effects (the key is no longer schema-defined).
