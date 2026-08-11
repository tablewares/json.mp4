# Scene-Style & Multi-Asset Transition Continuity

Implemented two new resolution paths in `buildTransitionBundle` so transitions can morph multiple carried assets across a cut and read the resolved background of each scene — wiring up the previously-dead `consumes.outgoingSceneStyles` / `consumes.incomingSceneStyles` manifest flags and adding a plural `carryAssetIds` array param alongside the existing singular `carryAssetId`.

## Changes

### `src/pipelines/pipeline2-resolve/resolveTransitions.js`

Single file touched (the rest of the pipeline — schema, registry scanning, `ProjectBuilder`, `introspect.js` — already treats `params`/`consumes` as opaque passthrough objects, so they require no edits).

Two additive code paths in `buildTransitionBundle`, both gated so existing specs are byte-identical:

#### 1. Multi-asset continuity (`carryAssetIds`)

- Activates only when the spec author supplies `transitionSpec.params.carryAssetIds` as an array. Any spec using the singular `carryAssetId` continues through the existing single-asset path untouched.
- Reuses the same `consumes.carriedAssets` manifest flag — a transition that tracks one carried element can track several without a new flag.
- Resolves into `bundle.props.carriesFrom` / `bundle.props.carriesTo` as **keyed-by-id maps** (not arrays), so a component can do `carriesFrom[id]` directly instead of re-deriving an index → id mapping.
- Throws the same shape of error as the singular path if any id in the array isn't found in both the outgoing and incoming scene.

#### 2. Scene-style passthrough (`outgoingSceneStyles` / `incomingSceneStyles`)

- Wires the previously-dead `consumes.outgoingSceneStyles` / `consumes.incomingSceneStyles` manifest booleans.
- `outgoingScene` / `incomingScene` are already fully-resolved scene objects at this point in `resolve.js`'s pass-2 loop, so `.background` is already resolved to a real color/texture (via `resolveBackground`) — no extra `styles` registry plumbing needed here.
- Scoped to `{ background }` for now, since background is the only genuinely per-scene "style" today (typography/color tokens are project-wide, not scene-scoped). Extend this object if a scene-level style surface grows later.

## Consumer usage

A transition component that wants these reads them off `props`:

```jsx
function MyTransition({ children, presentationProgress,
  carriesFrom, carriesTo,         // multi-asset (keyed by id)
  outgoingSceneStyles, incomingSceneStyles }) { ... }
```

To enable for a given transition type, its `manifest.json` sets:

```json
"consumes": {
  "carriedAssets": true,
  "outgoingSceneStyles": true,
  "incomingSceneStyles": true
}
````

`slideContinuity` already has all three flags set (see `studio/transitions/slideContinuity/manifest.json`), so it now receives `outgoingSceneStyles` / `incomingSceneStyles` in its bundle without further changes — verified in `studio/resolved.json` where scene-001's `transitionOut.props` contains:

```json
"outgoingSceneStyles": { "background": "#0B0E14" },
"incomingSceneStyles": { "background": { "color": "#161B26", "texturePath": "assets/bank_vault.jpg", "blendMode": "multiply", "opacity": 0.5 } }
```

## Schema

No schema changes needed. `transition.schema.json`'s `params: { "type": "object" }` is already unconstrained, so `carryAssetIds` validates today with zero schema edits. `consumes` is read as a plain object — no schema constrains its keys.

## Backward compatibility

Fully additive — the singular `carryAssetId` path is byte-identical to before, and the two new blocks are both gated on manifest flags / param shapes that pre-existing specs don't set.

## Out of scope / follow-ups

- Transition components other than `slideContinuity` (e.g. `pivotZoom`, `WhipPan`, `ShapeWipe`, `SplitScreen`) don't yet read `carriesFrom` / `carriesTo` / `outgoingSceneStyles` / `incomingSceneStyles`. Their `manifest.json` may need `consumes.*` flags set, and the component bodies need to consume the props. Draft per-component once their animation style is in context.
- The `outgoingSceneStyles` / `incomingSceneStyles` shape is currently just `{ background }`. If you want dominant asset color, typography token, etc., widen it — it's additive.
