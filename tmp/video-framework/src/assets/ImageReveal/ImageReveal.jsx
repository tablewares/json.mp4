import React from "react";
import { useCurrentFrame, useVideoConfig, spring, interpolate, staticFile } from "remotion";

const CLIP_PATHS = {
  "left-to-right": (p) => `inset(0 ${100 - p * 100}% 0 0)`,
  "top-to-bottom": (p) => `inset(0 0 ${100 - p * 100}% 0)`,
  "center-out": (p) => `inset(${50 - p * 50}% ${50 - p * 50}%)`,
};

export function ImageReveal({ resolvedPosition, resolvedStyle, content, timing }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { enterAtFrame = 0 } = timing;

  const progress = spring({
    frame: frame - enterAtFrame,
    fps,
    config: resolvedStyle.easing ?? { damping: 16, mass: 0.7, stiffness: 100 },
  });

  const clipFn = CLIP_PATHS[resolvedStyle.revealDirection] ?? CLIP_PATHS["left-to-right"];
  const scale = interpolate(progress, [0, 1], [0.96, 1]);

  return (
    <div
      style={{
        ...resolvedPosition,
        width: resolvedStyle.width ?? 640,
        height: resolvedStyle.height ?? 640,
        overflow: "hidden",
        borderRadius: resolvedStyle.borderRadius ?? 24,
        clipPath: clipFn(Math.min(progress, 1)),
        transform: `scale(${scale})`,
      }}
    >
      <img
        src={content.src.startsWith("http") ? content.src : staticFile(content.src)}
        alt={content.alt ?? ""}
        style={{ width: "100%", height: "100%", objectFit: "cover" }}
      />
    </div>
  );
}
