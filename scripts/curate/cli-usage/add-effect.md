# `add-effect`

Append one boundary effect (`sfx` or `visual`) to a scene's detached
`effects[]` array — the post-refactor scene-level effects surface owned by
`src/pipelines/pipeline1-validate/schema/effects.schema.json`.

## What it writes

Each call appends exactly one entry to `scene.effects[]` (auto-creates the
array if absent). The on-disk shape is **frame-first**: an explicit scene-local
`frame` is the primary timing key. No `transitionOut` is created or touched by
this command — effects and transitions are independent surfaces after the
refactor.

```bash
node scripts/agent-cli.mjs add-effect <projectId> <sceneId> '<json>'
```

The `<json>` arg may be literal JSON or `"-"` to read from stdin (use `"-"` for
large `contentOverride` payloads to dodge shell quoting).

## sfx effects

```bash
node scripts/agent-cli.mjs add-effect <projectId> <sceneId> '{
  "id":        "thud",
  "kind":      "sfx",
  "frame":     18,
  "path":      "audio/sfx.mp3",
  "volume":    0.8
}'
```

| key | required | meaning |
|---|---|---|
| `kind` | yes | `"sfx"` |
| `id` | yes (for idempotency) | unique within the scene; basis for `inject-effects` replace-by-id |
| `path` | yes | audio file under `public/`, e.g. `"audio/sfx.mp3"` (relative path — Remotion `staticFile()` resolves it) |
| `frame` | yes (preferred) | exact scene-local frame at which the sfx starts (0 = scene start; `scene.durationInFrames` = visible end) |
| `volume` | no | `0–1`, default `1` |
| `durationInFrames` | no | explicit duration; omit to let the clip play its natural length |

`frame` is **not** a percent. The value you write is the value `resolve.js`
passes through (clamped to `[0, scene.durationInFrames]` defensively). It
matches what `render` would actually play because both `add-effect` and the
resolver read the same on-disk scene file.

## visual effects

```bash
node scripts/agent-cli.mjs add-effect <projectId> <sceneId> '{
  "id":             "flash",
  "kind":           "visual",
  "frame":          30,
  "assetType":      "ImageReveal",
  "anchor":         { "position": "center" },
  "contentOverride": { "src": "assets/destination.png", "alt": "" },
  "styleOverride":   { "width": 1920, "height": 1080, "borderRadius": 0, "revealDirection": "center-out" },
  "durationInFrames": 10
}'
```

| key | required | meaning |
|---|---|---|
| `kind` | yes | `"visual"` |
| `id` | yes | unique within the scene |
| `assetType` | yes | any registered assetType under `studio/assets/` or `studio/graphics/` (the effect spawns its own AssetComponent at its `anchor`) |
| `frame` | yes (preferred) | exact scene-local frame at which the effect enters (becomes visible) |
| `anchor` | no | same shape as an asset `anchor` (`position` + optional `offsetXPercent`/`offsetYPercent`); defaults to `{position:"center", 0, 0}` |
| `contentOverride` | no | same shape as a normal asset's `contentOverride`, validated against that assetType's manifest |
| `styleOverride` | no | same as an asset's `styleOverride`; `width`/`height` default to the asset's `defaultSize` |
| `durationInFrames` | no | default `30` — how long the effect stays mounted before exiting |

Resolve + render behavior is identical to a normal scene asset placed by
`add-asset`: `resolveSceneEffects` (in
`src/pipelines/pipeline2-resolve/resolveTransitions.js`) resolves the anchor to
pixels and the style tokens, and `Composition.jsx`'s `SceneEffectLayer` mounts
the component inside the scene's `TransitionSeries.Sequence`.

## Legacy `timing` / `offsetPercent` (backward-compat only)

`effects.schema.json` still accepts the pre-refactor shapes:

```json
{ "id": "tick", "kind": "sfx", "path": "audio/sfx.mp3", "timing": { "relativeToAsset": "chart-1", "edge": "enter", "offsetFrames": 6 } }
{ "id": "thud", "kind": "sfx", "path": "audio/sfx.mp3", "offsetPercent": -3 }
```

These survive `validate` and resolve at pass-2 via `resolveSceneEffects`'s
fallback branch (only when `frame` is absent) — kept so the 7 shipped scenes
migrated from `transitionOut.effects` to `scene.effects` keep rendering
byte-identically. **New authoring should use `frame`** — the percent-not-fraction
trap (the `-1` ≠ "scene start" pitfall in the umbrella manifest SKILL) is
historical for the legacy bridge.

## When to prefer `inject-effects` over `add-effect`

Use `add-effect` when you know the exact scene + frame you want and you're
writing one effect at a time. Use `inject-effects` (see `inject-effects.md`)
when you want one rule to fan out across every matching asset segment *or*
every scene boundary — `inject-effects` resolves the project + reads the
global-frame timeline first, then writes the per-segment/per-scene `frame` for
you. Both commands write the same `scene.effects[]` array; the only difference
is single-shot vs. timeline-driven bulk placement.

## Verify

```bash
node scripts/agent-cli.mjs validate <projectId>
node scripts/agent-cli.mjs timeline <projectId> | head -60
```

A `validate` pass confirms the on-disk `effects[]` entry is schema-valid
(`additionalProperties: false` on `sfxEffect`/`visualEffect` — unknown keys
reject). The `timeline` command lists each scene's resolved `startFrame` and
duration, which is what your `frame` value is measured against (frame 0 = the
scene's start, frame `durationInFrames` = its visible end).

## In-repo references

- `docs/transition_effects.md` — design doc with the post-refactor note framing
  `scene.effects[]` as the primary surface and `frame` as the primary timing
  key; legacy `offsetPercent`/`timing` shapes documented as a backward-compat
  bridge.
- `inject-effects.md` (this folder, new pattern: filename = command name) — the
  timeline-driven bulk counterpart to `add-effect`.
- `timing.md` (this folder) — the `timingAnchor` reference, including the
  legacy `offsetPercent`/`relativeToAsset`/`relativeToCameraAction` selector
  shapes used by the backward-compat bridge.
