import React from "react";
import { useCurrentFrame, useVideoConfig, spring, interpolate } from "remotion";

/**
 * Reveals `content.text` one word at a time. Unlike TextBlock (which animates
 * as a single unit), each word gets its own pop-in spring, staggered by
 * `resolvedStyle.staggerFrames`.
 *
 * The stagger is auto-compressed against the asset's actual timing budget:
 * word count * requested stagger is never allowed to run past exitAtFrame.
 * This is the framework's "animations must resolve within the TTS-driven
 * timing" rule enforced locally, inside the asset itself, rather than left
 * to whoever authors the scene to get right by hand.
 */
export function KineticText({ resolvedPosition, resolvedStyle, content, timing }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { durationInFrames, enterAtFrame = 0, exitAtFrame = durationInFrames } = timing;

  const words = (content.text ?? "").trim().split(/\s+/).filter(Boolean);
  const requestedStagger = resolvedStyle.staggerFrames ?? 6;
  const easingConfig = resolvedStyle.easing ?? { damping: 12, mass: 0.4, stiffness: 180 };
  const popScale = resolvedStyle.wordPopScale ?? 1.15;

  // Reserve the last 40% of the enter->exit window as settle time so the
  // final word isn't still popping in right as the exit fade starts.
  const revealBudgetFrames = Math.max(1, (exitAtFrame - enterAtFrame) * 0.6);
  const effectiveStagger =
    words.length > 1 ? Math.min(requestedStagger, revealBudgetFrames / (words.length - 1)) : 0;

  const framesUntilExit = exitAtFrame - frame;
  const exitOpacity = interpolate(framesUntilExit, [0, Math.min(15, durationInFrames * 0.15)], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  const justify =
    resolvedStyle.align === "center" ? "center" : resolvedStyle.align === "right" ? "flex-end" : "flex-start";

  return (
    <div
      style={{
        ...resolvedPosition,
        width: resolvedStyle.width ?? 1100,
        display: "flex",
        flexWrap: "wrap",
        justifyContent: justify,
        gap: "0.1em 0.35em",
        fontFamily: resolvedStyle.typography?.fontFamily,
        fontSize: resolvedStyle.typography?.fontSize,
        fontWeight: resolvedStyle.typography?.fontWeight,
        lineHeight: resolvedStyle.typography?.lineHeight,
        color: resolvedStyle.typography?.color,
        background: resolvedStyle.backgroundColor ?? "transparent",
        opacity: exitOpacity,
      }}
    >
      {words.map((word, i) => {
        const wordStartFrame = enterAtFrame + i * effectiveStagger;
        const progress = spring({ frame: frame - wordStartFrame, fps, config: easingConfig });
        const scale = interpolate(progress, [0, 0.6, 1], [0.4, popScale, 1]);
        const opacity = interpolate(progress, [0, 1], [0, 1], { extrapolateLeft: "clamp" });
        const translateY = interpolate(progress, [0, 1], [18, 0]);

        return (
          <span
            key={`${word}-${i}`}
            style={{
              display: "inline-block",
              opacity,
              transform: `translateY(${translateY}px) scale(${scale})`,
            }}
          >
            {word}
          </span>
        );
      })}
    </div>
  );
}
