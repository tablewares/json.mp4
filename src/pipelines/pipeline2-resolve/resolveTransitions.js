import { getAsset } from "../../registry/assetRegistry.js";
import { resolveAssetStyle } from "../../registry/styleRegistry.js";
import { resolveAnchor } from "../../templating/anchor.js";
import { resolveTimingAnchor } from "../../timing/effectTiming.js";
import { indexAssetsById } from "./resolveRefs.js";

/**
 * Resolves a scene's transitionOut.effects into render-ready entries.
 */
export function resolveTransitionEffects(effectsSpec, outgoingScene, styles, assetRegistry, compositionSize) {
  if (!Array.isArray(effectsSpec) || effectsSpec.length === 0) return [];

  const resolvedAssetsById = indexAssetsById(outgoingScene.assets ?? []);
  const timingCtx = {
    sceneDurationInFrames: outgoingScene.durationInFrames,
    resolvedAssetsById,
    camera: outgoingScene.camera,
    words: outgoingScene.narrationWords,
    sceneId: outgoingScene.id,
  };

  return effectsSpec.map((effect, i) => {
    const timingAnchor = effect.timing ?? effect;
    const frame = resolveTimingAnchor(timingAnchor, timingCtx);

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
        exitAtFrame: Math.min(frame + durationInFrames, outgoingScene.durationInFrames),
      },
    };
  });
}

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