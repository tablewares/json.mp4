import React from "react";
import { AbsoluteFill, interpolate, Easing } from "remotion";

/**
 * Shape wipe: a solid neon shape (circle by default) overlays the cut.
 * During the entering half it expands from the center to fill the frame;
 * during the exiting half it contracts again, finally collapsing to a tiny
 * dot that reads as the dot of an incoming-scene exclamation mark (or any
 * small focal element) — the vox "neon-yellow circle expands then collapses
 * into the dot of an exclamation mark" beat.
 *
 * Standalone implementation (no TransitionBoilerplate import across roots).
 * The scene swap is a plain crossfade underneath the overlay, which is
 * enough to read the shape as the visual that pushes between the two
 * scenes — the shape itself is the focal motion, not the scene swap.
 */
function ShapeWipeComponent({
  children,
  presentationProgress,
  presentationDirection,
  shapeColor = "#FFE600",
  peakScale = 1.8,
  targetScale = 0.02,
}) {
  const isEntering = presentationDirection === "entering";

  // Each half of the transition crosses the full [0,1] range and sees the
  // shape cycle through one expansion (outgoing) or one contraction
  // (incoming). For the outgoing side the shape GROWS 0 -> peakScale;
  // for the entering side it SHRINKS peakScale -> targetScale.
  const eased = Easing.bezier(0.4, 0, 0.2, 1)(presentationProgress);

  const fillerScale = isEntering
    ? interpolate(eased, [0, 1], [peakScale, targetScale])
    : interpolate(eased, [0, 1], [targetScale, peakScale]);

  // Scene crossfade underneath so the swap reads as the shape revealing
  // the next scene rather than a hard cut.
  const sceneOpacity = isEntering
    ? interpolate(eased, [0, 0.6, 1], [0, 0.6, 1], { extrapolateLeft: "clamp" })
    : interpolate(eased, [0, 0.4, 1], [1, 0.4, 0], { extrapolateRight: "clamp" });

  // Shape opacity stays fully solid until late, then fades so the incoming
  // scene isn't covered at the tail.
  const shapeOpacity = isEntering
    ? interpolate(eased, [0, 0.85, 1], [1, 1, 0.4], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })
    : interpolate(eased, [0, 0.15, 1], [0.4, 1, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });

  return (
    <AbsoluteFill>
      <AbsoluteFill style={{ opacity: sceneOpacity }}>{children}</AbsoluteFill>
      {/* The expanded shape sits on top, centered. */}
      <AbsoluteFill
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          pointerEvents: "none",
        }}
      >
        <div
          style={{
            width: "100vmin",
            height: "100vmin",
            background: shapeColor,
            borderRadius: "50%",
            transform: `scale(${fillerScale})`,
            opacity: shapeOpacity,
          }}
        />
      </AbsoluteFill>
    </AbsoluteFill>
  );
}

/** Factory: `<TransitionSeries.Transition presentation={shapeWipe({...})} .../>` */
export function shapeWipe(props = {}) {
  return { component: ShapeWipeComponent, props };
}
