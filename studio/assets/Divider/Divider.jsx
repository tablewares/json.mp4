import React from "react";
import { useCurrentFrame, useVideoConfig, spring } from "remotion";

/**
 * Primitive line divider. Draws in from zero length along its orientation
 * axis. Use to separate sections, underline a heading, or connect stats.
 *
 * Contract:
 * - resolvedPosition: anchor-resolved layout from the pipeline
 * - resolvedStyle: token-resolved style values plus width/height
 * - content: unused (divider has no content, purely style-driven)
 * - timing: enterAtFrame/exitAtFrame and scene timing budget
 */
export function Divider({ resolvedPosition, resolvedStyle, timing }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { enterAtFrame = 0 } = timing;

  const orientation = resolvedStyle.orientation ?? "horizontal";
  const thickness = resolvedStyle.thickness ?? 2;
  const width = resolvedStyle.width ?? 400;
  const height = resolvedStyle.height ?? 2;

  const progress = spring({
    frame: frame - enterAtFrame,
    fps,
    config: resolvedStyle.easing ?? { damping: 20, mass: 0.6, stiffness: 100 },
  });

  const isHorizontal = orientation === "horizontal";

  return (
    <div
      style={{
        ...resolvedPosition,
        width: isHorizontal ? width : thickness,
        height: isHorizontal ? thickness : height,
        background: resolvedStyle.color ?? "currentColor",
        transform: isHorizontal ? `scaleX(${Math.min(progress, 1)})` : `scaleY(${Math.min(progress, 1)})`,
        transformOrigin: isHorizontal ? "left center" : "top center",
      }}
    />
  );
}
