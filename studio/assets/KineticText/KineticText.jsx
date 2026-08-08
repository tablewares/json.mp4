import React from "react";
import { useCurrentFrame, useVideoConfig, spring, interpolate } from "remotion";

/**
 * Reveals `content.text` one word at a time. Unlike TextBlock (which animates
 * as a single unit), each word gets its own pop-in spring.
 *
 * Two timing modes, chosen automatically by pipeline2 (resolve.js):
 *
 *  - NARRATION-SYNCED (timing.words present): wired in only when this
 *    asset's content.text is word-for-word identical to the scene's
 *    narration text, so it's unambiguous which spoken word is which. Each
 *    word pops at the real frame WhisperX measured it being spoken (clamped
 *    to not start before enterAtFrame), so the caption reads in lockstep
 *    with the voiceover instead of an artificial cadence.
 *
 *  - EVEN STAGGER (timing.words absent): the original behavior. Words pop on
 *    a fixed resolvedStyle.staggerFrames cadence, auto-compressed against
 *    the asset's actual timing budget so word count * stagger never runs
 *    past exitAtFrame. Used when there's no narration, the text doesn't
 *    match narration verbatim, or the author sets
 *    styleOverride.useNarrationTiming: false.
 */
export function KineticText({ resolvedPosition, resolvedStyle, content, timing }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { durationInFrames, enterAtFrame = 0, exitAtFrame = durationInFrames, words: wordTimings } = timing;

  const words = (content.text ?? "").trim().split(/\s+/).filter(Boolean);
  const requestedStagger = resolvedStyle.staggerFrames ?? 6;
  
  // Snappier spring configuration for pop-in effects
  const easingConfig = resolvedStyle.easing ?? { damping: 15, mass: 0.2, stiffness: 300 };
  const popScale = resolvedStyle.wordPopScale ?? 1.2;

  const hasWordTimings = Array.isArray(wordTimings) && wordTimings.length === words.length;

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
        const wordStartFrame = hasWordTimings
          ? Math.max(enterAtFrame, Math.min(wordTimings[i].startFrame, exitAtFrame))
          : enterAtFrame + i * effectiveStagger;

        // Keep word completely hidden until its frame arrives
        if (frame < wordStartFrame) {
          return (
            <span
              key={`${word}-${i}`}
              style={{ display: "inline-block", opacity: 0 }}
            >
              {word}
            </span>
          );
        }

        // Snap animation: starts slightly oversized and quickly snaps down to scale 1.0
        const progress = spring({ frame: frame - wordStartFrame, fps, config: easingConfig });
        const scale = interpolate(progress, [0, 1], [popScale, 1], {
          extrapolateRight: "clamp",
        });

        return (
          <span
            key={`${word}-${i}`}
            style={{
              display: "inline-block",
              opacity: 1,
              transform: `scale(${scale})`,
            }}
          >
            {word}
          </span>
        );
      })}
    </div>
  );
}