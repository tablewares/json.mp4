import React from "react";
import { AbsoluteFill } from "remotion";

/**
 * A @remotion/transitions-style presentation. `presentationProgress` runs
 * 0 -> 1 across the transition's frame window; `presentationDirection` is
 * "entering" or "exiting" depending on which side of the cut this render is.
 *
 * Hard cut: no interpolation, no movement. The exiting scene stays fully
 * visible until the cut point, then disappears instantly; the entering
 * scene is invisible until the cut point, then appears instantly.
 */
function DefaultPresentationComponent({ children, presentationProgress, presentationDirection }) {
  const isEntering = presentationDirection === "entering";
  const isVisible = isEntering ? presentationProgress >= 1 : presentationProgress < 1;

  return (
    <AbsoluteFill style={{ opacity: isVisible ? 1 : 0 }}>{children}</AbsoluteFill>
  );
}

/** Factory used as `<TransitionSeries.Transition presentation={defaultTransition()} .../>` */
export function defaultTransition(props = {}) {
  return { component: DefaultPresentationComponent, props };
}