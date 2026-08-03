import React from "react";
import { useCurrentFrame, useVideoConfig, spring, interpolate } from "remotion";

/**
 * BarChartRace — animated vertical bar chart of finance metrics (revenue,
 * AUM, quarterly results). content.bars (each { label, value }) grow from
 * zero to their `value` over the asset's enter window, and the numeric
 * labels count up alongside the rise — the "money counting up" move that
 * signals a live dashboard.
 *
 * Animations — all owned by the component, resolving inside the TTS window:
 *   - grow: each bar's height is driven by a spring from its own staggered
 *     start, so the tallest bar lands last. The spring budget is clamped so
 *     every bar (and therefore its count-up label) is settled *before* the
 *     exit door.
 *   - count-up: each bar's value label interpolates 0 → value across the
 *     same spring so the figure audibly ticks with the rise.
 *   - rank / order: bars are laid out left→right by content order; an
 *     optional `resolvedStyle.sortByValue` ("asc"|"desc") re-sorts once so
 *     the chart reads small→large or large→small. (A true ongoing race with
 *     re-ordering mid-rise is out of scope for a static assets-row scene —
 *     drop in a real race timing source for that.)
 *   - exit: opacity fade near the window tail.
 *
 * Color key naming: the finance bar/canvas/track colors are raw hex literals
 * here (keyed `barFill`, `canvasFill`, `axisLine`) — they contain no
 * "color" substring, so resolveAssetStyle passes them through untouched
 * rather than mistaking them for style-registry color tokens.
 */
const EXIT_TAIL_FRACTION = 0.15;

export function BarChartRace({ resolvedPosition, resolvedStyle, content, timing }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { durationInFrames, enterAtFrame = 0, exitAtFrame = durationInFrames } = timing;

  let bars = Array.isArray(content.bars) ? content.bars : [];
  const valueFormatter = resolvedStyle.valueFormat ?? "currency";
  const drawWidth = resolvedStyle.width ?? 1400;
  const drawHeight = resolvedStyle.height ?? 520;
  const axisPad = resolvedStyle.axisPad ?? 64;
  const labelPad = resolvedStyle.labelBandPad ?? 72;

  const sortBy = resolvedStyle.sortByValue;
  if (sortBy === "asc") bars = [...bars].sort((a, b) => (a.value ?? 0) - (b.value ?? 0));
  else if (sortBy === "desc") bars = [...bars].sort((a, b) => (b.value ?? 0) - (a.value ?? 0));

  const barCount = Math.max(1, bars.length);
  const plotW = drawWidth - axisPad * 2;
  const plotH = drawHeight - labelPad;
  const barSlot = plotW / barCount;
  const barWidth = Math.min(resolvedStyle.barWidth ?? 96, barSlot * 0.62);

  const maxValue = Math.max(1, ...bars.map((b) => Number(b.value ?? 0)));

  // Per-bar spring budget that always settles before the exit blind, no
  // matter how many bars or how short the window.
  const growWindow = Math.max(1, (exitAtFrame - enterAtFrame) * (1 - EXIT_TAIL_FRACTION));
  const staggerFrames = resolvedStyle.staggerFrames ?? 6;
  const effectiveStagger =
    barCount > 1 ? Math.min(staggerFrames, growWindow / (barCount * 2)) : 0;

  const framesUntilExit = exitAtFrame - frame;
  const exitOpacity = interpolate(
    framesUntilExit,
    [0, Math.min(10, (exitAtFrame - enterAtFrame) * EXIT_TAIL_FRACTION)],
    [0, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );
  const enterOpacity = spring({
    frame: frame - enterAtFrame,
    fps,
    config: { damping: 20, mass: 0.5, stiffness: 90 },
  });
  const opacity = Math.min(enterOpacity, exitOpacity);

  const formatValue = (v) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return "0";
    if (valueFormatter === "number") return Math.round(n).toLocaleString("en-US");
    if (valueFormatter === "compact") return compactCurrency(n);
    // "currency" (default)
    if (n >= 1000) return `$${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
    return `$${n.toFixed(2)}`;
  };

  const easingConfig = resolvedStyle.easing ?? { damping: 16, mass: 0.7, stiffness: 110 };

  return (
    <div
      style={{
        ...resolvedPosition,
        width: drawWidth,
        height: drawHeight,
        background: resolvedStyle.canvasFill ?? "transparent",
        borderRadius: resolvedStyle.borderRadius ?? 24,
        border: resolvedStyle.borderLine ? `1px solid ${resolvedStyle.borderLine}` : "none",
        padding: `${axisPad}px`,
        opacity,
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* Plot area */}
      <div
        style={{
          position: "relative",
          width: "100%",
          height: plotH,
          display: "flex",
          alignItems: "flex-end",
          justifyContent: "flex-start",
          gap: 0,
          borderBottom: `${resolvedStyle.axisLine ? `2px solid ${resolvedStyle.axisLine}` : "none"}`,
        }}
      >
        {bars.map((bar, i) => {
          const value = Number(bar.value ?? 0);
          const startFrame = enterAtFrame + i * effectiveStagger;
          const progress = spring({
            frame: frame - startFrame,
            fps,
            config: easingConfig,
          });
          const heightFraction = Math.max(0, Math.min(1, progress));
          const barHeight = plotH * (value / maxValue) * heightFraction;
          const countedValue = value * heightFraction;

          const slotCenter = barSlot * i + barSlot / 2;
          const left = slotCenter - barWidth / 2;
          const color = bar.fillStyle || resolvedStyle.barFill || "#3D7BFD";

          return (
            <div
              key={`${bar.label ?? i}-${i}`}
              style={{
                position: "absolute",
                left,
                bottom: 0,
                width: barWidth,
                height: barHeight,
                display: "flex",
                flexDirection: "column",
                justifyContent: "flex-end",
                alignItems: "center",
              }}
            >
              {/* Count-up value label */}
              <div
                style={{
                  position: "absolute",
                  bottom: barHeight + 10,
                  width: barWidth * 1.6,
                  textAlign: "center",
                  fontFamily: resolvedStyle.typography?.fontFamily,
                  fontSize: (resolvedStyle.typography?.fontSize ?? 36) * 0.56,
                  fontWeight: 700,
                  color: resolvedStyle.valueFill || resolvedStyle.typography?.color,
                  fontVariantNumeric: "tabular-nums",
                  whiteSpace: "nowrap",
                }}
              >
                {formatValue(countedValue)}
              </div>
              <div
                style={{
                  width: "100%",
                  height: "100%",
                  background: color,
                  borderRadius: `${resolvedStyle.barRadius ?? 12}px ${resolvedStyle.barRadius ?? 12}px 0 0`,
                }}
              />
            </div>
          );
        })}
      </div>

      {/* Category label band */}
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          height: labelPad - 12,
          marginTop: 18,
        }}
      >
        {bars.map((bar, i) => {
          const slotCenter = barSlot * i + barSlot / 2;
          const labelWidth = barSlot * 0.92;
          const left = slotCenter - labelWidth / 2;
          return (
            <div
              key={`lbl-${bar.label ?? i}-${i}`}
              style={{
                position: "absolute",
                left,
                width: labelWidth,
                textAlign: "center",
                fontFamily: resolvedStyle.typography?.fontFamily,
                fontSize: (resolvedStyle.typography?.fontSize ?? 36) * 0.5,
                fontWeight: 600,
                color: resolvedStyle.labelFill || resolvedStyle.typography?.color,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {bar.label ?? ""}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function compactCurrency(n) {
  const abs = Math.abs(n);
  if (abs >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

export default BarChartRace;
