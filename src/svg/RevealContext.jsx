import React, { createContext, useContext } from "react";
import { useReveal } from "./useReveal.js";

/**
 * RevealContext — set by <SvgStage>, read by every primitive inside it.
 *
 * Primitives get { reveal, enter, exitOpacity, frame, fps, duration, timing,
 * easing, viewBox } from context WITHOUT prop-drilling. They MAY override
 * the `reveal` they consume by passing a literal value (for staggered
 * children like chart bars that call useReveal with their own enterFrame);
 * passing `reveal` explicitly to a primitive wins over context.
 */
export const RevealContext = createContext({
  reveal: 1,
  enter: 1,
  exitOpacity: 1,
  frame: 0,
  fps: 30,
  duration: 1,
  timing: { durationInFrames: 1, enterAtFrame: 0, exitAtFrame: 1 },
  easing: undefined,
  viewBox: { width: 0, height: 0 },
});

export function useRevealContext() {
  return useContext(RevealContext);
}

/**
 * StageReveal — internal: binds useReveal to the stage's timing and injects
 * the result + viewBox into RevealContext for all children. Exported only so
 * SvgStage can use it; consumers should render <SvgStage>, not this.
 */
export function StageReveal({ timing, easing, viewBox, children }) {
  const revealState = useReveal(timing, { easing });
  return (
    <RevealContext.Provider value={{ ...revealState, timing, easing, viewBox }}>
      {children}
    </RevealContext.Provider>
  );
}

export default RevealContext;
