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
- **`effects`** (array, optional): boundary effects fired on this scene's
  exit cut — `sfx` and `visual` items, each with its own `timingAnchor`
  (see `timing.md`). Covered in `build.md` (`add-effect`, `inject-effects`).

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

## `effects[]` — boundary effects

Optional array on the transition. Each entry is a `sfx` or `visual` effect
fired on the scene's exit cut, each pinned by its own `timingAnchor`:

```json
"effects": [
  { "id": "whoosh", "kind": "sfx",   "path": "audio/whoosh.mp3", "volume": 0.6, "timing": { "offsetPercent": 80 } },
  { "id": "flash",  "kind": "visual", "assetType": "TextHighlight", "anchor": { "position": "center" }, "contentOverride": { "text": "" }, "durationInFrames": 6, "timing": { "relativeToAsset": "hero", "edge": "exit" } }
]
```

- `kind` (string, required): `sfx` | `visual`.
- `id` (string, optional): auto-numbered `fx-${i}` / `sfx-${i}` if omitted.
- `timing` (object, optional): a `timingAnchor` (see `timing.md`).
- For `sfx`: `path` (string), `volume` (number, default 1), `durationInFrames`
  (number, optional — null means "play to end of file").
- For `visual`: `assetType` (string, required), `anchor` (object, required),
  `contentOverride` / `styleOverride` (objects, optional),
  `durationInFrames` (number, default 30). Resolved through the same asset
  pipeline as a normal scene asset — use `envelope` for the shape.

Author via `add-effect` / `inject-effects` (see `build.md`).

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
- **`effects[]` on a transition ≠ `effects` on a scene.** Transit boundary
  effects live on `transitionOut.effects`; scene-level effects are separate
  and ride the scene's own enter/exit edges. `add-effect` writes to the
  right place; don't hand-edit.
