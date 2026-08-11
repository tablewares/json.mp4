Here's the implementation. Only `resolveTransitions.js` changes — everything else (schema, registry scanning, `ProjectBuilder`, `introspect.js`) already treats `params`/`consumes` as opaque passthrough objects, so no other file needs touching.

**`src/pipelines/pipeline2-resolve/resolveTransitions.js`** — new/changed code in `buildTransitionBundle`:

```js
export function buildTransitionBundle(transitionSpec, outgoingScene, incomingScene, transitionRegistry) {
  const type = transitionSpec?.type ?? "default";
  const { manifest: transitionManifest } = transitionRegistry[type] ?? transitionRegistry["default"];
  const durationInFrames = transitionSpec?.durationInFrames ?? transitionManifest.defaultDurationInFrames;

  const bundle = {
    type,
    durationInFrames,
    componentPath: (transitionRegistry[type] ?? transitionRegistry["default"]).componentPath,
    props: { ...(transitionSpec?.params ?? {}) },
  };

  // Existing single-asset continuity path — byte-identical, untouched.
  if (transitionManifest.consumes?.carriedAssets && transitionSpec?.params?.carryAssetId) {
    const carryId = transitionSpec.params.carryAssetId;
    const carryFrom = outgoingScene.assets.find((a) => a.id === carryId);
    const carryTo = incomingScene.assets.find((a) => a.id === carryId);
    if (!carryFrom || !carryTo) {
      throw new Error(
        `Transition "${type}" on scene "${outgoingScene.id}" requested carryAssetId "${carryId}" ` +
          `but it wasn't found in both the outgoing and incoming scene.`,
      );
    }
    bundle.props.carryFrom = { ...carryFrom.resolvedPosition, ...carryFrom.resolvedStyle };
    bundle.props.carryTo = { ...carryTo.resolvedPosition, ...carryTo.resolvedStyle };
  }

  // NEW: multi-asset continuity. Gated on the SAME `consumes.carriedAssets`
  // flag (a transition that tracks one carried element can track several
  // without a new manifest flag) — only activates when the spec author
  // supplies the plural `carryAssetIds` array param, so any transition/spec
  // using the singular `carryAssetId` above is completely unaffected.
  // Resolved into `carriesFrom`/`carriesTo` — keyed-by-id maps rather than
  // arrays, so a transition component can do `carriesFrom[id]` directly
  // instead of re-deriving an index -> id mapping.
  if (transitionManifest.consumes?.carriedAssets && Array.isArray(transitionSpec?.params?.carryAssetIds)) {
    const carryIds = transitionSpec.params.carryAssetIds;
    bundle.props.carriesFrom = {};
    bundle.props.carriesTo = {};
    for (const carryId of carryIds) {
      const carryFrom = outgoingScene.assets.find((a) => a.id === carryId);
      const carryTo = incomingScene.assets.find((a) => a.id === carryId);
      if (!carryFrom || !carryTo) {
        throw new Error(
          `Transition "${type}" on scene "${outgoingScene.id}" requested carryAssetIds including "${carryId}" ` +
            `but it wasn't found in both the outgoing and incoming scene.`,
        );
      }
      bundle.props.carriesFrom[carryId] = { ...carryFrom.resolvedPosition, ...carryFrom.resolvedStyle };
      bundle.props.carriesTo[carryId] = { ...carryTo.resolvedPosition, ...carryTo.resolvedStyle };
    }
  }

  // NEW: wires the previously-dead `consumes.outgoingSceneStyles` /
  // `consumes.incomingSceneStyles` manifest flags. `outgoingScene`/
  // `incomingScene` are already fully-resolved scene objects at this point
  // in resolve.js's pass-2 loop, so their `.background` is already resolved
  // to a real color/texture (via resolveBackground) — no extra `styles`
  // registry plumbing needed here. Scoped to `{ background }` for now,
  // since background is the only genuinely per-scene "style" today
  // (typography/color tokens are project-wide, not scene-scoped); extend
  // this object if a scene-level style surface grows later.
  if (transitionManifest.consumes?.outgoingSceneStyles) {
    bundle.props.outgoingSceneStyles = { background: outgoingScene.background };
  }
  if (transitionManifest.consumes?.incomingSceneStyles) {
    bundle.props.incomingSceneStyles = { background: incomingScene.background };
  }

  return bundle;
}
```

**Assumptions/out-of-scope flags:**

- I don't have `pivotZoom`'s (or `irisWipe`'s/`shatterWipe`'s) `manifest.json`/component in context, so I haven't touched them. To actually use `carryAssetIds` or the scene-styles props, their `manifest.json` needs `consumes.outgoingSceneStyles`/`incomingSceneStyles: true` set (already schematically valid — `consumes` is read as a plain object, no schema constrains its keys), and the component needs to read `props.carriesFrom`/`props.carriesTo`/`props.outgoingSceneStyles`/`props.incomingSceneStyles`. Say the word and I'll draft that component logic too, once I can see the existing `pivotZoom` component to match its animation style.
- `outgoingSceneStyles`/`incomingSceneStyles` shape is currently just `{ background }` — a guess at what's most immediately useful (color-matched wipes). If you had something else in mind (e.g. dominant asset color, typography token), tell me and I'll widen it — it's additive either way.
- No schema changes were needed: `transition.schema.json`'s `params: { "type": "object" }` is already unconstrained, so `carryAssetIds` validates today with zero schema edits.