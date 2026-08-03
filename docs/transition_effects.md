# Transition Effects — Design Doc

Adds optional per-render SFX and visual effects anchored to a scene
boundary (i.e. "between scenes"), timed as a percentage offset from that
scene's own **resolved** ending frame. Nothing about existing manifests,
scenes, or renders changes unless a manifest opts in.

## Why on `transitionOut`, not a new top-level field

A boundary effect is conceptually about the cut, and the cut is already
modeled per-scene as `scene.transitionOut`. Piggybacking there means:

- no new schema top-level key to validate/thread through pipeline1,
- effects and the transition they accompany travel together in one object,
- the outgoing scene is already the thing pass-2 resolves both transition
  bundles against, so effects reuse that same pass with no new plumbing.

## New keys

### `scene.transitionOut.effects` (optional array)

Lives in `scene.schema.json` under `transitionRef`. Omit it entirely for a
scene with no boundary effects — this is the default for every existing
manifest in the repo.

Each entry:

| key | required | meaning |
|---|---|---|
| `id` | no | Effect id; auto-generated (`sfx-N` / `fx-N`) if omitted. |
| `kind` | yes | `"sfx"` or `"visual"`. |
| `offsetPercent` | yes | See timing model below. |
| `durationInFrames` | no | `sfx`: omit to let the clip play its natural length. `visual`: how long the effect asset stays mounted (default `30`). |
| `path` | sfx only | Audio file path relative to `public/`. |
| `volume` | sfx only | `0–1`, default `1`. |
| `assetType` | visual only | Must match a registered assetType (e.g. `ImageReveal`, `TextBlock`) — a boundary effect is literally one of the existing renderable assets, timed against the scene's end instead of its own `enterAt`/`exitAt`. |
| `anchor` | visual only | Same shape as an asset's `anchor` (`position` + `offsetXPercent`/`offsetYPercent`). Defaults to `center` if omitted. |
| `contentOverride` | visual only | Same as an asset's `contentOverride`, validated against that assetType's own content schema at authoring time (not currently re-validated by Ajv — see Known Gaps). |
| `styleOverride` | visual only | Same as an asset's `styleOverride`. |

### Resolved output: `resolvedScene.effects`

Every resolved scene now always has an `effects` array (default `[]`), so
`scene.effects` is safe to read unconditionally downstream — no
`?? []` needed at the call site, though the renderer still guards for
scene graphs produced by an older `resolve.js`.

- `sfx` entries: `{ id, kind: "sfx", frame, durationInFrames, path, volume }`
- `visual` entries: `{ id, kind: "visual", assetType, content, resolvedPosition, resolvedStyle, timing }` — identical shape to a resolved scene *asset*, so it's rendered by the exact same component lookup.

`frame` / `timing.enterAtFrame` are already-resolved, scene-local frame
numbers (frame 0 = scene start) — the renderer never re-does the
percentage math.

## Timing model

`offsetPercent` is relative to `scene.durationInFrames` — the **fully
resolved** scene length, i.e. after TTS narration timing and any
transition-overlap padding are already baked in (the same field
`resolveScene` computes and everything else in the scene graph treats as
ground truth).

```
frame = round( durationInFrames * (1 + offsetPercent / 100) )
frame = clamp(frame, 0, durationInFrames)
```

| `offsetPercent` | Result |
|---|---|
| `0` | Exactly the scene's last frame. |
| `-10` | 10% before the end (fires at 90% of the scene's length). |
| `+10` | 10% *past* the nominal end — lands in the overlap padding reserved for the outgoing transition. Still clamped to `durationInFrames`, so it can never escape the scene's own `Sequence`. |

This lives in one place — `src/timing/effectTiming.js` — mirroring how
`src/templating/anchor.js` is the single place raw pixels get computed
from an anchor spec. `resolveEffectFrame(offsetPercent, sceneDurationInFrames)`
is the only function; nothing else does this arithmetic.

## Resolution flow (`resolve.js`)

Effects resolve in the existing pass-2 loop, right where
`transitionOut`/`transitionIn` bundles are already built (the loop that
needs both the outgoing and incoming scene already resolved):

1. `resolveScene` always sets `effects: []` on its return value.
2. Pass 2, per adjacent scene pair, now also calls
   `resolveTransitionEffects(scenes[i].transitionOut?.effects, outgoing, styles, assetRegistry, compositionSize)`.
3. That function returns `[]` immediately if `effectsSpec` is missing,
   `undefined`, or empty — so any scene without authored effects resolves
   byte-for-byte as before.
4. For `sfx`, it just computes `frame` and passes through `path`/`volume`/`durationInFrames`.
5. For `visual`, it runs the effect through the **same** three steps a
   normal scene asset goes through: `getAsset` (registry lookup),
   `resolveAnchor` (pixel position), `resolveAssetStyle` (token
   resolution) — so a boundary effect is not a new asset system, just an
   existing asset instantiated at a scene-end-relative time instead of a
   scene-start-relative `enterAt`/`exitAt`.

Last scene: pass 2's loop only runs `if (incoming)`, so the final scene
never gets an `effects` assignment beyond its `resolveScene` default of
`[]`. There is currently no "after the last scene" boundary — see Known
Gaps if that's wanted later.

## Rendering (`Composition.jsx`)

- `SceneLayer` now also maps `(scene.effects ?? [])` to a new
  `SceneEffectLayer` component, alongside the existing `scene.assets` map.
- `SceneEffectLayer`:
  - `kind: "sfx"` → wraps Remotion's `<Audio>` in a `<Sequence from={frame} durationInFrames={...}>`.
  - `kind: "visual"` → looks up `ASSET_COMPONENTS[effect.assetType]` (the
    **same** lazy-loaded component map built from
    `studio/generated/registry.generated.json` for ordinary assets) and
    renders it with `resolvedPosition` / `resolvedStyle` / `content` /
    `timing` — identical props shape to a normal asset.

No new registry, no new `require.context` root, no change to
`generateRegistryManifest.js` or `assetRegistry.js` — a visual effect is
just a registered asset type used in a new place.

## Backward compatibility

- Schema: `effects` is optional and not in `required`, so all existing
  `.json`/`.toon` scene files (`packet-journey`, `finance-project`,
  `example-project`) validate unchanged.
- Resolve: `resolveTransitionEffects` short-circuits to `[]` when nothing
  is authored.
- Render: `SceneLayer` guards with `?? []`, so even a scene graph produced
  by a pre-upgrade `resolve.js` (no `effects` key at all) renders fine.
- No changes to `anchor.js`, `styleRegistry.js`, `assetRegistry.js`,
  `Composition.jsx`'s module-loading section, or any asset/transition
  component — everything is additive.

## Example

```json
"transitionOut": {
  "type": "shatterWipe",
  "durationInFrames": 22,
  "params": { "cols": 6, "rows": 4, "throwDistance": 220 },
  "effects": [
    {
      "id": "shatter-thud",
      "kind": "sfx",
      "offsetPercent": -3,
      "path": "audio/sfx/shatter-thud.wav",
      "volume": 0.9
    },
    {
      "id": "shatter-flash",
      "kind": "visual",
      "offsetPercent": 0,
      "durationInFrames": 10,
      "assetType": "ImageReveal",
      "anchor": { "position": "center" },
      "contentOverride": { "src": "assets/flash-white.png", "alt": "" },
      "styleOverride": {
        "width": 1920,
        "height": 1080,
        "borderRadius": 0,
        "revealDirection": "center-out"
      }
    }
  ]
}
```

Reads as: a thud plays starting 3% before this scene's resolved end, and a
full-screen white flash (rendered via the existing `ImageReveal` asset)
mounts exactly on the last frame and stays for 10 frames.

## Known gaps / follow-ups

- `contentOverride`/`styleOverride` on a `visual` effect aren't validated
  against that assetType's own `contentOverrideSchema`/`styleOverrideSchema`
  by Ajv the way scene assets implicitly are expected to be — worth adding
  if effect authoring becomes common.
- There's no boundary after the *last* scene (no scene to attach
  `transitionOut.effects` to). If an "outro" effect is needed, it would
  need either a synthetic final boundary or a different attachment point
  (e.g. `manifest`-level `outro.effects`).
- `sfx` effects don't currently get anchor/position resolution (audio has
  none) — only `frame`/`durationInFrames`/`path`/`volume` are resolved, by
  design.