import React from "react";
import { AbsoluteFill, interpolate, Easing } from "remotion";

/**
 * Match-cut split. During the transition:
 *   - presentationDirection == "exiting": outgoing splits down the center;
 *     right side slides up while left slides down (or the reverse per
 *     splitDirection), opening a gap. The two halves slide off-screen.
 *   - presentationDirection == "entering": the incoming scene arrives from
 *     the same two halves sliding back together from off-screen.
 *
 * Implemented by clipping the children into two halves with two AbsoluteFill
 * copies, each translated vertically. `children` is whatever TransitionSeries
 * passes us (the scene rendered underneath); rendering it twice is the same
 * pattern as a sliding panel — no compositor needed.
 */
function SplitScreenComponent({
  children,
  presentationProgress,
  presentationDirection,
  splitDirection = "right-up-left-down",
  gap = 12,
}) {
  const p = presentationProgress;
  // Half-screen travel distance; the half exits fully when p reaches 1.
  const travel = "50vh"; // not used directly; we work in fixed px via interpolate
  const screenExitPx = 540; // generous: covers a 1920x1080 half sliding out

  const rightUp = splitDirection !== "left-up-right-down";
  const rightSign = rightUp ? -1 : 1;
  const leftSign = rightUp ? 1 : -1;

  const translateRight = isExitingOrEntering(presentationDirection, "right", rightSign, p, screenExitPx);
  const translateLeft = isExitingOrEntering(presentationDirection, "left", leftSign, p, screenExitPx);
  const seamGap = interpolate(p, [0, 1], [0, gap], { extrapolateRight: "clamp" });

  // Fade both halves slightly near the cut midpoint so the seam doesn't snap.
  const halfOpacity = isExiting(presentationDirection)
    ? interpolate(p, [0, 0.85, 1], [1, 1, 0], { extrapolateRight: "clamp" })
    : interpolate(p, [0, 0.15, 1], [0, 1, 1], { extrapolateLeft: "clamp" });

  return (
    <AbsoluteFill style={{ background: "#000" }}>
      {/* Left half: clip to left half of frame, translate vertically. */}
      <AbsoluteFill
        style={{
          clipPath: "inset(0 50% 0 0)",
          transform: `translateY(${translateLeft}px)`,
          opacity: halfOpacity,
        }}
      >
        {children}
      </AbsoluteFill>
      {/* Right half: clip to right half, translate the other way, also shift
          horizontally inward to widen the seam gap. */}
      <AbsoluteFill
        style={{
          clipPath: `inset(0 0 0 calc(50% + ${seamGap / 2}px))`,
          transform: `translate(${seamGap / 2}px, ${translateRight}px)`,
          opacity: halfOpacity,
        }}
      >
        {children}
      </AbsoluteFill>
    </AbsoluteFill>
  );
}

// Helper: exiting halves fly outward, entering halves arrive from outside.
function isExiting(d) {
  return d === "exiting";
}

function isExitingOrEntering(d, which, sign, p, exitPx) {
  // Eased progress — slight overshoot when entering for a snappy reunion.
  const eased = Easing.bezier(0.4, 0, 0.2, 1)(p);
  if (d === "exiting") {
    return interpolate(eased, [0, 1], [0, sign * exitPx]);
  }
  return interpolate(eased, [0, 1], [-sign * exitPx, 0]);
}

/** Factory: `<TransitionSeries.Transition presentation={splitScreen({...})} .../>` */
export function splitScreen(props = {}) {
  return { component: SplitScreenComponent, props };
}
