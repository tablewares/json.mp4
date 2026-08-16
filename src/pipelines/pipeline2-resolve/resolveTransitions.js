import { getAsset } from "../../registry/assetRegistry.js";
import { resolveAssetStyle } from "../../registry/styleRegistry.js";
import { resolveAnchor } from "../../templating/anchor.js";
import { resolveTimingAnchor } from "../../timing/effectTiming.js";
import { indexAssetsById } from "./resolveRefs.js";

const clampFrame = (frame, sceneDurationInFrames) =>
  Math.max(0, Math.min(sceneDurationInFrames, Math.round(frame)));

/**
 * Resolves a scene's authored `effects[]` (the detached, scene-level effects
 * owned by `effects.schema.json`) into render-ready entries keyed by an exact
 * scene-local frame.
 *
 * Timing resolution rules (in priority order, per effect):
 *   1. `effect.frame` (number) — the new explicit-frame shape. The effect fires
 *      at exactly that frame. This is the form `ProjectBuilder.injectTimelineEffects`
 *      writes after seeing the resolved timeline.
 *   2. `effect.timing` (a timingAnchor object) — backward-compat legacy shape
 *      carried over from the pre-refactor `transitionOut.effects` location. Routed
 *      through `resolveTimingAnchor` (offsetPercent / relativeToAsset /
 *      relativeToCameraAction / relativeToWord) so the 7 migrated studio manifests
 *      that still author `timing` keep rendering byte-identically.
 *   3. `effect.offsetPercent` (number) on the bare effect — the oldest legacy form
 *      (`{ kind, offsetPercent }` with no `timing` wrapper). Also routed through
 *      the same legacy resolver for byte-identical behavior.
 *
 * Visual effects resolve their own `AssetComponent` positioned by anchor exactly as
 * before. The output shape (consumed by `Composition.jsx` SceneEffectLayer + the
 * composition-root SFX <Sequence><Audio> loop) is unchanged from the prior
 * `resolveTransitionEffects` output.
 */
export function resolveSceneEffects(effectsSpec, scene, styles, assetRegistry, compositionSize) {
  if (!Array.isArray(effectsSpec) || effectsSpec.length === 0) return [];

  const sceneDurationInFrames = scene.durationInFrames;
  const resolvedAssetsById = indexAssetsById(scene.assets ?? []);
  const timingCtx = {
    sceneDurationInFrames,
    resolvedAssetsById,
    camera: scene.camera,
    words: scene.narrationWords,
    sceneId: scene.id,
  };

  return effectsSpec.map((effect, i) => {
    // Frame resolution: explicit `frame` wins, then legacy `timing`, then bare
    // `offsetPercent`. The output `frame` is always clamped to the scene's
    // [0, durationInFrames] window so a hand-authored or injected value can
    // never slip past the cut.
    let frame;
    if (typeof effect.frame === "number") {
      frame = clampFrame(effect.frame, sceneDurationInFrames);
    } else if (effect.timing) {
      frame = resolveTimingAnchor(effect.timing, timingCtx);
    } else {
      frame = resolveTimingAnchor(effect.offsetPercent ?? 0, timingCtx);
    }

    if (effect.kind === "sfx") {
      return {
        id: effect.id ?? `sfx-${i}`,
        kind: "sfx",
        frame,
        durationInFrames: effect.durationInFrames ?? null,
        path: effect.path,
        volume: effect.volume ?? 1,
      };
    }

    // kind === "visual"
    const { manifest: assetManifest } = getAsset(assetRegistry, effect.assetType);
    const size = {
      width: effect.styleOverride?.width ?? assetManifest.defaultSize.width,
      height: effect.styleOverride?.height ?? assetManifest.defaultSize.height,
    };
    const anchor = effect.anchor ?? { position: "center", offsetXPercent: 0, offsetYPercent: 0 };
    const resolvedPosition = resolveAnchor(anchor, compositionSize, size);
    const resolvedStyle = {
      ...resolveAssetStyle(styles, assetManifest, effect.styleOverride),
      ...size,
    };
    const durationInFrames = effect.durationInFrames ?? 30;

    return {
      id: effect.id ?? `fx-${i}`,
      kind: "visual",
      assetType: effect.assetType,
      content: effect.contentOverride ?? {},
      resolvedPosition,
      resolvedStyle,
      timing: {
        durationInFrames,
        enterAtFrame: frame,
        exitAtFrame: Math.min(frame + durationInFrames, sceneDurationInFrames),
      },
    };
  });
}

// Backward-compat alias. The pre-refactor name this module exported was
// `resolveTransitionEffects`; resolve.js imports by that name. Keeping the
// alias means consumers that still call the old symbol (including any
// reference docs / snapshots) keep working without a coordinated rename.
export const resolveTransitionEffects = resolveSceneEffects;

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
