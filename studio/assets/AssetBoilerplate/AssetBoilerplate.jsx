import React from "react";
import { useCurrentFrame, useVideoConfig, spring, interpolate } from "remotion";

/**
 * Starter asset template for new scene elements.
 *
 * Contract:
 * - resolvedPosition: anchor-resolved layout from the pipeline
 * - resolvedStyle: fully token-resolved style values plus width/height
 * - content: contentOverride merged with defaults
 * - timing: enterAtFrame/exitAtFrame and scene timing budget
 */
export function AssetBoilerplate({ resolvedPosition, resolvedStyle, content, timing }) {
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

  const progress = Math.min(enterProgress, exitProgress);
  const opacity = progress;
  const translateY = interpolate(progress, [0, 1], [24, 0]);

  const width = resolvedStyle.width ?? 720;
  const height = resolvedStyle.height ?? 220;
  const padding = resolvedStyle.padding ?? 24;
  const borderRadius = resolvedStyle.borderRadius ?? 24;
  const align = resolvedStyle.align ?? "left";
  const title = content.title ?? "";
  const body = content.body ?? "";

  return (
    <div
      style={{
        ...resolvedPosition,
        width,
        height,
        display: "flex",
        alignItems: "center",
        justifyContent: align === "center" ? "center" : align === "right" ? "flex-end" : "flex-start",
        opacity,
        transform: `translateY(${translateY}px)`,
      }}
    >
      <div
        style={{
          width: "100%",
          padding,
          borderRadius,
          background: resolvedStyle.backgroundColor ?? "transparent",
          boxShadow: resolvedStyle.shadow ?? "none",
          textAlign: align,
        }}
      >
        {title ? (
          <div
            style={{
              fontSize: resolvedStyle.typography?.fontSize ?? 44,
              fontWeight: 700,
              lineHeight: 1.1,
              marginBottom: body ? 8 : 0,
              color: resolvedStyle.typography?.color ?? "#ffffff",
            }}
          >
            {title}
          </div>
        ) : null}
        {body ? (
          <div
            style={{
              fontSize: resolvedStyle.typography?.fontSize ?? 28,
              lineHeight: 1.35,
              opacity: 0.9,
              color: resolvedStyle.typography?.color ?? "#ffffff",
            }}
          >
            {body}
          </div>
        ) : null}
      </div>
    </div>
  );
}
