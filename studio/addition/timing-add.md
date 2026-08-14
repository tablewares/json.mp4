Here's the implementation. It moves camera resolution earlier (safe — `resolveCamera` never actually reads its `ctx` param) so `enterAt`/`exitAt` anchors can reference camera actions, and switches the asset loop from `.map` to an incremental build so `enterAt`/`exitAt` anchors can reference an *earlier* asset in the same scene — same ordering rule `checkAssetRefs` already enforces elsewhere.

## `src/pipelines/pipeline2-resolve/resolveScene.js`

```js
import { getAsset } from "../../registry/assetRegistry.js";
import { resolveColorToken, resolveAssetStyle, resolveBackground } from "../../registry/styleRegistry.js";
import { resolveAnchor } from "../../templating/anchor.js";
import { resolveCamera } from "../../templating/camera.js";
import { resolveMotion } from "../../motion/motion.js";
import { sceneTimingBudget } from "../../timing/ttsTiming.js";
import { resolveTimingAnchor } from "../../timing/effectTiming.js";
import { indexAssetsById, resolveSceneRefs } from "./resolveRefs.js";
import { warnOnAssetOverlaps } from "./overlap_warn.js";

function resolveKineticWordTimings(assetSpec, assetManifest, sceneWords, narrationText) {
  if (assetSpec.assetType !== "KineticText" || !sceneWords?.length || !narrationText) return null;
  
  const useNarrationTiming =
    assetSpec.styleOverride?.useNarrationTiming ?? assetManifest.defaultStyle?.useNarrationTiming ?? true;
  if (!useNarrationTiming) return null;

  const assetText = (assetSpec.contentOverride?.text ?? "").trim();
  if (assetText !== narrationText.trim()) return null;

  const assetWordCount = assetText.split(/\s+/).filter(Boolean).length;
  if (assetWordCount !== sceneWords.length) return null;

  return sceneWords.map((w) => ({ word: w.word, startFrame: w.startFrame, endFrame: w.endFrame }));
}

/**
 * Resolves one asset's enterAt/exitAt into a concrete scene-local frame.
 *
 * Legacy form (unchanged): a bare number, 0-1, fraction of
 * `timing.durationInFrames`. `enterAt` defaults to 0, `exitAt` to 1 —
 * exactly the pre-existing behavior, byte-identical output.
 *
 * New form: an object — the SAME timing-anchor vocabulary
 * transitionOut.effects already accepts (shared.schema.json#/definitions/
 * timingAnchor): `{ relativeToAsset, edge?, offsetFrames? }`,
 * `{ relativeToCameraAction, offsetFrames? }`, or `{ offsetPercent }`. Lets
 * an asset's entrance/exit be anchored to another asset's edge or a camera
 * action instead of a hand-guessed fraction. Resolved via the same
 * `resolveTimingAnchor` transition effects use, so the semantics (and the
 * "target must be resolved earlier in scene.assets" ordering rule) are
 * identical across both call sites.
 *
 * `exitAtFrame`'s legacy branch keeps its original `Math.min` clamp;
 * `resolveTimingAnchor`'s anchor branches already clamp to
 * [0, ctx.sceneDurationInFrames] internally, so no double-clamping is
 * needed there.
 */
function resolveAssetEdgeFrame(raw, defaultFraction, ctx) {
  if (raw != null && typeof raw === "object") {
    return resolveTimingAnchor(raw, ctx);
  }
  const fraction = raw ?? defaultFraction;
  return Math.round(fraction * ctx.sceneDurationInFrames);
}

export function resolveScene(scene, { styles, assetRegistry, config, timingById, narrationTextById, hasNarration, isLastScene }) {
  const timing =
    hasNarration && scene.narrationRef
      ? sceneTimingBudget(scene.narrationRef, timingById)
      : { durationInFrames: config.defaultSceneDurationInFrames ?? 90 };

  const transitionPadding =
    !isLastScene && hasNarration && scene.narrationRef
      ? scene.transitionOut?.durationInFrames ?? 0
      : 0;
  const sceneDurationInFrames = timing.durationInFrames + transitionPadding;

  const compositionSize = { width: config.width, height: config.height };
  const narrationText = scene.narrationRef ? narrationTextById[scene.narrationRef] : null;

  // Resolved BEFORE the asset loop so enterAt/exitAt timing anchors can
  // reference a camera action's frame. Safe to move earlier: resolveCamera
  // never reads the ctx argument it's given (only render-time
  // resolveCameraTransform needs resolvedAssetsById, for followAssetId
  // anchors), so calling it here produces byte-identical output to calling
  // it after assets are resolved, as the code did before this change.
  const camera = resolveCamera(scene.camera, { sceneId: scene.id });

  // Built up as assets resolve so a later asset's enterAt/exitAt can
  // anchor to an EARLIER asset's edge — same "target must come first"
  // ordering rule resolveRefs.js's connector resolution and
  // ProjectBuilder's checkAssetRefs already enforce. Assets are looked up
  // here by their pass-1 (position/style/no-timing-anchor-yet) resolved
  // shape, which already has resolvedPosition/resolvedStyle populated —
  // exactly what resolveAssetRelative in effectTiming.js needs.
  const resolvedAssetsById = {};
  const resolvedAssets = [];

  for (const assetSpec of scene.assets ?? []) {
    const { manifest: assetManifest } = getAsset(assetRegistry, assetSpec.assetType);
    const size = {
      width: assetSpec.styleOverride?.width ?? assetManifest.defaultSize.width,
      height: assetSpec.styleOverride?.height ?? assetManifest.defaultSize.height,
    };
    const resolvedPosition = resolveAnchor(assetSpec.anchor, compositionSize, size);
    const resolvedStyle = {
      ...resolveAssetStyle(styles, assetManifest, assetSpec.styleOverride),
      ...size,
      backgroundColor: assetSpec.styleOverride?.backgroundColorToken
        ? resolveColorToken(styles, assetSpec.styleOverride.backgroundColorToken)
        : undefined,
    };

    const timingAnchorCtx = {
      sceneDurationInFrames: timing.durationInFrames,
      resolvedAssetsById,
      camera,
      sceneId: scene.id,
    };
    const enterAtFrame = resolveAssetEdgeFrame(assetSpec.enterAt, 0, timingAnchorCtx);
    const exitAtFrame =
      assetSpec.exitAt != null && typeof assetSpec.exitAt === "object"
        ? resolveAssetEdgeFrame(assetSpec.exitAt, 1, timingAnchorCtx)
        : Math.min(
            Math.round((assetSpec.exitAt ?? 1) * timing.durationInFrames),
            timing.durationInFrames,
          );

    const wordTimings = resolveKineticWordTimings(assetSpec, assetManifest, timing.words, narrationText);
    const resolvedAsset = {
      id: assetSpec.id ?? `${assetSpec.assetType}-${Math.random().toString(36).slice(2, 8)}`,
      assetType: assetSpec.assetType,
      componentPath: assetRegistry[assetSpec.assetType].componentPath,
      content: assetSpec.contentOverride ?? {},
      resolvedPosition,
      resolvedStyle,
      resolvedMotion: resolveMotion(assetSpec.motion),
      timing: {
        durationInFrames: sceneDurationInFrames,
        enterAtFrame,
        exitAtFrame,
        words: wordTimings,
      },
    };

    resolvedAssets.push(resolvedAsset);
    if (resolvedAsset.id != null) resolvedAssetsById[resolvedAsset.id] = resolvedAsset;
  }
  
  warnOnAssetOverlaps(scene.id, resolvedAssets, sceneDurationInFrames, {
    compositionSize,
    hasNarration,
  });

  // resolveSceneRefs/indexAssetsById still run as a distinct pass-2 over the
  // FULL resolved array (unchanged) — content/connector resolution is
  // allowed to reference forward within the same loop-completed set exactly
  // as before; only enterAt/exitAt timing anchors above are restricted to
  // "earlier in scene.assets", since those had to resolve incrementally.
  resolveSceneRefs(resolvedAssets, { sceneId: scene.id, composition: compositionSize });

  return {
    id: scene.id,
    durationInFrames: sceneDurationInFrames,
    effects: [],
    camera,
    ttsWindow: hasNarration
      ? {
          narrationRef: scene.narrationRef,
          startSeconds: timing.startSeconds,
          endSeconds: timing.endSeconds,
          startFrame: timing.startFrame,
          endFrame: timing.endFrame,
        }
      : null,
    background: scene.background ? resolveBackground(styles, scene.background) : undefined,
    assets: resolvedAssets,
    transitionIn: null,
    transitionOut: null,
  };
}
```

Note the final `indexAssetsById(resolvedAssets)` call is gone — `resolvedAssetsById` is now built incrementally during the loop and already covers every asset by the time `resolveSceneRefs` runs after it, so the separate full-array indexing pass was redundant. `indexAssetsById` is still imported/used elsewhere (`resolveRefs.js` itself, `resolveTransitions.js`), so no export changes needed.

## `src/pipelines/pipeline1-validate/schema/scene.schema.json`

`enterAt`/`exitAt` now accept the legacy fraction **or** the shared timing-anchor object:

```json
          "enterAt": {
            "oneOf": [
              { "type": "number", "minimum": 0, "maximum": 1 },
              { "$ref": "shared.schema.json#/definitions/timingAnchor" }
            ],
            "description": "Legacy: fraction (0-1) of the scene's TTS/duration window, default 0. Or a timing anchor: { relativeToAsset, edge?, offsetFrames? } to fire relative to an earlier asset's enter/exit edge, { relativeToCameraAction, offsetFrames? } to fire relative to a camera action, or { offsetPercent } for a scene-end-relative percent. The referenced asset must be authored EARLIER in scene.assets."
          },
          "exitAt": {
            "oneOf": [
              { "type": "number", "minimum": 0, "maximum": 1 },
              { "$ref": "shared.schema.json#/definitions/timingAnchor" }
            ],
            "description": "Same shape as enterAt; legacy default 1 (scene's TTS/duration window end)."
          },
```

## `src/agent/validators.js`

A `checkTimingAnchor` matching the existing `checkCameraSpec`/`checkMotionSpec` pattern, so `addAsset`/`updateAsset` can surface a bad anchor object as a non-fatal warning instead of only failing at `resolve`:

```js
/**
 * Caches a compiled `shared.schema.json#/definitions/timingAnchor` validator
 * for the NEW enterAt/exitAt object form. A bare number (the legacy
 * fraction form) is always valid and short-circuits without touching Ajv.
 * Returns [] when clean, or human-readable error strings when not — same
 * contract as checkCameraSpec/checkMotionSpec.
 */
let _cachedTimingAnchorValidator = null;
export function checkTimingAnchor(value) {
  if (value == null || typeof value !== "object") return []; // legacy number form, or omitted
  if (_cachedTimingAnchorValidator === null) {
    const ajv = loadSchemaAjv();
    // shared.schema.json isn't registered under its own $id by
    // loadSchemaAjv's sibling loop when only scene.schema.json is the
    // entry point being resolved — it IS one of the three siblings
    // scene.schema.json $refs, so it's already added; getSchema just
    // needs the fragment path.
    _cachedTimingAnchorValidator = ajv.getSchema("shared.schema.json#/definitions/timingAnchor");
  }
  if (_cachedTimingAnchorValidator(value)) return [];
  return (_cachedTimingAnchorValidator.errors || []).map((e) => `${e.instancePath || "(root)"} ${e.message}`);
}
```

Wired into `ProjectBuilder.addAsset`/`updateAsset` warnings (in `src/agent/ProjectBuilder.js`), alongside the existing motion checks:

```js
    const warnings = [
      ...checkAgainstSchema(entry.manifest.contentOverrideSchema, asset.contentOverride),
      ...checkMotionSpec(asset.motion),
      ...checkMotionAliases(asset.motion),
      ...checkTimingAnchor(asset.enterAt),
      ...checkTimingAnchor(asset.exitAt),
    ];
```

(applies identically in both `addAsset` and `updateAsset`; add `checkTimingAnchor` to the existing import line from `./validators.js`).

## `src/agent/introspect.js`

`describeSceneEnvelope`'s `asset.enterAt`/`exitAt` doc strings, so an agent discovers this via `agent-cli.mjs` instead of reading source:

```js
      enterAt: "fraction 0-1 of the scene's duration (default 0), OR a timing anchor object: { relativeToAsset, edge?: 'enter'|'exit', offsetFrames? } to fire relative to an EARLIER asset's edge, { relativeToCameraAction, offsetFrames? } to fire relative to a camera action, or { offsetPercent } for scene-end-relative percent — same shape as transitionEffect timing anchors",
      exitAt: "same shape as enterAt; legacy default 1 (scene end)",
```

## Example: no more guessed fractions

A highlighter that should enter exactly when the caption it trails finishes its own entrance, not at some hand-picked `0.34`:

```json
{
  "id": "caption-1",
  "assetType": "KineticText",
  "anchor": { "position": "center" },
  "enterAt": 0.1
}
```
```json
{
  "id": "highlighter-1",
  "assetType": "TextHighlight",
  "anchor": { "position": "center" },
  "contentOverride": { "refAssetId": "caption-1" },
  "enterAt": { "relativeToAsset": "caption-1", "edge": "enter", "offsetFrames": 6 }
}
```

`highlighter-1` must still be authored after `caption-1` in `scene.assets` — same rule as connectors — and `resolveAssetEdgeFrame` will throw the same descriptive "known asset ids" error `resolveAssetRelative` already gives if it isn't.