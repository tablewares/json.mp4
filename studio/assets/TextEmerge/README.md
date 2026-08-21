# TextEmerge

Standalone, cinematic "materialize" text card — the b-roll-weight sibling
of `KineticText`. Built for a shot with NO narration sync needed: a
title/statement card that needs more presence than a plain `TextBlock`
fade-up but none of `KineticText`'s caption-cadence "pop".

## Taste difference vs KineticText

| | KineticText | TextEmerge |
|---|---|---|
| Per-word curve | `spring()` overshoot pop (`wordPopScale`) | plain monotonic `interpolate()`, no overshoot |
| Look | snappy, caption energy | slow blur→sharp, drift, settle |
| Container | no group-level motion | whole block lifts+scales as one mass on top of the per-word cascade |
| Exit | flat opacity fade | mirrors the entrance: blur+drift+fade dissolve |
| Use case | narration-synced captions, beats | standalone b-roll statement/title cards |

## Fields worth knowing

- `curve` (NOT `easing` — see below): `easeOutCubic` / `easeOutQuart` /
  `easeOutExpo` (default). Shapes both the per-word materialize and the
  container lift.
- `blurAmount`: peak px of gaussian blur each word starts at before
  sharpening to 0 — the primary "fade into existence" mechanism. Set 0 for
  a pure fade with no defocus.
- `driftDirection` / `driftDistance`: axis + distance words (and the
  container) travel in from / dissolve back toward. Default `up`.
- `revealDurationFrames`: how long EACH word takes to fully resolve,
  independent of the stagger between word starts (`staggerFrames`).
- `containerLift` / `containerDriftDistance` / `containerScaleFrom`: the
  group-level motion — the whole card drifting into frame as one mass, on
  top of the per-word cascade. Set `containerLift: false` to isolate just
  the per-word materialize.
- `highlighter`: same inline sweep-marker block as `KineticText` — see
  `studio/assets/KineticText/manifest.json` for the full field reference.
  Usually left off for this asset (blur/drift/lift already carries the
  emphasis).

### Why `curve`, not `easing`

The style resolver (`src/registry/styleRegistry.js` `resolveAssetStyle`)
treats any style key literally named `easing` as a reserved lookup against
`styles.easing.<token>` (spring configs like `snappySpring`). TextEmerge's
named curves (`easeOutExpo`, etc.) aren't spring configs, so the field is
named `curve` instead to avoid the collision — using `easing` here throws
`Unknown easing token "easeOutExpo"` at resolve.

## Preset alias

`studio/library/aliases/custom.json` registers `text.emergeCard` — the
default "less pop, more appear" b-roll recipe (center-aligned, wide,
easeOutExpo, moderate blur/drift). Use it directly:

```json
{
  "assetType": "TextEmerge",
  "anchor": { "position": "center" },
  "contentOverride": { "text": "Quantitative Easing" },
  "styleOverride": { "$alias": "text.emergeCard" },
  "enterAt": 0, "exitAt": 1, "z": 10
}
```

See `scripts/curate/solutions/composition/b-roll-sequence.md` step 7 for
where this fits in a b-roll sequence build (title card without
`KineticText`).

## Verification

```
node scripts/discovery.mjs asset TextEmerge
node scripts/discovery.mjs alias text.emergeCard
```

Scratch-rendered end-to-end during development: 1920x1080@30fps card,
`enterAt: 0, exitAt: 1` on a 90-frame scene — confirms the materialize +
dissolve renders without throwing.
