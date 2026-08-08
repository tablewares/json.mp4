import React from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";
import { enterExitProgress, pulseBetween } from "../motion.js";

/**
 * Pill badge that pops in (via motion.enterExitProgress) and, once in,
 * loops a pulsing glow ring around itself (via motion.pulseBetween) for
 * the rest of its on-screen life. Follows the standard asset contract:
 *
 * - resolvedPosition: anchor-resolved layout from the pipeline
 * - resolvedStyle: fully token-resolved style values plus width/height
 * - content: contentOverride merged with defaults
 * - timing: enterAtFrame/exitAtFrame and scene timing budget
 */
export function GlowPulse({ resolvedPosition, resolvedStyle, content, timing }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { durationInFrames, enterAtFrame = 0, exitAtFrame = durationInFrames } = timing;

  const progress = enterExitProgress({
    frame,
    fps,
    enterAtFrame,
    exitAtFrame,
    durationInFrames,
    config: resolvedStyle.easing,
  });

  const width = resolvedStyle.width ?? 220;
  const height = resolvedStyle.height ?? 64;
  const borderRadius = resolvedStyle.borderRadius ?? 32;
  const align = resolvedStyle.align ?? "center";
  const label = content.label ?? "";

  const pulseEnabled = resolvedStyle.pulse ?? true;
  const glowOpacity = pulseEnabled
    ? pulseBetween({
        frame,
        periodFrames: resolvedStyle.pulsePeriodFrames ?? 40,
        min: resolvedStyle.pulseMinOpacity ?? 0.25,
        max: resolvedStyle.pulseMaxOpacity ?? 0.75,
      })
    : 0;

  const accentColor = resolvedStyle.accentColor ?? resolvedStyle.typography?.color ?? "#ffffff";

  return (
    <div
      style={{
        ...resolvedPosition,
        width,
        height,
        display: "flex",
        alignItems: "center",
        justifyContent: align === "center" ? "center" : align === "right" ? "flex-end" : "flex-start",
        opacity: progress,
        transform: `scale(${0.9 + progress * 0.1})`,
      }}
    >
      <div
        style={{
          position: "relative",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "0 24px",
          height: "70%",
          borderRadius,
          background: resolvedStyle.backgroundColor ?? "rgba(255,255,255,0.06)",
        }}
      >
        {pulseEnabled ? (
          <div
            style={{
              position: "absolute",
              inset: -6,
              borderRadius: borderRadius + 6,
              border: `2px solid ${accentColor}`,
              opacity: glowOpacity,
              pointerEvents: "none",
            }}
          />
        ) : null}
        <span
          style={{
            fontFamily: resolvedStyle.typography?.fontFamily,
            fontSize: resolvedStyle.typography?.fontSize ?? 28,
            fontWeight: resolvedStyle.typography?.fontWeight ?? 700,
            color: resolvedStyle.typography?.color ?? "#ffffff",
            whiteSpace: "nowrap",
          }}
        >
          {label}
        </span>
      </div>
    </div>
  );
}
