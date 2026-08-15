import React from "react";
import { AbsoluteFill, interpolate } from "remotion";

/**
 * A @remotion/transitions-style presentation. `presentationProgress` runs
 * 0 -> 1 across the transition's frame window; `presentationDirection` is
 * "entering" or "exiting" depending on which side of the cut this render is.
 */
function DefaultPresentationComponent({ children, presentationProgress, presentationDirection }) {
  const isEntering = presentationDirection === "entering";
  const opacity = isEntering
    ? interpolate(presentationProgress, [0, 1], [0, 1])
    : interpolate(presentationProgress, [0, 1], [1, 0]);
  const translateX = isEntering
    ? interpolate(presentationProgress, [0, 1], [24, 0])
    : interpolate(presentationProgress, [0, 1], [0, -24]);

  return (
    <AbsoluteFill style={{ opacity, transform: `translateX(${translateX}px)` }}>{children}</AbsoluteFill>
  );
}

/** Factory used as `<TransitionSeries.Transition presentation={defaultTransition()} .../>` */
export function fade(props = {}) {
  return { component: DefaultPresentationComponent, props };
}
