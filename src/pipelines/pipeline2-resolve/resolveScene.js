import { getAsset } from "../../registry/assetRegistry.js";
import { resolveColorToken, resolveAssetStyle, resolveBackground } from "../../registry/styleRegistry.js";
import { resolveAnchor } from "../../templating/anchor.js";
import { resolveCamera } from "../../templating/camera.js";
import { resolveMotion } from "../../motion/motion.js";
import { sceneTimingBudget } from "../../timing/ttsTiming.js";
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

  const resolvedAssets = (scene.assets ?? []).map((assetSpec) => {
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

    const enterAtFrame = Math.round((assetSpec.enterAt ?? 0) * timing.durationInFrames);
    const exitAtFrame = Math.min(
      Math.round((assetSpec.exitAt ?? 1) * timing.durationInFrames),
      timing.durationInFrames,
    );

    const wordTimings = resolveKineticWordTimings(assetSpec, assetManifest, timing.words, narrationText);
    return {
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
  });
  
  warnOnAssetOverlaps(scene.id, resolvedAssets, sceneDurationInFrames, {
    compositionSize,
    hasNarration,
  });

  resolveSceneRefs(resolvedAssets, { sceneId: scene.id, composition: compositionSize });
  const resolvedAssetsById = indexAssetsById(resolvedAssets);

  const camera = resolveCamera(scene.camera, {
    resolvedAssetsById,
    sceneId: scene.id,
  });

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