import React from "react";
import { useCurrentFrame, useVideoConfig, spring, interpolate } from "remotion";

/**
 * Compare-to-scale ruler pairing: a horizontal scale bar (the unit ruler,
 * e.g. nanometers) sits in the bottom band; a fixed-width reference tick
 * (e.g. "human hair width") slides in from `referenceCorner` to demonstrate
 * proportion against the ruler. Built for the vox "8 NANOMETERS" beat.
 *
 * The proportion math is purely visual: `reference.widthPercent` says how
 * much of the scale bar the reference should span; `items[].value` define
 * relative tick spacing (largest value spans the whole bar). The component
 * trusts those numbers, doesn't recompute them.
 */
export function ScaleComparison({ resolvedPosition, resolvedStyle, content, timing }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { durationInFrames, enterAtFrame = 0, exitAtFrame = durationInFrames } = timing;

  const reference = content.reference ?? { label: "", widthPercent: 50 };
  const items = content.items ?? [];

  const easingConfig = resolvedStyle.easing ?? { damping: 16, mass: 0.7, stiffness: 110 };
  const enterProgress = spring({
    frame: frame - enterAtFrame,
    fps,
    config: easingConfig,
  });
  const framesUntilExit = exitAtFrame - frame;
  const exitProgress = interpolate(
    framesUntilExit,
    [0, Math.min(15, durationInFrames * 0.15)],
    [0, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );
  const envelope = Math.min(enterProgress, exitProgress);

  const width = resolvedStyle.width ?? 1200;
  const height = resolvedStyle.height ?? 360;
  const barColor = resolvedStyle.barColor ?? "#F5F7FA";
  const barLabelColor = resolvedStyle.barLabelColor ?? "#F5F7FA";
  const tickColor = resolvedStyle.tickColor ?? "#8B93A7";
  const barThickness = resolvedStyle.barThickness ?? 8;
  const tickCount = Math.max(0, resolvedStyle.tickCount ?? 5);
  const unitLabel = resolvedStyle.unitLabel ?? "";
  const referenceCorner = resolvedStyle.referenceCorner ?? "left";
  const texturePath = resolvedStyle.texturePath ?? null;

  // Scale bar grows in from 0 to full during the first ~40% of the active
  // window; reference slides in over the next ~30%, sitting on top.
  const barGrow = interpolate(
    frame,
    [enterAtFrame, enterAtFrame + (exitAtFrame - enterAtFrame) * 0.4],
    [0, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );
  const refSlide = interpolate(
    frame,
    [enterAtFrame + (exitAtFrame - enterAtFrame) * 0.3, enterAtFrame + (exitAtFrame - enterAtFrame) * 0.65],
    [0, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  // Layout bands: scale bar sits in the lower 40%, reference tick in the
  // band above it. Bar spans the full inner width.
  const innerPad = 48;
  const barY = height - innerPad - barThickness;
  const barFullWidth = width - innerPad * 2;
  const barWidth = barFullWidth * barGrow;
  const barX = innerPad;

  // Reference tick: a vertical line of `widthPercent` of the bar's full width
  // (not the grown width — proportions should be read against the final bar),
  // with a label beside it. Slides from `referenceCorner`.
  const refWidth = (barFullWidth * (reference.widthPercent ?? 50)) / 100;
  const refFinalX = referenceCorner === "left" ? barX : barX + barFullWidth - refWidth;
  const refHiddenX = referenceCorner === "left" ? barX - refWidth - 40 : barX + barFullWidth + 40;
  const refCurrentX = interpolate(refSlide, [0, 1], [refHiddenX, refFinalX]);
  const refTopY = innerPad;
  const refBottomY = barY;

  // Tick marks across the grown bar.
  const ticks = Array.from({ length: tickCount + 1 }, (_, i) => {
    const t = tickCount === 0 ? 0 : i / tickCount;
    return {
      t,
      x: barX + barFullWidth * t * barGrow,
      value: items[Math.min(i, items.length - 1)] ?? null,
    };
  });

  return (
    <div
      style={{
        ...resolvedPosition,
        width,
        height,
        opacity: envelope,
        position: "relative",
      }}
    >
      {/* Optional paper texture behind the reference tick label. */}
      {texturePath ? (
        <div
          style={{
            position: "absolute",
            left: refCurrentX,
            top: refTopY,
            width: refWidth,
            height: refBottomY - refTopY,
            backgroundImage: `url(${texturePath})`,
            backgroundSize: "cover",
            opacity: 0.35,
            mixBlendMode: "multiply",
            pointerEvents: "none",
          }}
        />
      ) : null}

      {/* Reference tick: a tall thin line + label. */}
      <div
        style={{
          position: "absolute",
          left: refCurrentX,
          top: refTopY,
          width: 2,
          height: refBottomY - refTopY,
          background: barColor,
          opacity: refSlide > 0 ? 1 : 0,
        }}
      />
      {/* Reference end-cap spanning exactly `refWidth`. */}
      <div
        style={{
          position: "absolute",
          left: refCurrentX,
          top: refBottomY - 24,
          width: refWidth,
          height: 4,
          background: barColor,
          borderRadius: 2,
          opacity: refSlide,
        }}
      />
      <div
        style={{
          position: "absolute",
          left: refCurrentX + refWidth / 2,
          top: Math.max(refTopY - 28, 8),
          transform: "translateX(-50%)",
          color: barLabelColor,
          fontFamily: resolvedStyle.typography?.fontFamily ?? "Inter, sans-serif",
          fontSize: resolvedStyle.typography?.fontSize ?? 24,
          fontWeight: resolvedStyle.typography?.fontWeight ?? 700,
          opacity: refSlide,
          whiteSpace: "nowrap",
        }}
      >
        {reference.label}
      </div>

      {/* Scale bar. */}
      <div
        style={{
          position: "absolute",
          left: barX,
          top: barY,
          width: barWidth,
          height: barThickness,
          background: barColor,
          borderRadius: 4,
        }}
      />

      {/* Tick marks + labels. */}
      {ticks.map((tk, i) => {
        const label = tk.value
          ? `${tk.value.value.toLocaleString()}${unitLabel ? " " + unitLabel : ""}`
          : null;
        return (
          <React.Fragment key={`tick-${i}`}>
            <div
              style={{
                position: "absolute",
                left: tk.x,
                top: barY + barThickness + 4,
                width: 1.5,
                height: 14,
                background: tickColor,
              }}
            />
            {label ? (
              <div
                style={{
                  position: "absolute",
                  left: tk.x,
                  top: barY + barThickness + 22,
                  transform: "translateX(-50%)",
                  color: tickColor,
                  fontFamily: resolvedStyle.typography?.fontFamily ?? "Inter, sans-serif",
                  fontSize: (resolvedStyle.typography?.fontSize ?? 16) * 0.6,
                  fontWeight: 600,
                  whiteSpace: "nowrap",
                }}
              >
                {label}
              </div>
            ) : null}
          </React.Fragment>
        );
      })}
    </div>
  );
}
