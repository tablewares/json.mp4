import React from "react";
import { AbsoluteFill } from "remotion";
import { clipReveal, shapeProgress } from "../motion.js";

/**
 * Circular iris wipe. On entry the incoming scene is revealed through a
 * growing circle (clip-path); on exit the outgoing scene is hidden
 * behind a shrinking circle. Both directions run presentationProgress
 * through motion.shapeProgress("easeOutBack") for a slight overshoot
 * before settling, rather than the raw linear 0->1 Remotion hands us.
 *
 * Same presentation contract as DefaultTransition: children,
 * presentationProgress (0->1 across the transition window),
 * presentationDirection ("entering" | "exiting").
 */
function IrisWipePresentationComponent({ children, presentationProgress, presentationDirection }) {
  const isEntering = presentationDirection === "entering";
  const shaped = shapeProgress(presentationProgress, "easeOutBack");
  const irisProgress = isEntering ? shaped : 1 - shaped;

  return (
    <AbsoluteFill
      style={{
        clipPath: clipReveal("iris", irisProgress),
      }}
    >
      {children}
    </AbsoluteFill>
  );
}

/** Factory used as `<TransitionSeries.Transition presentation={irisWipeTransition()} .../>` */
export function irisWipeTransition(props = {}) {
  return { component: IrisWipePresentationComponent, props };
}
