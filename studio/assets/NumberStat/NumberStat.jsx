import React from "react";
import { useCurrentFrame, useVideoConfig, spring, interpolate } from "remotion";

/**
 * NumberStat — the "big number" primitive. content.value is the animation
 * target; the number counts from content.fromValue (default 0) to
 * content.value on a single spring, with a slight overshoot-then-settle
 * scale pop so the figure reads as "landing" rather than just fading in.
 * content.label, if present, renders above or below per
 * resolvedStyle.labelPosition.
 *
 * Animations, all owned by the component within the timing budget:
 *   - count-up: one spring drives both the numeric interpolation and a
 *     0.85 -> 1.05 -> 1 scale overshoot, so the number visibly "ticks in"
 *     rather than appearing pre-settled.
 *   - exit: opacity fade near the window tail (same pattern as TextBlock).
 *
 * Naming note for color fields: resolveAssetStyle treats any key containing
 * "color" as a style-registry TOKEN. valueFill/labelFill/canvasFill/
 * borderLine are raw hex literals (no "color" substring) so they pass
 * through untouched — same convention as TickerTape/BarChartRace.
 */
function compactNumber(n) {
  const abs = Math.abs(n);
  if (abs >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return Math.round(n).toLocaleString("en-US");
}

function formatValue(n, resolvedStyle) {
  const decimals = resolvedStyle.decimals ?? 0;
  const prefix = resolvedStyle.prefix ?? "";
  const suffix = resolvedStyle.suffix ?? "";
  const finite = Number.isFinite(n) ? n : 0;
  const body =
    resolvedStyle.valueFormat === "compact"
      ? compactNumber(finite)
      : finite.toLocaleString("en-US", {
          minimumFractionDigits: decimals,
          maximumFractionDigits: decimals,
        });
  return `${prefix}${body}${suffix}`;
}

export function NumberStat({ resolvedPosition, resolvedStyle, content, timing }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { durationInFrames, enterAtFrame = 0, exitAtFrame = durationInFrames } = timing;

  const target = Number(content.value ?? 0);
  const from = Number(content.fromValue ?? 0);

  const progress = spring({
    frame: frame - enterAtFrame,
    fps,
    config: resolvedStyle.easing ?? { damping: 16, mass: 0.7, stiffness: 110 },
  });
  const clamped = Math.min(1, Math.max(0, progress));
  const countedValue = from + (target - from) * clamped;
  const scale = interpolate(progress, [0, 0.6, 1], [0.85, 1.05, 1]);

  const framesUntilExit = exitAtFrame - frame;
  const exitOpacity = interpolate(
    framesUntilExit,
    [0, Math.min(15, (exitAtFrame - enterAtFrame) * 0.15)],
    [0, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );
  const opacity = Math.min(clamped > 0 ? 1 : progress, exitOpacity);

  const align = resolvedStyle.align ?? "left";
  const alignItems = align === "center" ? "center" : align === "right" ? "flex-end" : "flex-start";
  const labelPosition = resolvedStyle.labelPosition ?? "top";

  const valueNode = (
    <div
      style={{
        fontFamily: resolvedStyle.typography?.fontFamily,
        fontSize: resolvedStyle.typography?.fontSize,
        fontWeight: resolvedStyle.typography?.fontWeight,
        lineHeight: resolvedStyle.typography?.lineHeight,
        color: resolvedStyle.valueFill ?? resolvedStyle.typography?.color,
        fontVariantNumeric: "tabular-nums",
        whiteSpace: "nowrap",
        transform: `scale(${scale})`,
        transformOrigin: align === "center" ? "center" : align === "right" ? "right center" : "left center",
      }}
    >
      {formatValue(countedValue, resolvedStyle)}
    </div>
  );

  const labelNode = content.label ? (
    <div
      style={{
        fontFamily: resolvedStyle.labelTypography?.fontFamily,
        fontSize: (resolvedStyle.labelTypography?.fontSize ?? 34) * 0.65,
        fontWeight: resolvedStyle.labelTypography?.fontWeight ?? 500,
        lineHeight: resolvedStyle.labelTypography?.lineHeight ?? 1.3,
        color: resolvedStyle.labelFill ?? resolvedStyle.labelTypography?.color,
        letterSpacing: "0.01em",
      }}
    >
      {content.label}
    </div>
  ) : null;

  return (
    <div
      style={{
        ...resolvedPosition,
        width: resolvedStyle.width ?? 480,
        height: resolvedStyle.height ?? 220,
        opacity,
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems,
        gap: 8,
        padding: resolvedStyle.canvasFill && resolvedStyle.canvasFill !== "transparent" ? 32 : 0,
        background: resolvedStyle.canvasFill ?? "transparent",
        borderRadius: resolvedStyle.borderRadius ?? 24,
        border: resolvedStyle.borderLine && resolvedStyle.borderLine !== "transparent"
          ? `1px solid ${resolvedStyle.borderLine}`
          : "none",
        boxSizing: "border-box",
      }}
    >
      {labelPosition === "top" && labelNode}
      {valueNode}
      {labelPosition === "bottom" && labelNode}
    </div>
  );
}

export default NumberStat;
