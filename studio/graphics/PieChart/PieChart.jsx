import React from "react";
import { useCurrentFrame, useVideoConfig, spring, interpolate } from "remotion";
import { PieChart, Pie, Cell } from "recharts";

/**
 * PieChart — animated donut/pie chart built on Recharts, wired the same way
 * BarChartRace.jsx wires its own hand-rolled bars: every animated value is
 * computed per-frame from `useCurrentFrame()` + `spring()`/`interpolate()`
 * and handed to Recharts as already-resolved, static props. Recharts' own
 * animation system is explicitly disabled (`isAnimationActive={false}`) —
 * Remotion renders by seeking to arbitrary frames in a headless browser and
 * snapshotting each one; a library-driven CSS/rAF tween is not
 * frame-seekable and would desync or render blank on a cold seek. This
 * component owns 100% of the animation timeline instead, the same contract
 * every other studio/graphics asset follows.
 *
 * No <ResponsiveContainer>: it renders 0x0 until a ResizeObserver fires,
 * which is a well-known source of blank Recharts-in-Remotion exports.
 * <PieChart> gets an explicit pixel width/height instead, taken from
 * resolvedStyle like every other sized asset here.
 *
 * Animations, all owned by this component:
 *   - sweep reveal: the donut draws clockwise from 12 o'clock via an
 *     animated `endAngle` on a single spring (0 -> 360deg), so the whole
 *     chart reads as one continuous draw-in instead of per-slice pops.
 *   - per-slice stagger fade: each slice's fill opacity ramps in on its own
 *     short delay after the sweep passes its start angle, so slices don't
 *     all hit full saturation at once even though the sweep itself is one
 *     spring.
 *   - center total count-up: numeric label in the donut hole counts 0 -> sum
 *     of all slice values in lockstep with the sweep spring, matching
 *     BarChartRace's count-up convention.
 *   - legend: category chips fade+rise in with the same staggerFrames
 *     rhythm as BarChartRace's category label band.
 *   - exit: opacity fade near the window tail.
 */
const EXIT_TAIL_FRACTION = 0.15;
const DEFAULT_PALETTE = ["#3D7BFD", "#16C784", "#EA3943", "#C04CFD", "#FFD166", "#33C3F0", "#FF7A59", "#8B93A7"];

export function PieChartAsset({ resolvedPosition, resolvedStyle, content, timing }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { durationInFrames, enterAtFrame = 0, exitAtFrame = durationInFrames } = timing;

  const slices = Array.isArray(content.slices) ? content.slices : [];
  const drawWidth = resolvedStyle.width ?? 900;
  const drawHeight = resolvedStyle.height ?? 640;
  const legendOn = resolvedStyle.showLegend ?? true;
  const plotSize = Math.min(drawWidth, legendOn ? drawHeight * 0.72 : drawHeight);
  const outerRadius = (plotSize / 2) * (resolvedStyle.outerRadiusRatio ?? 0.92);
  const innerRadius = outerRadius * (resolvedStyle.innerRadiusRatio ?? 0.62);

  const palette = Array.isArray(resolvedStyle.palette) && resolvedStyle.palette.length
    ? resolvedStyle.palette
    : DEFAULT_PALETTE;

  const total = slices.reduce((sum, s) => sum + Math.max(0, Number(s.value) || 0), 0);
  const valueFormatter = resolvedStyle.valueFormat ?? "number";

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

  const easingConfig = resolvedStyle.easing ?? { damping: 16, mass: 0.7, stiffness: 110 };
  const sweepWindow = Math.max(1, (exitAtFrame - enterAtFrame) * (1 - EXIT_TAIL_FRACTION));
  const sweepProgress = spring({
    frame: frame - enterAtFrame,
    fps,
    config: easingConfig,
    durationInFrames: sweepWindow,
  });
  const sweepClamped = Math.max(0, Math.min(1, sweepProgress));
  const currentEndAngle = -360 * sweepClamped; // recharts angles run counter-clockwise positive; negative sweeps clockwise from 12 o'clock
  const countedTotal = total * sweepClamped;

  const formatValue = (v) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return "0";
    if (valueFormatter === "compact") return compactNumber(n);
    if (valueFormatter === "percent") return `${Math.round(n)}%`;
    return Math.round(n).toLocaleString("en-US");
  };

  // Cumulative angular position of each slice's START, so the per-slice
  // stagger fade can key off "has the sweep reached this slice yet" rather
  // than a flat index-based delay — a big slice near the end of the sweep
  // still only starts fading in once the sweep visually arrives there.
  let cumulative = 0;
  const sliceStarts = slices.map((s) => {
    const start = cumulative;
    cumulative += total > 0 ? (Math.max(0, Number(s.value) || 0) / total) * 360 : 0;
    return start;
  });

  const staggerDeg = resolvedStyle.staggerFrames ?? 6; // reused as a degrees-of-sweep lead-in, not frames, for this asset
  const data = slices.map((s, i) => ({
    name: s.label ?? `Slice ${i + 1}`,
    value: Math.max(0, Number(s.value) || 0),
    fill: s.fillStyle || palette[i % palette.length],
  }));

  return (
    <div
      style={{
        ...resolvedPosition,
        width: drawWidth,
        height: drawHeight,
        background: resolvedStyle.canvasFill ?? "transparent",
        borderRadius: resolvedStyle.borderRadius ?? 24,
        border: resolvedStyle.borderLine ? `1px solid ${resolvedStyle.borderLine}` : "none",
        opacity,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: resolvedStyle.padding ?? 32,
      }}
    >
      {content.title ? (
        <div
          style={{
            fontFamily: resolvedStyle.typography?.fontFamily,
            fontSize: (resolvedStyle.typography?.fontSize ?? 36) * 0.72,
            fontWeight: 700,
            color: resolvedStyle.typography?.color ?? "#F5F7FA",
            marginBottom: 12,
            textAlign: "center",
          }}
        >
          {content.title}
        </div>
      ) : null}

      <div style={{ position: "relative", width: plotSize, height: plotSize }}>
        <PieChart width={plotSize} height={plotSize}>
          <Pie
            data={data}
            dataKey="value"
            nameKey="name"
            cx="50%"
            cy="50%"
            innerRadius={innerRadius}
            outerRadius={outerRadius}
            startAngle={0}
            endAngle={currentEndAngle}
            isAnimationActive={false}
            stroke={resolvedStyle.strokeColor ?? "#0B0E14"}
            strokeWidth={resolvedStyle.strokeWidth ?? 2}
          >
            {data.map((entry, i) => {
              const sliceStartDeg = sliceStarts[i];
              const sweptDeg = 360 * sweepClamped;
              const sliceFade = interpolate(
                sweptDeg,
                [Math.max(0, sliceStartDeg - staggerDeg), sliceStartDeg + staggerDeg],
                [0, 1],
                { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
              );
              return <Cell key={`cell-${i}`} fill={entry.fill} fillOpacity={sliceFade} />;
            })}
          </Pie>
        </PieChart>

        {/* Center hole: count-up total, matches BarChartRace's tabular-nums
            count-up convention. Hidden when innerRadius resolves to a
            near-zero pie (no meaningful hole to put a number in). */}
        {innerRadius > 24 ? (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              pointerEvents: "none",
            }}
          >
            <div
              style={{
                fontFamily: resolvedStyle.typography?.fontFamily,
                fontSize: (resolvedStyle.typography?.fontSize ?? 36) * 1.15,
                fontWeight: 800,
                fontVariantNumeric: "tabular-nums",
                color: resolvedStyle.valueFill || resolvedStyle.typography?.color || "#F5F7FA",
              }}
            >
              {formatValue(countedTotal)}
            </div>
            {content.centerLabel ? (
              <div
                style={{
                  fontFamily: resolvedStyle.typography?.fontFamily,
                  fontSize: (resolvedStyle.typography?.fontSize ?? 36) * 0.4,
                  color: resolvedStyle.labelFill || "#8B93A7",
                  marginTop: 4,
                }}
              >
                {content.centerLabel}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      {legendOn ? (
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            justifyContent: "center",
            gap: 18,
            marginTop: 18,
            maxWidth: drawWidth * 0.92,
          }}
        >
          {data.map((entry, i) => {
            const legendStart = enterAtFrame + i * (resolvedStyle.legendStaggerFrames ?? 3);
            const legendProgress = spring({
              frame: frame - legendStart,
              fps,
              config: { damping: 18, mass: 0.5, stiffness: 140 },
            });
            const legendOpacity = Math.max(0, Math.min(1, legendProgress));
            const legendY = interpolate(legendOpacity, [0, 1], [10, 0]);
            const share = total > 0 ? (entry.value / total) * 100 : 0;
            return (
              <div
                key={`legend-${entry.name}-${i}`}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  opacity: legendOpacity,
                  transform: `translateY(${legendY}px)`,
                }}
              >
                <div
                  style={{
                    width: 12,
                    height: 12,
                    borderRadius: 3,
                    background: entry.fill,
                    flexShrink: 0,
                  }}
                />
                <span
                  style={{
                    fontFamily: resolvedStyle.typography?.fontFamily,
                    fontSize: (resolvedStyle.typography?.fontSize ?? 36) * 0.46,
                    fontWeight: 600,
                    color: resolvedStyle.labelFill || resolvedStyle.typography?.color || "#8B93A7",
                    whiteSpace: "nowrap",
                  }}
                >
                  {entry.name} · {share.toFixed(0)}%
                </span>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function compactNumber(n) {
  const abs = Math.abs(n);
  if (abs >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return `${Math.round(n).toLocaleString("en-US")}`;
}

export default PieChartAsset;
