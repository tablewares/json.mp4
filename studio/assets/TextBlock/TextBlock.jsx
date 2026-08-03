import React from "react";
import { useCurrentFrame, useVideoConfig, spring, interpolate } from "remotion";

/**
 * Every asset owns its own animation and behavior in a scene. The renderer
 * only ever supplies:
 *  - resolvedPosition: { position, left, top, transformOrigin } from anchor.js
 *  - resolvedStyle: fully token-resolved style object
 *  - content: fully-resolved contentOverride (already merged with defaults)
 *  - timing: { durationInFrames, enterAtFrame, exitAtFrame }
 *
 * The asset decides *how* to move within that budget — the framework never
 * dictates the animation curve itself, only the window it must land in.
 */
export function TextBlock({ resolvedPosition, resolvedStyle, content, timing }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { durationInFrames, enterAtFrame = 0, exitAtFrame = durationInFrames } = timing;

  const enterProgress = spring({
    frame: frame - enterAtFrame,
    fps,
    config: resolvedStyle.easing ?? { damping: 14, mass: 0.6, stiffness: 120 },
  });

  const framesUntilExit = exitAtFrame - frame;
  const exitProgress = interpolate(framesUntilExit, [0, Math.min(15, durationInFrames * 0.15)], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const opacity = Math.min(enterProgress, exitProgress);
  const translateY = interpolate(enterProgress, [0, 1], [24, 0]);

  return (
    <div
      style={{
        ...resolvedPosition,
        width: resolvedStyle.width ?? 900,
        opacity,
        transform: `translateY(${translateY}px)`,
        textAlign: resolvedStyle.align ?? "left",
        fontFamily: resolvedStyle.typography?.fontFamily,
        fontSize: resolvedStyle.typography?.fontSize,
        fontWeight: resolvedStyle.typography?.fontWeight,
        lineHeight: resolvedStyle.typography?.lineHeight,
        color: resolvedStyle.typography?.color,
        background: resolvedStyle.backgroundColor ?? "transparent",
      }}
    >
      {content.text}
    </div>
  );
}
