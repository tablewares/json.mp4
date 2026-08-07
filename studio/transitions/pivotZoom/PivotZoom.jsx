import React from "react";
import { TransitionBoilerplate } from "../TransitionBoilerplate/TransitionBoilerplate.jsx";

/**
 * "Push through" a carried asset: the outgoing scene recedes and rotates
 * slightly away, the incoming scene arrives from the same depth/rotation
 * continuing the spin, both pivoting around the carried asset's actual
 * position in each scene (falls back to frame-center if no carryAssetId is
 * resolved). Built entirely on TransitionBoilerplate's motion model — this
 * file only curates a preset and exposes a narrower, purpose-built params
 * surface instead of reimplementing translate/scale/rotate/blur math.
 *
 * Good for: cutting from a UI element/logo/card in one scene to its
 * counterpart in the next scene, or any beat where you want the cut to feel
 * like the camera is pushing *through* something rather than sliding past it.
 */
function PivotZoomComponent({
  children,
  presentationProgress,
  presentationDirection,
  carryFrom,
  carryTo,
  intensity = 1, // 0..2ish multiplier over the whole preset
  spinDeg = 8,
  direction = "down", // slight drift alongside the push, matches DIRECTION_VECTORS
}) {
  const { component: Boilerplate, props } = TransitionBoilerplate({
    direction,
    distance: 24 * intensity,
    scale: 1 - 0.22 * intensity, // recede toward the pivot rather than past it
    rotateDeg: spinDeg * intensity,
    blurPx: 6 * intensity,
    fade: true,
    overshoot: true, // springy settle sells the "pushing through" feel
    carryFrom,
    carryTo,
  });

  return (
    <Boilerplate
      {...props}
      presentationProgress={presentationProgress}
      presentationDirection={presentationDirection}
    >
      {children}
    </Boilerplate>
  );
}

/** Factory: `<TransitionSeries.Transition presentation={pivotZoom({carryAssetId, intensity, spinDeg, direction})} .../>` */
export function pivotZoom(props = {}) {
  return { component: PivotZoomComponent, props };
}