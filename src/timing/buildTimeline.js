/**
 * timeline.js
 *
 * Single-responsibility: derive the absolute (global) frame timeline from a
 * resolved manifest (the JSON that resolve.js emits — same shape as
 * `resolved.json`). Every downstream consumer that needs "where does X sit
 * on the final render's frame axis" (SFX placement, overlap diagnostics,
 * agent introspection, etc.) should build on this instead of re-deriving
 * scene offsets itself.
 *
 * Why this needs to exist at all: TransitionSeries.Sequence scenes overlap
 * by their transitionOut.durationInFrames, so a scene's global start frame
 * is NOT the naive sum of prior scenes' durationInFrames — you have to
 * subtract each prior transition's overlap. asset timing.enterAtFrame /
 * exitAtFrame are scene-local; this module lifts them onto the global axis.
 */

function buildTimeline(manifest) {
  const { scenes, config } = manifest;
  const fps = config.fps;

  let cursor = 0;
  const timelineScenes = [];

  scenes.forEach((scene, index) => {
    const startFrame = cursor;
    const endFrame = startFrame + scene.durationInFrames;

    const assets = scene.assets.map((asset) => {
      const words = asset.timing && asset.timing.words;
      return {
        id: asset.id,
        assetType: asset.assetType,
        sceneId: scene.id,
        localEnterFrame: asset.timing.enterAtFrame,
        localExitFrame: asset.timing.exitAtFrame,
        globalEnterFrame: startFrame + asset.timing.enterAtFrame,
        globalExitFrame: startFrame + asset.timing.exitAtFrame,
        hasWordTiming: Array.isArray(words) && words.length > 0,
        words: words || null,
      };
    });

    timelineScenes.push({
      sceneId: scene.id,
      index,
      startFrame,
      endFrame,
      durationInFrames: scene.durationInFrames,
      transitionIn: scene.transitionIn
        ? { type: scene.transitionIn.type, durationInFrames: scene.transitionIn.durationInFrames }
        : null,
      transitionOut: scene.transitionOut
        ? { type: scene.transitionOut.type, durationInFrames: scene.transitionOut.durationInFrames }
        : null,
      assets,
    });

    const overlap = scene.transitionOut ? scene.transitionOut.durationInFrames : 0;
    cursor = endFrame - overlap;
  });

  const totalDurationInFrames = cursor;

  return {
    fps,
    totalDurationInFrames,
    totalDurationInSeconds: totalDurationInFrames / fps,
    scenes: timelineScenes,
  };
}

/**
 * Generic segment finder. `predicate(asset, scene)` decides inclusion.
 * Returns global (render-timeline) frame + second ranges, ready to hand to
 * an SFX/effects layer.
 */
function findAssetSegments(timeline, predicate) {
  const segments = [];
  for (const scene of timeline.scenes) {
    for (const asset of scene.assets) {
      if (predicate(asset, scene)) {
        segments.push({
          sceneId: scene.sceneId,
          assetId: asset.id,
          assetType: asset.assetType,
          startFrame: asset.globalEnterFrame,
          endFrame: asset.globalExitFrame,
          startSeconds: asset.globalEnterFrame / timeline.fps,
          endSeconds: asset.globalExitFrame / timeline.fps,
        });
      }
    }
  }
  return segments;
}

/** Convenience wrapper: all segments of a given assetType, e.g. 'KineticText'. */
function findByAssetType(timeline, assetType) {
  return findAssetSegments(timeline, (asset) => asset.assetType === assetType);
}

/**
 * Converts a global segment back into a scene-relative percentage offset —
 * the shape the scene-effects system anchors to (percentage-based timing
 * offset from scene boundaries). Use this when wiring an asset segment
 * (e.g. a KineticText line) into an `effects` entry that must stay anchored
 * to its parent scene rather than to absolute frames.
 */
function segmentToSceneEffectAnchor(timeline, segment) {
  const scene = timeline.scenes.find((s) => s.sceneId === segment.sceneId);
  if (!scene) {
    throw new Error(`segmentToSceneEffectAnchor: unknown sceneId "${segment.sceneId}"`);
  }
  const localStart = segment.startFrame - scene.startFrame;
  const localEnd = segment.endFrame - scene.startFrame;
  return {
    sceneId: scene.sceneId,
    startPercent: localStart / scene.durationInFrames,
    endPercent: localEnd / scene.durationInFrames,
  };
}

module.exports = {
  buildTimeline,
  findAssetSegments,
  findByAssetType,
  segmentToSceneEffectAnchor,
};