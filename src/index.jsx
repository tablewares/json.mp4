import React from "react";
import { Composition, registerRoot } from "remotion";
import { VideoComposition } from "./pipelines/pipeline3-render/Composition.jsx";
import resolvedGraph from "../resolved.json" with { type: "json" };

function totalDurationInFrames(graph) {
  // sum of scene durations minus the overlap each transition consumes
  const sceneTotal = graph.scenes.reduce((sum, s) => sum + s.durationInFrames, 0);
  const transitionOverlap = graph.scenes.reduce((sum, s) => sum + (s.transitionOut?.durationInFrames ?? 0), 0);
  return sceneTotal - transitionOverlap;
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
