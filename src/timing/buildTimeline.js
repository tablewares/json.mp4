/**
 * Turns a resolved scene graph (the output of pipeline2, aka resolved.json)
 * into a single global-timeline report: where each scene, each asset, each
 * transition, and the voiceover resolve across the whole rendered video — in
 * both frames and seconds.
 *
 * Pure function. No I/O, no side effects, no external services. The render
 * pipeline calls this right after a successful render and writes the result
 * to out/timing.json. Keeping it pure means it can be unit-tested and reused
 * (e.g. a dry-run timeline preview without rendering).
 *
 * Timeline math matches Remotion's `TransitionSeries`: each scene's start
 * frame is pushed back by every preceding transition's duration (the overlap
 * the transition consumes). Total duration = Σ scene durations − Σ
 * INTERMEDIATE transition durations (a trailing transitionOut on the last
 * scene has no successor, so it is not subtracted), giving the end frame of
 * the last scene's TTS narration window == the synthesized audio length.
 *
 * @param {{ scenes: any[], audioOverlay?: any[], config: { fps: number } }} resolvedGraph
 * @returns {{
 *   fps: number,
 *   totalFrames: number,
 *   totalSeconds: number,
 *   scenes: Array,
 *   assets: Array,
 *   transitions: Array,
 *   voiceover: Array,
 * }}
 */
export function buildTimeline(resolvedGraph) {
  const fps = resolvedGraph.config.fps;
  const scenes = resolvedGraph.scenes ?? [];
  const audioOverlay = resolvedGraph.audioOverlay ?? [];

  // 1) Resolve each scene's global start/end frame, accounting for the
  //    transition overlap that TransitionSeries subtracts.
  const scenePlacements = [];
  let accumulated = 0; // Σ durations minus the transitions already absorbed
  for (let i = 0; i < scenes.length; i += 1) {
    const scene = scenes[i];
    const outDur = scene.transitionOut?.durationInFrames ?? 0;
    const startFrame = accumulated;
    const endFrame = startFrame + scene.durationInFrames;
    scenePlacements.push({
      sceneIndex: i,
      sceneId: scene.id,
      startFrame,
      endFrame,
      startSeconds: startFrame / fps,
      endSeconds: endFrame / fps,
      durationInFrames: scene.durationInFrames,
      transitionOut: scene.transitionOut ?? null,
      transitionIn: scene.transitionIn ?? null,
    });
    // next scene starts one transition-dur earlier (the overlap). A trailing
    // transitionOut on the LAST scene has no successor, so it does NOT consume
    // the shared window — only intermediate transitions overlap.
    accumulated += scene.durationInFrames - (i < scenes.length - 1 ? outDur : 0);
  }
  const totalFrames = accumulated;

  // 2) Per-asset global placement, relative to its scene's global start frame.
  const assets = [];
  for (const sp of scenePlacements) {
    const scene = scenes[sp.sceneIndex];
    for (const asset of scene.assets ?? []) {
      const enterGlobal = sp.startFrame + (asset.timing?.enterAtFrame ?? 0);
      const exitGlobal = sp.startFrame + (asset.timing?.exitAtFrame ?? sp.endFrame);
      assets.push({
        sceneId: scene.id,
        sceneIndex: sp.sceneIndex,
        assetId: asset.id,
        assetType: asset.assetType,
        startFrame: enterGlobal,
        endFrame: exitGlobal,
        startSeconds: enterGlobal / fps,
        endSeconds: exitGlobal / fps,
      });
    }
  }

  // 3) Per-transition global placement. A transition between scene N and
  //    N+1 occupies the overlap region: it starts where scene N's tail meets
  //    scene N+1's head. By the TransitionSeries math, scene N+1 starts at
  //    `sp_n.endFrame - transition.duration`, so the transition spans
  //    [scene N+1 start, scene N+1 start + transition.duration].
  const transitions = [];
  for (let i = 0; i < scenePlacements.length - 1; i += 1) {
    const prev = scenePlacements[i];
    const next = scenePlacements[i + 1];
    const tr = prev.transitionOut;
    if (!tr || !tr.durationInFrames) continue;
    const startFrame = next.startFrame; // overlap begins where next scene begins
    const endFrame = startFrame + tr.durationInFrames;
    transitions.push({
      betweenScenes: [prev.sceneId, next.sceneId],
      fromSceneIndex: prev.sceneIndex,
      toSceneIndex: next.sceneIndex,
      type: tr.type,
      durationInFrames: tr.durationInFrames,
      startFrame,
      endFrame,
      startSeconds: startFrame / fps,
      endSeconds: endFrame / fps,
    });
  }

  // 4) Voiceover from audioOverlay (manifest stores seconds).
  const voiceover = audioOverlay.map((track) => {
    const startFrame = Math.round((track.start ?? 0) * fps);
    const endFrame = Math.round((track.end ?? 0) * fps);
    return {
      id: track.id,
      path: track.path,
      startSeconds: track.start ?? 0,
      endSeconds: track.end ?? 0,
      startFrame,
      endFrame,
      durationInFrames: endFrame - startFrame,
    };
  });

  return {
    fps,
    totalFrames,
    totalSeconds: totalFrames / fps,
    scenes: scenePlacements.map((sp) => {
      const scene = scenes[sp.sceneIndex];
      return {
        sceneId: sp.sceneId,
        sceneIndex: sp.sceneIndex,
        startFrame: sp.startFrame,
        endFrame: sp.endFrame,
        startSeconds: sp.startSeconds,
        endSeconds: sp.endSeconds,
        durationInFrames: sp.durationInFrames,
        // The TTS narration window that owns this scene — the source of truth
        // its duration was forced into (null only when there was no narration).
        ttsWindow: scene.ttsWindow ?? null,
      };
    }),
    assets,
    transitions,
    voiceover,
  };
}
