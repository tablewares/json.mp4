import React from "react";
import { useCurrentFrame, useVideoConfig, spring, interpolate } from "remotion";

/**
 * Primitive text asset. No container, no background — just typography
 * revealing in. Use as a building block inside compound assets or directly
 * for captions, kickers, and single-line statements.
 *
 * Contract:
 * - resolvedPosition: anchor-resolved layout from the pipeline
 * - resolvedStyle: token-resolved style values plus width/height
 * - content: contentOverride merged with defaults ({ text })
 * - timing: enterAtFrame/exitAtFrame and scene timing budget
 */
export function TextReveal({ resolvedPosition, resolvedStyle, content, timing }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { enterAtFrame = 0 } = timing;

  const revealMode = resolvedStyle.revealMode ?? "word";
  const staggerFrames = resolvedStyle.staggerFrames ?? 2;
  const align = resolvedStyle.align ?? "left";
  const text = content.text ?? "";
  const typography = resolvedStyle.typography ?? {};

  const springConfig = resolvedStyle.easing ?? { damping: 16, mass: 0.6, stiffness: 110 };

  const baseStyle = {
    fontSize: typography.fontSize ?? 40,
    fontWeight: typography.fontWeight ?? 600,
    lineHeight: typography.lineHeight ?? 1.2,
    color: typography.color ?? "#ffffff",
    textAlign: align,
  };

  if (revealMode === "fade" || revealMode === "line") {
    const progress = spring({ frame: frame - enterAtFrame, fps, config: springConfig });
    const translateY = interpolate(progress, [0, 1], [16, 0]);
    return (
      <div
        style={{
          ...resolvedPosition,
          width: resolvedStyle.width ?? 800,
          opacity: progress,
          transform: `translateY(${translateY}px)`,
          ...baseStyle,
        }}
      >
        {text}
      </div>
    );
  }

  // word-by-word: each word gets its own staggered spring
  const words = text.split(" ");
  return (
    <div
      style={{
        ...resolvedPosition,
        width: resolvedStyle.width ?? 800,
        display: "flex",
        flexWrap: "wrap",
        justifyContent: align === "center" ? "center" : align === "right" ? "flex-end" : "flex-start",
        ...baseStyle,
      }}
    >
      {words.map((word, i) => {
        const wordProgress = spring({
          frame: frame - enterAtFrame - i * staggerFrames,
          fps,
          config: springConfig,
        });
        const translateY = interpolate(wordProgress, [0, 1], [12, 0]);
        return (
          <span
            key={i}
            style={{
              opacity: wordProgress,
              transform: `translateY(${translateY}px)`,
              marginRight: "0.3em",
              display: "inline-block",
            }}
          >
            {word}
          </span>
        );
      })}
    </div>
  );
}
