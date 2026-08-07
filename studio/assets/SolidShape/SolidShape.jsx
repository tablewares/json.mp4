import React from "react";
import { useCurrentFrame, useVideoConfig, spring, interpolate } from "remotion";

/**
 * Primitive flat shape asset — rectangle, pill, or circle. No text, no
 * image. Use as background panels, underline bars, chips, or standalone
 * color blocks that other assets can be composed on top of.
 *
 * Contract:
 * - resolvedPosition: anchor-resolved layout from the pipeline
 * - resolvedStyle: token-resolved style values plus width/height
 * - content: unused (shape has no content, purely style-driven)
 * - timing: enterAtFrame/exitAtFrame and scene timing budget
 */
export function SolidShape({ resolvedPosition, resolvedStyle, timing }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { enterAtFrame = 0 } = timing;

  const revealMode = resolvedStyle.revealMode ?? "scale";
  const shape = resolvedStyle.shape ?? "rect";
  const width = resolvedStyle.width ?? 400;
  const height = resolvedStyle.height ?? 120;

  const progress = spring({
    frame: frame - enterAtFrame,
    fps,
    config: resolvedStyle.easing ?? { damping: 16, mass: 0.7, stiffness: 110 },
  });

  const borderRadius =
    shape === "circle" ? Math.min(width, height) / 2 : shape === "pill" ? height / 2 : resolvedStyle.borderRadius ?? 16;

  const opacity = (resolvedStyle.opacity ?? 1) * (revealMode === "fade" ? progress : Math.min(progress, 1));
  const scale = revealMode === "scale" ? interpolate(progress, [0, 1], [0.85, 1]) : 1;
  const clipInset = revealMode === "wipe" ? `0 ${100 - Math.min(progress, 1) * 100}% 0 0` : undefined;

  return (
    <div
      style={{
        ...resolvedPosition,
        width,
        height,
        borderRadius,
        background: resolvedStyle.backgroundColor ?? "currentColor",
        opacity,
        transform: `scale(${scale})`,
        clipPath: clipInset ? `inset(${clipInset})` : undefined,
      }}
    />
  );
}
