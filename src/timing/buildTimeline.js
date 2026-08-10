// src/timing/buildTimeline.js
//
// Single-responsibility: derive the absolute (global) frame timeline from a
// resolved manifest (the JSON that resolve.js emits — same shape as
// `studio/resolved.json`). Every downstream consumer that needs "where does X
// sit on the final render's frame axis" (SFX placement, overlap diagnostics,
// agent introspection, timeline-driven effect injection, etc.) should build on
// this instead of re-deriving scene offsets itself.
//
// Why this needs to exist at all: TransitionSeries.Sequence scenes overlap
// by their transitionOut.durationInFrames, so a scene's global start frame
// is NOT the naive sum of prior scenes' durationInFrames — you have to
// subtract each prior transition's overlap. asset timing.enterAtFrame /
// exitAtFrame are scene-local; this module lifts them onto the global axis.
//
// Exposed (ESM) for:
//   - the `timeline` agent-cli command (read-only introspection)
//   - the `inject-effects` agent-cli command (fans scene-relative effects out
//     across every matching asset segment after scenes are built)

/**
 * Build the global-frame timeline from a resolved manifest.
 *
 * @param {{ fps?: number, scenes?: any[], config?: { fps?: number } }} manifest
 *   Either `manifest.config.fps` (resolve.js output) or a top-level `fps`
 *   (stripped `studio/resolved.json` payload) is accepted; `config.fps`
 *   wins when both are present, falling back to 30.
 */
export function buildTimeline(manifest) {
  const config = manifest.config ?? {};
  const fps = config.fps ?? manifest.fps ?? 30;
  const scenes = manifest.scenes ?? [];

  let cursor = 0;
  const timelineScenes = [];

  scenes.forEach((scene, index) => {
    const startFrame = cursor;
    const endFrame = startFrame + scene.durationInFrames;

    const assets = (scene.assets ?? []).map((asset) => {
      const timing = asset.timing ?? {};
      const words = timing.words;
      return {
        id: asset.id,
        assetType: asset.assetType,
        sceneId: scene.id,
        localEnterFrame: timing.enterAtFrame,
        localExitFrame: timing.exitAtFrame,
        globalEnterFrame: startFrame + (timing.enterAtFrame ?? 0),
        globalExitFrame: startFrame + (timing.exitAtFrame ?? 0),
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
    totalDurationInSeconds: fps ? totalDurationInFrames / fps : 0,
    scenes: timelineScenes,
  };
}

/**
 * Generic segment finder. `predicate(asset, scene)` decides inclusion.
 * Returns global (render-timeline) frame + second ranges, ready to hand to
 * an SFX/effects layer.
 *
 * @param {ReturnType<typeof buildTimeline>} timeline
 * @param {(asset: any, scene: any) => boolean} predicate
 */
export function findAssetSegments(timeline, predicate) {
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
          startSeconds: timeline.fps ? asset.globalEnterFrame / timeline.fps : 0,
          endSeconds: timeline.fps ? asset.globalExitFrame / timeline.fps : 0,
        });
      }
    }
  }
  return segments;
}

/** Convenience wrapper: all segments of a given assetType, e.g. 'KineticText'. */
export function findByAssetType(timeline, assetType) {
  return findAssetSegments(timeline, (asset) => asset.assetType === assetType);
}

/**
 * Converts a global segment back into a scene-relative percentage offset —
 * the shape the scene-effects system anchors to (percentage-based timing
 * offset from scene boundaries). Use this when wiring an asset segment
 * (e.g. a KineticText line) into an `effects` entry that must stay anchored
 * to its parent scene rather than to absolute frames.
 *
 * Returns `{ sceneId, enterPercent, exitPercent }` where the percentages are
 * fractions of the scene's resolved durationInFrames (0 = scene start, 1 =
 * scene's visible end frame — the same axis `transitionOut.effects[].offsetPercent`
 * reads, with 0 anchored at that visible end frame).
 *
 * To convert to a boundary-anchor `offsetPercent` (the shape `add-effect`
 * writes), subtract 1: `offsetPercent = enterPercent - 1` places the effect
 * at the segment's enter frame relative to the scene's end boundary.
 */
export function segmentToSceneEffectAnchor(timeline, segment) {
  const scene = timeline.scenes.find((s) => s.sceneId === segment.sceneId);
  if (!scene) {
    throw new Error(`segmentToSceneEffectAnchor: unknown sceneId "${segment.sceneId}"`);
  }
  const duration = scene.durationInFrames;
  const localStart = duration ? (segment.startFrame - scene.startFrame) / duration : 0;
  const localEnd = duration ? (segment.endFrame - scene.startFrame) / duration : 0;
  return {
    sceneId: scene.sceneId,
    enterPercent: localStart,
    exitPercent: localEnd,
  };
}
