# Motion & rotation

Controls how assets enter, exit, and rotate within a scene. Two halves:
authoring-time resolution (`resolveMotion` in `src/motion/motion.js`) and
render-time computation (`computeMotionTransform`, called by
`Composition.jsx`).

Motion is authored under the `motion` key of an asset spec — the optional
`motion` field on every asset (`envelope` command confirms shape). You cannot
set it via a dedicated CLI command; pass it inline inside the `add-asset`
JSON, or patch it with `update-asset`.

## Overview

```json
"motion": {
  "in":        "fadeUp",
  "out":       "fadeOut",
  "rotateDeg": 4,
  "rotate":    { "toDeg": 12, "durationInFrames": 24, "easing": "easeOut" }
}
```

Four independent sub-keys, all optional. An asset with no `motion` key
resolves to `null` and `computeMotionTransform` returns the identity
transform (`opacity:1`, `translate(0,0)`, `rotate(0)`) — byte-identical to
pre-motion behavior:

- **`in`** — entrance phase (fade + optional slide + optional settle-rotation).
- **`out`** — exit phase (mirror of `in`).
- **`rotateDeg`** — static base rotation, held for the asset's full on-screen
  duration.
- **`rotate`** — animated rotation phase, layered as the *base* rotation that
  the transient in/out offsets add on top of.

## 1. Entrance & exit (`in` and `out`)

Each is either a **string alias** or an **object** for overrides.

Aliases:
- `in`: `none`, `fade`, `fadeUp`, `fadeDown`, `fadeLeft`, `fadeRight`
- `out`: `none`, `fadeOut`, `fadeOutUp`, `fadeOutDown`, `fadeOutLeft`, `fadeOutRight`

| alias | effect |
|---|---|
| `fadeUp` | fades in while rising into its anchored position |
| `fadeDown` | fades in while dropping into position |
| `fadeLeft` | fades in while sliding in from the right |
| `fadeRight` | fades in while sliding in from the left |
| `fade` | pure opacity fade, no movement |
| `none` | explicit no-op for that phase |
| `fadeOutUp` / `fadeOutDown` / `fadeOutLeft` / `fadeOutRight` | fades out while exiting in that direction |
| `fadeOut` | pure opacity fade out |

Object overrides:

```json
"motion": {
  "in": {
    "alias":            "fadeUp",
    "distancePx":       140,
    "durationInFrames":  24,
    "rotateFromDeg":    -6
  }
}
```

- `alias` (string, optional): one of the aliases above. Required to use the
  direction presets; if omitted, the object form lets you author `fade` /
  `direction` directly (rarely used — alias is the clean path).
- `distancePx` (number, ≥ 0, default `80`): travel distance in px. Signed
  direction comes from the alias.
- `durationInFrames` (number, ≥ 1, default `18`): frames the phase animates
  over.
- `rotateFromDeg` (number, default `0`): extra rotation (deg) that **resolves
  to 0** as the entrance completes — a brief counter-tilt that settles as the
  asset arrives. On exit, applied *additively* as the phase completes.

Direction semantics: "up" for an entrance means the asset **starts below**
its anchored position (positive Y offset) and rises to 0 — i.e. `fadeUp`
fades the asset *up into place*. The same table is reused for exits;
`computeMotionTransform` flips the sign so `fadeOutUp` travels upward and
*away* as the asset leaves.

## 2. Static rotation (`rotateDeg`)

Field: `motion.rotateDeg` (number). Default `0`. The asset stays at this
angle throughout its on-screen duration — a fixed tilt, not animated.

`rotateDeg` is also the default `fromDeg` for the animated `rotate` phase
when you don't specify one — so `{ rotate: { toDeg: 15 } }` alone reads as
"spin from the resting orientation to 15°" (and if `rotateDeg: 4` is also
set, it spins from 4° to 15°).

## 3. Animated rotation (`rotate`)

An independently-animated rotation phase, distinct from the transient
`rotateFromDeg` offsets the in/out phases carry. Schema:
`motionRotatePhase` in `scene.schema.json`.

```json
"motion": {
  "rotate": {
    "fromDeg":          0,
    "toDeg":            15,
    "durationInFrames": 24,
    "delayFrames":      4,
    "startAt":          "afterIn",
    "atFrame":          null,
    "easing":           "easeInOut"
  }
}
```

- `toDeg` (number, **required**): target angle in degrees.
- `fromDeg` (number, optional): starting angle. **Defaults to `rotateDeg`
  (or `0`)** — so omit for "spin from rest to `toDeg`".
- `durationInFrames` (number, ≥ 1, default `18`): frames the rotation
  animates over.
- `delayFrames` (number, ≥ 0, default `0`): extra frames to wait, relative to
  `startAt`, before rotation begins.
- `startAt` (enum, default `"afterIn"`): when rotation begins. See below.
- `atFrame` (number, ≥ 0): scene-local frame to start at. **Required when
  `startAt` is `"atFrame"`** (the resolver throws otherwise); ignored for the
  other modes.
- `easing` (enum, default `"easeInOut"`): `linear | easeIn | easeOut |
  easeInOut`.

### `startAt` modes

- **`afterIn`** (default): rotation begins once the entrance move/fade has
  fully resolved — `enterAtFrame + in.durationInFrames + delayFrames`. This
  is what makes rotation visually happen *after* the asset has moved into the
  scene: by the time rotation starts, the in-phase's `translateX/Y`
  contribution is already back to 0, so the visible motion is a clean
  in-place spin, not a spin-while-still-sliding blend.
- **`withIn`**: starts at `enterAtFrame + delayFrames`, running concurrently
  with the entrance motion. Use this when you want rotation blended into the
  entrance (e.g. a coin spinning as it flies in).
- **`atFrame`**: starts at the explicit scene-local `atFrame + delayFrames`
  — independent of the entrance/exit phases.

After `durationInFrames` elapses, the rotation holds at `toDeg` for the
remainder of the asset's on-screen duration.

## 4. How the layers compose

`computeMotionTransform` returns `{ opacity, translateX, translateY,
rotateDeg }` per frame. Rotation is built from two additive layers:

1. **`baseRotateDeg`** — either the flat `rotateDeg`, or, when a `rotate`
   phase is authored, an eased `fromDeg → toDeg` animation that starts at
   `resolveRotateStartFrame()` and holds at `toDeg` afterward.
2. **Transient in/out offsets** (`rotateFromDeg`) layered additively on top
   — e.g. a `fadeUp` entrance that also wants a slight settle-rotation
   independent of the standalone `rotate` phase.

So `motion: { in: "fadeUp", rotate: { toDeg: 8 } }` reads as: slide up while
fading in (with `rotateFromDeg: 0` on the in-phase, so no settle-rotation),
then once settled ease into an 8° tilt over 18 frames.

The CSS transform applied to the wrapper is
`translate(${translateX}px, ${translateY}px) rotate(${rotateDeg}deg)`.
Translate is a fixed screen-space vector applied regardless of rotation
angle — rotation never causes the asset to "orbit" its anchor; it pivots
around the asset's own box (`transformOrigin` on the wrapper).

## CLI examples

Add motion at creation time:

```bash
node scripts/agent-cli.mjs add-asset <projectId> <sceneId> '{
  "assetType": "ImageReveal",
  "anchor": { "position": "center" },
  "contentOverride": { "src": "<path-under-public/>" },
  "motion": { "in": "fadeUp", "rotate": { "toDeg": 8, "durationInFrames": 24 } }
}'
```

Patch motion on an existing asset (only `motion` key touched; rest left
alone):

```bash
node scripts/agent-cli.mjs update-asset <projectId> <sceneId> <assetId> '{
  "motion": {
    "in":        { "alias": "fade", "distancePx": 0, "durationInFrames": 12 },
    "rotateDeg": 4,
    "rotate":    { "toDeg": 12, "easing": "easeOut" }
  }
}'
```

## Recipes

**Settle-In** — slide up, then tilt slightly:

```json
"motion": { "in": "fadeUp", "rotate": { "toDeg": 8, "durationInFrames": 24 } }
```

Entrance resolves first, then a gentle 8° tilt eases in over 24 frames.

**Concurrent spin** — rotate while fading in (blend):

```json
"motion": {
  "in": "fade",
  "rotate": { "toDeg": 360, "startAt": "withIn", "durationInFrames": 30, "easing": "linear" }
}
```

Rotation and entrance run concurrently — visible as a spin-while-fading
combo. Use `withIn` deliberately when you want this blend.

**Delayed tilt after entrance** — spin after a beat:

```json
"motion": {
  "in": "fadeUp",
  "rotate": { "toDeg": -6, "startAt": "afterIn", "delayFrames": 6, "durationInFrames": 12 }
}
```

Wait 6 frames after the entrance finishes, then tilt to -6° over 12 frames.

**Static tilt only** — no entrance motion, just a held angle:

```json
"motion": { "rotateDeg": 4 }
```

Asset mounts at 4° and stays there. Equivalent to omitting `motion` entirely
and setting a CSS rotation, but kept in the motion system so it composes
correctly with camera depth.

**Bigger rise with counter-rotation** — entrance with settle:

```json
"motion": { "in": { "alias": "fadeUp", "distancePx": 140, "rotateFromDeg": -6 } }
```

Slides up 140px while fading in, with a -6° counter-tilt that resolves to 0°
as the asset arrives — a springy settle.

## Common pitfalls

- **`toDeg` is required on any `rotate` object.** Omit it and `add-asset`
  returns non-empty `warnings` (or `resolve` throws with
  `motion.rotate requires a numeric "toDeg"`).
- **`fromDeg` defaults to `rotateDeg` (or `0`) — not to the current rotation.**
  If you set `rotateDeg: 4` and omit `fromDeg`, the spin starts at 4°. To
  start from 0°, set `fromDeg: 0` explicitly.
- **Overlapping motion**: if `startAt` is `withIn`, asset rotates while
  translating. For a clean in-place spin, use `afterIn` (default) — rotation
  waits for the entrance to finish.
- **`atFrame` is required when `startAt` is `"atFrame"`.** The resolver throws
  `motion.rotate.startAt "atFrame" requires a numeric "atFrame"` otherwise.
- **`atFrame` is a scene-local frame index, not a fraction.** `enterAt`/
  `exitAt` define the asset's window as fractions of scene duration;
  `motion.rotate.atFrame` is a frame number on the scene's own timeline.
- **`easing` enum is `linear | easeIn | easeOut | easeInOut`.** A bad value
  throws `Unknown motion.rotate.easing` with the available list at resolve
  time.
- **`out.rotateFromDeg` is additive on exit** — it grows *toward* the
  configured value as the phase completes, not from it. A positive value
  spins further in the positive direction as the asset leaves.
- **Don't hand-edit the manifest**: always go through `add-asset`/
  `update-asset`. Read `warnings` after each; an empty array means clean.
- **No `motion` key = identity transform.** Every pre-existing manifest
  renders byte-identical; motion is strictly additive.
