import React from "react";
import { useCurrentFrame, useVideoConfig, spring, interpolate } from "remotion";

/**
 * Primitive progress/fill bar. Animates the fill from 0 to content.value
 * (0-100) on enter. Pair with TextReveal for a label, or use standalone
 * for loading/comparison visuals.
 *
 * Contract:
 * - resolvedPosition: anchor-resolved layout from the pipeline
 * - resolvedStyle: token-resolved style values plus width/height
 * - content: contentOverride merged with defaults ({ value, label })
 * - timing: enterAtFrame/exitAtFrame and scene timing budget
 */
export function ProgressBar({ resolvedPosition, resolvedStyle, content, timing }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { enterAtFrame = 0 } = timing;

  const value = Math.max(0, Math.min(100, content.value ?? 0));
  const width = resolvedStyle.width ?? 480;
  const height = resolvedStyle.height ?? 16;
  const borderRadius = resolvedStyle.borderRadius ?? 8;

  const progress = spring({
    frame: frame - enterAtFrame,
    fps,
    config: resolvedStyle.easing ?? { damping: 18, mass: 0.8, stiffness: 90 },
  });

  const fillPct = interpolate(progress, [0, 1], [0, value], { extrapolateRight: "clamp" });

  return (
    <div style={{ ...resolvedPosition, width, display: "flex", flexDirection: "column", gap: 8 }}>
      {content.label ? (
        <div
          style={{
            fontSize: resolvedStyle.typography?.fontSize ?? 20,
            color: resolvedStyle.typography?.color ?? "#ffffff",
            opacity: 0.85,
          }}
        >
          {content.label}
        </div>
      ) : null}
      <div
        style={{
          width,
          height,
          borderRadius,
          background: resolvedStyle.trackColor ?? "rgba(255,255,255,0.15)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${fillPct}%`,
            height: "100%",
            borderRadius,
            background: resolvedStyle.fillColor ?? "currentColor",
          }}
        />
      </div>
    </div>
  );
}
