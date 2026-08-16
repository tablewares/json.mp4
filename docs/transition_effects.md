# Transition Effects — Design Doc

> **POST-REFACTOR NOTE (scene-level effects, exact frames).**
> Effects are **no longer nested under `transitionOut`**. They now live on the
> detached scene-level `effects[]` array, owned by
> `src/pipelines/pipeline1-validate/schema/effects.schema.json`, resolved by
> `resolveSceneEffects` in
> `src/pipelines/pipeline2-resolve/resolveTransitions.js`, and timed by an
> **exact scene-local `frame` key** (not `offsetPercent`).
>
> - New authoring and the `agent-cli.mjs inject-effects` writer use the
>   `frame` form exclusively: `{ kind, id, frame, ... }`. The resolver
>   honors an explicit `frame` first.
> - The legacy `timing` / `offsetPercent` shapes described in the rest of
>   this document are kept for **backward compatibility** with the migrated
>   shipped manifests (they were lifted from `transitionOut.effects` to
>   `scene.effects` during the refactor). `resolveSceneEffects` falls back
>   to `effect.timing` and then `effect.offsetPercent` only when `frame`
>   is absent — so those scenes render byte-identically to before. New
>   authoring should prefer `frame`.
> - `transitionOut` itself now owns only `{ type, durationInFrames, params }`
>   per `transition.schema.json`.
> - The `inject-effects` CLI command and `ProjectBuilder.injectTimelineEffects`
>   resolve + read the project's global-frame timeline FIRST, then write each
>   effect with a scene-local `frame` derived directly from the timeline
>   (asset-segment global edge − scene startFrame; scene-boundary: 0 or
>   `scene.durationInFrames`). No percent math survives on disk for newly
>   injected effects.

---

Adds optional per-render SFX and visual effects anchored to a scene
boundary (i.e. "between scenes") — originally timed as a percentage
offset from that scene's own **resolved** ending frame. The percent
form is preserved as a legacy bridge (see the note above); new authoring
uses an exact scene-local `frame`. Nothing about existing manifests,
scenes, or renders changes unless a manifest opts in.

## Why on the scene (post-refactor), not under `transitionOut`

A boundary effect is conceptually about the cut, and previously lived
on `scene.transitionOut`. The refactor detaches it to a top-level
`scene.effects[]` so that:

- effects and the transition have **independent schemas** —
  `transition.schema.json` keeps only `transitionRef`, while
  `effects.schema.json` owns the effect vocabulary and is reusable
  elsewhere;
- effects resolve via a dedicated `resolveSceneEffects` resolver that
  reads the explicit `frame` (with legacy `timing`/`offsetPercent`
  fallback) — no transition bundle needed to host them;
- the timing model is an **exact frame**, not a percent — making it
  possible to write effects by frame from the resolved timeline via
  `inject-effects` without any percentage-to-frame arithmetic.

## New keys

### `scene.effects` (optional array)

Lives in `scene.schema.json` under `effects`
(`effects.schema.json#/definitions/effectsArray`). Omit it entirely for a
scene with no boundary effects — this is the default for every existing
manifest in the repo.

Each entry:

| key | required | meaning |
|---|---|---|
| `id` | no | Effect id; auto-generated (`sfx-N` / `fx-N`) if omitted. |
| `kind` | yes | `"sfx"` or `"visual"`. |
| `frame` | yes (new authoring) | **Exact scene-local frame** at which the effect fires (sfx: starts; visual: enters). 0 = scene start; `scene.durationInFrames` = the scene's visible end. Post-refactor primary timing key — survives on disk verbatim (no percent math). |
| `offsetPercent` | legacy | Kept as a backward-compat bridge; only used when both `frame` and `timing` are absent. See timing model below. New authoring should use `frame` instead. |
| `timing` | legacy | A `timingAnchor` object (`offsetPercent` / `relativeToAsset` / `relativeToCameraAction` / `relativeToWord`); only used when `frame` is absent. Kept so the migrated shipped manifests still validate and render byte-identically. |
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
- The last scene's authored `transitionOut.effects` now resolve and render
  (`resolve.js` pass 2 runs `resolveTransitionEffects` on a trailing scene
  even when there's no incoming scene to build a `transitionOut` bundle
  for). There is still no `transitionOut` *bundle* on a trailing scene —
  effects fire within the scene's own Sequence, not overlapping into a
  following cut — but the boundary placement (`offsetPercent: 0` = the
  scene's visible end frame) is honored. A manifest-level `outro.effects`
  remains a non-goal unless a true post-composition outro is wanted.
- `sfx` effects don't currently get anchor/position resolution (audio has
  none) — only `frame`/`durationInFrames`/`path`/`volume` are resolved, by
  design.