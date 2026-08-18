// src/timing/buildTimeline.js
//
// Single-responsibility: derive a queryable, agent-facing global-frame
// timeline from a resolved manifest — the object `resolveProject()` returns
// (same shape as `studio/resolved.json`). This is deliberately fed the FULL
// resolved graph, not the pre-resolve manifest: camera/background/transition
// bundles, existing scene.effects[], and audioOverlay are already fully
// baked by the time resolve.js is done, so this module's only job is to
// project all of it onto one global-frame axis and expose it in a shape an
// agent can query WITHOUT re-deriving anchor/camera/style math itself.
//
// Every downstream consumer that needs "what does the final render look
// like at frame X, and where's a safe gap to inject something new" should
// build on this instead of re-deriving scene offsets or re-reading scene
// JSON files directly.
//
// Why this needs to exist at all: TransitionSeries.Sequence scenes overlap
// by their transitionOut.durationInFrames, so a scene's global start frame
// is NOT the naive sum of prior scenes' durationInFrames — you have to
// subtract each prior transition's overlap. asset timing.enterAtFrame /
// exitAtFrame are scene-local; this module lifts them onto the global axis.
// Same lift applies to scene.effects[] (already frame-anchored, scene-local)
// and audioOverlay (seconds, composition-global) — both are converted to
// the same global-frame axis assets live on, so an agent can reason about
// "what's playing at frame 900" across all three at once.
//
// Exposed (ESM) for:
//   - the `timeline` agent-cli command (read-only introspection)
//   - the `inject-effects` agent-cli command (fans scene-relative effects
//     out across every matching asset segment after scenes are built)
//   - ProjectBuilder.describeFrame / ProjectBuilder.findOpenFrameRanges —
//     the "where can I safely add something" queries an authoring agent
//     needs BEFORE calling addAsset/addTransitionEffect/injectTimelineEffects

/**
 * Projects a resolved camera block's `actions[].at` (0-1 progress along the
 * camera's OWN motion duration) onto scene-local frames, using the exact
 * same `motionDuration` formula resolveCameraTransform uses at render time
 * (camera.js) — duplicated here rather than imported, since this module
 * intentionally stays a pure read over resolved.json with no dependency on
 * the render-time transform math (only the timing half of it).
 *
 * @param {{actions?: Array, durationInFrames?: number, speed?: number}} camera
 * @param {number} sceneDurationInFrames
 * @returns {Array}  same action objects, each with a `localFrame` added
 */
function resolveCameraActionFrames(camera, sceneDurationInFrames) {
  if (!camera || !Array.isArray(camera.actions) || camera.actions.length === 0) return [];
  const motionDuration = camera.durationInFrames ?? Math.max(sceneDurationInFrames / (camera.speed ?? 1), 1);
  return camera.actions.map((action) => ({
    ...action,
    localFrame: motionDuration <= 1 ? 0 : Math.round(action.at * (motionDuration - 1)),
  }));
}

/**
 * Lifts one already-resolved scene.effects[] entry (output of
 * resolveSceneEffects — frame already baked, scene-local) into the shape
 * this module works in. sfx entries carry `frame`/`durationInFrames`
 * top-level; visual entries carry `timing.enterAtFrame/exitAtFrame` —
 * different shapes because they resolve through different branches of
 * resolveSceneEffects, normalized here into one consistent
 * localEnterFrame/localExitFrame pair.
 */
function normalizeEffect(effect, sceneId) {
  const isSfx = effect.kind === "sfx";
  const localEnterFrame = isSfx ? effect.frame : effect.timing.enterAtFrame;
  const localExitFrame = isSfx
    ? (effect.durationInFrames != null ? effect.frame + effect.durationInFrames : null)
    : effect.timing.exitAtFrame;
  return {
    id: effect.id,
    kind: effect.kind,
    sceneId,
    assetType: effect.assetType ?? null,
    path: effect.path ?? null,
    volume: effect.volume ?? null,
    content: effect.content ?? null,
    resolvedPosition: effect.resolvedPosition ?? null,
    resolvedStyle: effect.resolvedStyle ?? null,
    localEnterFrame,
    localExitFrame, // null == "plays/stays to file end / scene end" (sfx with no durationInFrames)
  };
}

/**
 * Build the global-frame timeline from a resolved manifest.
 *
 * @param {{ fps?: number, scenes?: any[], config?: { fps?: number }, audioOverlay?: any[] }} resolvedGraph
 *   Either `resolvedGraph.config.fps` (resolveProject output) or a top-level
 *   `fps` (stripped `studio/resolved.json` payload) is accepted;
 *   `config.fps` wins when both are present, falling back to 30.
 */
export function buildTimeline(resolvedGraph) {
  const config = resolvedGraph.config ?? {};
  const fps = config.fps ?? resolvedGraph.fps ?? 30;
  const scenes = resolvedGraph.scenes ?? [];

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
        // z isn't currently propagated onto resolved assets by resolveScene.js
        // (pre-existing gap upstream) — read defensively so this stays a
        // no-op today and picks it up for free if that's ever fixed.
        z: asset.z ?? 0,
        content: asset.content ?? {},
        resolvedPosition: asset.resolvedPosition ?? null,
        resolvedStyle: asset.resolvedStyle ?? null,
        hasMotion: Boolean(asset.resolvedMotion),
        hasPhysics: Boolean(asset.resolvedPhysics),
        localEnterFrame: timing.enterAtFrame,
        localExitFrame: timing.exitAtFrame,
        globalEnterFrame: startFrame + (timing.enterAtFrame ?? 0),
        globalExitFrame: startFrame + (timing.exitAtFrame ?? 0),
        hasWordTiming: Array.isArray(words) && words.length > 0,
        words: words || null,
      };
    });

    const effects = (scene.effects ?? []).map((effect) => {
      const normalized = normalizeEffect(effect, scene.id);
      return {
        ...normalized,
        globalEnterFrame: startFrame + (normalized.localEnterFrame ?? 0),
        globalExitFrame: normalized.localExitFrame != null ? startFrame + normalized.localExitFrame : null,
      };
    });

    const camera = scene.camera
      ? {
          speed: scene.camera.speed,
          durationInFrames: scene.camera.durationInFrames,
          easeZoom: scene.camera.easeZoom,
          actions: resolveCameraActionFrames(scene.camera, scene.durationInFrames).map((a) => ({
            ...a,
            globalFrame: startFrame + a.localFrame,
          })),
        }
      : null;

    timelineScenes.push({
      sceneId: scene.id,
      index,
      startFrame,
      endFrame,
      durationInFrames: scene.durationInFrames,
      background: scene.background ?? null,
      camera,
      narrationWords: scene.narrationWords ?? null,
      ttsWindow: scene.ttsWindow ?? null,
      transitionIn: scene.transitionIn
        ? { type: scene.transitionIn.type, durationInFrames: scene.transitionIn.durationInFrames, props: scene.transitionIn.props ?? {} }
        : null,
      transitionOut: scene.transitionOut
        ? { type: scene.transitionOut.type, durationInFrames: scene.transitionOut.durationInFrames, props: scene.transitionOut.props ?? {} }
        : null,
      assets,
      effects,
    });

    const overlap = scene.transitionOut ? scene.transitionOut.durationInFrames : 0;
    cursor = endFrame - overlap;
  });

  const totalDurationInFrames = cursor;

  // Composition-global audio (voiceover + manifest audioOverlay + music),
  // resolved in SECONDS by resolve.js — lifted onto the same frame axis
  // everything else here lives on, so an agent checking "what's playing at
  // frame 900" doesn't have to juggle a separate unit.
  const audioTracks = (resolvedGraph.audioOverlay ?? []).map((t) => ({
    id: t.id,
    path: t.path,
    volume: t.volume ?? 1,
    startSeconds: t.start,
    endSeconds: t.end,
    startFrame: Math.round((t.start ?? 0) * fps),
    endFrame: Math.round((t.end ?? 0) * fps),
  }));

  return {
    fps,
    totalDurationInFrames,
    totalDurationInSeconds: fps ? totalDurationInFrames / fps : 0,
    scenes: timelineScenes,
    audioTracks,
  };
}

/**
 * Generic asset-segment finder. `predicate(asset, scene)` decides
 * inclusion. Returns global (render-timeline) frame + second ranges, plus
 * enough resolved geometry/content for an agent to reason about the segment
 * without re-reading scene JSON.
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
          z: asset.z,
          content: asset.content,
          resolvedPosition: asset.resolvedPosition,
          resolvedStyle: asset.resolvedStyle,
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
 * Same shape as findAssetSegments, but over already-existing scene.effects[]
 * (sfx + visual). An agent should call this BEFORE injectTimelineEffects to
 * see what's already anchored in a scene — e.g. to avoid picking a frame
 * that collides with an existing SFX hit, or to avoid reusing an effect id.
 *
 * @param {ReturnType<typeof buildTimeline>} timeline
 * @param {(effect: any, scene: any) => boolean} predicate
 */
export function findEffectSegments(timeline, predicate) {
  const segments = [];
  for (const scene of timeline.scenes) {
    for (const effect of scene.effects) {
      if (predicate(effect, scene)) {
        segments.push({
          sceneId: scene.sceneId,
          effectId: effect.id,
          kind: effect.kind,
          assetType: effect.assetType,
          path: effect.path,
          startFrame: effect.globalEnterFrame,
          endFrame: effect.globalExitFrame,
        });
      }
    }
  }
  return segments;
}

/**
 * Snapshot of everything active at one global frame — the "what does the
 * final render actually look like right here" query. Meant to be called
 * with a CANDIDATE frame before injecting something new at it, or to sanity
 * check the result of a prior injection.
 *
 * `cameraActionIndex` names the most-recently-reached camera action at this
 * frame (not an interpolated transform — that needs anchor + composition
 * size resolution, which lives in camera.js's render-time path, out of
 * scope for a pure timeline read).
 *
 * @param {ReturnType<typeof buildTimeline>} timeline
 * @param {number} globalFrame
 */
export function describeFrame(timeline, globalFrame) {
  const scene =
    timeline.scenes.find((s) => globalFrame >= s.startFrame && globalFrame < s.endFrame) ??
    timeline.scenes[timeline.scenes.length - 1];
  if (!scene) return null;

  const sceneLocalFrame = globalFrame - scene.startFrame;

  const activeAssets = scene.assets.filter(
    (a) => sceneLocalFrame >= (a.localEnterFrame ?? 0) && sceneLocalFrame < (a.localExitFrame ?? scene.durationInFrames),
  );
  const activeEffects = scene.effects.filter((e) => {
    const enter = e.localEnterFrame ?? 0;
    const exit = e.localExitFrame;
    return sceneLocalFrame >= enter && (exit == null || sceneLocalFrame < exit);
  });
  const activeAudioTracks = (timeline.audioTracks ?? []).filter(
    (t) => globalFrame >= t.startFrame && globalFrame < t.endFrame,
  );

  let cameraActionIndex = null;
  if (scene.camera?.actions?.length) {
    scene.camera.actions.forEach((action, i) => {
      if (action.globalFrame <= globalFrame) cameraActionIndex = i;
    });
  }

  return {
    globalFrame,
    sceneId: scene.sceneId,
    sceneLocalFrame,
    background: scene.background,
    cameraActionIndex,
    activeAssets,
    activeEffects,
    activeAudioTracks,
  };
}

/**
 * Finds gaps within one scene not covered by any existing asset or effect's
 * on-screen window — the "where's a safe spot to inject" query, complementing
 * describeFrame's "what's happening at this specific frame".
 *
 * @param {ReturnType<typeof buildTimeline>} timeline
 * @param {string} sceneId
 * @param {{minGapFrames?: number, includeEffects?: boolean}} opts
 * @returns {Array<{sceneId, startFrame, endFrame, globalStartFrame, globalEndFrame, durationInFrames}>}
 */
export function findOpenFrameRanges(timeline, sceneId, opts = {}) {
  const { minGapFrames = 1, includeEffects = true } = opts;
  const scene = timeline.scenes.find((s) => s.sceneId === sceneId);
  if (!scene) throw new Error(`findOpenFrameRanges: unknown sceneId "${sceneId}"`);

  const occupied = scene.assets.map((a) => [a.localEnterFrame ?? 0, a.localExitFrame ?? scene.durationInFrames]);
  if (includeEffects) {
    for (const e of scene.effects) {
      occupied.push([e.localEnterFrame ?? 0, e.localExitFrame ?? scene.durationInFrames]);
    }
  }
  occupied.sort((a, b) => a[0] - b[0]);

  const gaps = [];
  let cursor = 0;
  for (const [start, end] of occupied) {
    if (start - cursor >= minGapFrames) gaps.push([cursor, start]);
    cursor = Math.max(cursor, end);
  }
  if (scene.durationInFrames - cursor >= minGapFrames) gaps.push([cursor, scene.durationInFrames]);

  return gaps.map(([start, end]) => ({
    sceneId,
    startFrame: start,
    endFrame: end,
    globalStartFrame: scene.startFrame + start,
    globalEndFrame: scene.startFrame + end,
    durationInFrames: end - start,
  }));
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