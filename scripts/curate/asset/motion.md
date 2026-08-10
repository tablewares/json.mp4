# Motion System

Controls how assets enter, exit, and rotate within a scene. Two halves:
authoring-time resolution (`resolveMotion` in `src/motion/motion.js`) and
render-time computation (`computeMotionTransform`).

Motion is authored under the `motion` key of an asset spec — the optional
`motion` field on every asset (`envelope` command confirms shape). You cannot
set it via a dedicated CLI command; pass it inline inside the `add-asset` /
`add-scene` JSON, or patch it with `update-asset`.

## 1. Entrance & Exit (`in` and `out`)

Each is either a **string alias** or an **object** for overrides.

Aliases:
- `in`: `none`, `fade`, `fadeUp`, `fadeDown`, `fadeLeft`, `fadeRight`
- `out`: `none`, `fadeOut`, `fadeOutUp`, `fadeOutDown`, `fadeOutLeft`, `fadeOutRight`

Object overrides:

```yaml
motion:
  in:
    alias: fadeUp
    distancePx: <number>         # travel distance in px, any positive or negative integer/float
    durationInFrames: <number>    # 1..scene duration in frames
    rotateFromDeg: <number>       # initial tilt (deg) that resolves to 0; sign sets direction
```

## 2. Rotation (`rotateDeg` and `rotate`)

- **`rotateDeg`**: static number. Asset stays at this angle throughout its life.
- **`rotate`**: animated phase changing the base rotation over time.

Animated rotation spec:

```yaml
motion:
  rotate:
    toDeg: <number>              # target angle (deg) — required
    fromDeg: <number>            # starting angle (deg); defaults to rotateDeg or 0
    durationInFrames: <number>   # 1..scene length
    delayFrames: <number>        # additional wait after startAt, 0..scene length
    startAt: "afterIn"            # 'afterIn' (default), 'withIn', or 'atFrame'
    atFrame: <number>            # required when startAt is 'atFrame'; scene-local frame index
    easing: "easeOut"             # 'linear', 'easeIn', 'easeOut', 'easeInOut'
```

`startAt` behaviors:
- `afterIn`: starts after the `in` phase finishes. Prevents "spin-while-sliding" blends.
- `withIn`: starts exactly at `enterAt`. Runs concurrently with entrance.
- `atFrame`: starts at a specific scene-local frame.

## CLI examples

Add motion at creation time:

```bash
node scripts/agent-cli.mjs add-asset <projectId> <sceneId> '{
  "assetType": "<Type>",
  "motion": { "in": "fadeUp", "rotate": { "toDeg": <number>, "durationInFrames": <number> } }
}'
```

Patch motion on an existing asset (only `motion` key touched; rest left alone):

```bash
node scripts/agent-cli.mjs update-asset <projectId> <sceneId> <assetId> '{
  "motion": { "in": { "alias": "fade", "distancePx": <number>, "durationInFrames": <number> }, "rotateDeg": <number> } }'
```

## Recipes

Settle-In (slide up, then tilt slightly):

```yaml
motion:
  in: fadeUp
  rotate:
    toDeg: <number>
    durationInFrames: <number>
```

Concurrent spin (rotate while fading in):

```yaml
motion:
  in: fade
  rotate:
    toDeg: <number>
    startAt: withIn
    durationInFrames: <number>
```

## Common pitfalls

- **Overlapping motion**: if `startAt` is `withIn`, asset rotates while translating. For a clean in-place spin, use `afterIn`.
- **Schema violation**: `toDeg` is required on any `rotate` object. Omit it and `add-asset` returns non-empty `warnings`.
- **Frame offsets**: `enterAt`/`exitAt` define the window (fractions of scene duration); `motion.rotate.atFrame` is a scene-local frame index, not a fraction.
- **Don't hand-edit the manifest**: always go through `add-asset`/`update-asset`. Read `warnings` after each; an empty array means clean.
