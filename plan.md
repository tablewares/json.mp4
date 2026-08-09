All three ideas reduce to the same missing primitive: **right now, nothing resolved within a scene can see anything else resolved in that same scene.** `resolveScene` maps over `scene.assets` and produces each asset's `resolvedPosition`/`resolvedStyle`/`timing` in isolation — the only place the pipeline lets one resolved thing reference another is the pass-2 `buildTransitionBundle` cross-scene bundling for `carryAssetId`, and that's scoped specifically to "same asset id in two adjacent scenes," not general reference resolution.

So:

- **Highlighter trailing a KineticText** needs the highlighter's per-word position/timing derived from the text asset's already-computed `timing.words` and `resolvedPosition`.
- **Curvy line leading to another asset** needs its endpoint(s) derived from two other assets' `resolvedPosition`/`resolvedStyle` (for width/height/center).
- **Effect/camera event tied to when an asset "arrives"** needs to anchor to an asset's `enterAtFrame`/`exitAtFrame` or a camera action's resolved frame, not just `offsetPercent` of scene duration (which is all `effectTiming.js` currently understands).

That's one gap, not three. The fix is a single new pass, structurally identical to the existing carried-assets pattern but scoped *inside* `resolveScene` instead of across scenes:

**1. Two-pass resolution within a scene**

Pass 1 stays exactly as it is today — resolve every asset that doesn't declare a reference. Pass 2, new: for any asset/effect/camera-action that declares something like `refAssetId` (or `fromAssetId`/`toAssetId` for a connector), look it up in the pass-1 result map and compute its own geometry/timing from that. This is `buildTransitionBundle`'s trick, just moved one level in.

```js
// pipeline2-resolve/resolveRefs.js — single responsibility: resolve
// asset-to-asset references within one already-pass-1-resolved scene.
export function resolveSceneRefs(resolvedAssetsById, refSpecs) {
  return refSpecs.map((spec) => resolveOneRef(spec, resolvedAssetsById));
}
```

Ordering constraint: a referencing asset must be authored (and thus resolved) after its target within `scene.assets`. That's an acceptable authoring rule for `ProjectBuilder.addAsset` to enforce (throw if `refAssetId` isn't already in the scene) rather than a general topological sort — none of your three cases need chained references (A follows B follows C), and enforcing "target must exist first" is a one-line check consistent with how `carryAssetId` already requires the asset to be present in both scenes.

**2. Generalize `effectTiming.js` into an anchor resolver**

`resolveEffectFrame(offsetPercent, sceneDurationInFrames)` only understands "percent of scene end." Widen it to a small discriminated resolver that also accepts "relative to asset X's enter/exit" or "relative to camera action N's resolved frame":

```js
// still one function, still one file — just a wider input shape
export function resolveTimingAnchor(anchor, ctx) {
  if (anchor.relativeToAsset) {
    const a = ctx.resolvedAssetsById[anchor.relativeToAsset];
    const base = anchor.edge === "exit" ? a.timing.exitAtFrame : a.timing.enterAtFrame;
    return clamp(base + (anchor.offsetFrames ?? 0), 0, ctx.sceneDurationInFrames);
  }
  if (anchor.relativeToCameraAction) { /* look up resolved camera action frame */ }
  return resolveEffectFrame(anchor.offsetPercent ?? 0, ctx.sceneDurationInFrames); // existing behavior, untouched
}
```

Existing `effects: [{ offsetPercent }]` manifests keep working unchanged — `offsetPercent` stays the default branch, so this is additive per your no-op rule.

**3. Camera gets the same anchor upgrade**

`camera.js`'s `cameraAnchor` currently only resolves `{position, offsetXPercent, offsetYPercent}` against composition size. Add an alternate shape — `{ followAssetId, edge? }` — resolved against `ctx.resolvedAssetsById` the same way. That's what lets "camera snap-zooms onto asset X" and "shutter effect fires right before that zoom lands" share one coordinate system instead of you hand-computing percentages that drift whenever the asset's `enterAt` changes.

**Where each idea lands on top of this:**

- *Highlighter*: new asset (or `styleOverride` flag on an existing one) with `contentOverride.refAssetId` → pass 2 pulls the target's `timing.words`, generates its own per-word `enterAtFrame`/position segments from that array. No changes to `KineticText` itself needed — it already produces `timing.words`.
- *Curvy line*: new `Connector`/`LeaderLine` asset type with `fromAssetId`/`toAssetId` in its content schema → pass 2 computes both endpoints' centers from `resolvedPosition`/`resolvedStyle`, feeds them in as `content.points` (SVG path asset, similar shape to how `carryFrom`/`carryTo` get handed to `TransitionBoilerplate`).
- *Shutter-before-snap-zoom*: `transitionOut.effects[].offsetPercent` becomes optional in favor of `{ relativeToCameraAction: <index or id> }`; `camera.actions[].anchor` gains the `followAssetId` variant so the zoom target itself is asset-driven instead of a hardcoded anchor position.

This keeps every touched file doing the one thing it already does (`effectTiming.js` owns effect-frame math, `camera.js` owns camera math, a new `resolveRefs.js` owns cross-asset lookups) rather than smearing "look up another asset" logic into `resolve.js`'s `resolveScene`.

