import React from "react";
import { Composition, registerRoot } from "remotion";
import { VideoComposition } from "./pipelines/pipeline3-render/Composition.jsx";
import resolvedGraph from "../resolved.json" with { type: "json" };

function totalDurationInFrames(graph) {
  // TTS is the source of truth: the last scene's narration window end == the
  // synthesized audio length, so the composition duration is simply the sum of
  // scene (TTS-window) durations. Only an INTERMEDIATE transition — one with
  // a successor scene — overlaps and consumes the shared window between it;
  // a trailing transitionOut on the last scene has no successor to overlap
  // into, so it is NOT subtracted (subtracting it was why the video came out
  // shorter than the 7.4s voiceover).
  const sceneTotal = graph.scenes.reduce((sum, s) => sum + s.durationInFrames, 0);
  const intermediateOverlap = graph.scenes
    .slice(0, -1)
    .reduce((sum, s) => sum + (s.transitionOut?.durationInFrames ?? 0), 0);
  return sceneTotal - intermediateOverlap;
}

function Root() {
  return (
    <Composition
      id="Video"
      component={VideoComposition}
      defaultProps={{ resolvedGraph }}
      durationInFrames={totalDurationInFrames(resolvedGraph)}
      fps={resolvedGraph.config.fps}
      width={resolvedGraph.config.width}
      height={resolvedGraph.config.height}
    />
  );
}

registerRoot(Root);
