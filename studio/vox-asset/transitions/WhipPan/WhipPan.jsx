import React from "react";
import { AbsoluteFill, interpolate, Easing } from "remotion";

/**
 * Quick lateral whip pan with heavy motion blur at the cut midpoint. The
 * outgoing scene whips laterally off-screen, the incoming scene arrives
 * from the opposite side. Standalone: only depends on remotion, so the
 * vox-asset transition root stays self-contained (registry folders must
 * not import across roots — see the asset-root coupling comment in
 * Composition.jsx).
 *
 * `direction` controls the whip axis; incoming scenes arrive from the
 * opposite side. The motion-blur peak sits at the temporal midpoint, mir-
 * rored across the cut, so the blur reads as a single gesture, not two.
 */
const DIR = { left: -1, right: 1 };

function WhipPanComponent({
  children,
  presentationProgress,
  presentationDirection,
  direction = "right",
  distance = 180,
  blurPx = 24,
}) {
  const isEntering = presentationDirection === "entering";
  const sign = DIR[direction] ?? DIR.right;

  // Fast in/out easing, near-linear — sells the snap of a whip.
  const eased = Easing.bezier(0.2, 0, 0.2, 1)(presentationProgress);

  // Outgoing slides 0 -> +distance; incoming arrives from -distance -> 0,
  // both along `direction` (sign flips for `left`).
  const translateX = isEntering
    ? interpolate(eased, [0, 1], [-sign * distance, 0])
    : interpolate(eased, [0, 1], [0, sign * distance]);

  // Motion blur peaks at the midpoint using raw (un-eased) progress so it
  // tracks wall-clock time, not the shaped curve, then resolves to 0.
  const blurValue = blurPx > 0
    ? interpolate(presentationProgress, [0, 0.5, 1], [0, blurPx, 0])
    : 0;

  return (
    <AbsoluteFill
      style={{
        transform: `translateX(${translateX}px)`,
        filter: blurValue > 0 ? `blur(${blurValue}px)` : undefined,
      }}
    >
      {children}
    </AbsoluteFill>
  );
}

/** Factory: `<TransitionSeries.Transition presentation={whipPan({...})} .../>` */
export function whipPan(props = {}) {
  return { component: WhipPanComponent, props };
}
