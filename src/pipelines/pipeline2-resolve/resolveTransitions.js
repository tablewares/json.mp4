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

  return bundle;
}