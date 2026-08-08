import React from "react";
import { useCurrentFrame, useVideoConfig, spring, interpolate } from "remotion";
import { ANCHOR_ALIGN } from "../../../../src/templating/anchor.js";

/**
 * A thick stroke that draws itself from one composition anchor spec to
 * another over a configurable fraction of the scene's active window. Built
 * as a supporting-background asset — pair with `layer: "background"` (or
 * any layer) and a scene-level `camera` block whose `actions` mirror the
 * line's `from`/`to` anchor specs and the same time fractions so the
 * camera tracks the live line tip across the draw.
 *
 * `from` / `to` are anchor specs identical to those the camera system
 * accepts: `{ position, offsetXPercent, offsetYPercent }`.
 *
 * Stroke geometry lives in composition pixels (the asset is sized to the
 * composition in its resolvedStyle defaults), so the drawn line spans the
 * full frame regardless of the asset's resolved box. Rendering happens
 * entirely via SVG primitives: stroke-dasharray/stroke-dashoffset drives
 * the draw-in, and an optional glow halo blooms in once the line is fully
 * drawn.
 */
function anchorPoint(anchor, composition) {
  if (!anchor || !anchor.position) return { x: 0.5 * composition.width, y: 0.5 * composition.height };
  const align = ANCHOR_ALIGN[anchor.position];
  if (!align) {
    throw new Error(
      `DrawLine: Unknown anchor position "${anchor.position}". Valid: ${Object.keys(ANCHOR_ALIGN).join(", ")}`
    );
  }
  const ox = (anchor.offsetXPercent ?? 0) / 100;
  const oy = (anchor.offsetYPercent ?? 0) / 100;
  return {
    x: align.x * composition.width + ox * composition.width,
    y: align.y * composition.height + oy * composition.height,
  };
}

export function DrawLine({ resolvedPosition, resolvedStyle, content, timing }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { durationInFrames, enterAtFrame = 0, exitAtFrame = durationInFrames } = timing;

  // --- envelope (matches AssetBoilerplate) -------------------------------
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

  // --- geometry ----------------------------------------------------------
  // The asset consumes the *composition* dimensions, not its own box. We
  // pass the composition through resolvedStyle.width/height defaults
  // (1920x1080), but the SVG viewBox is set from those so the line spans
  // the whole frame regardless of where anchor.js placed the box.
  const width = resolvedStyle.width ?? 1920;
  const height = resolvedStyle.height ?? 1080;
  const composition = { width, height };

  const from = anchorPoint(content.from, composition);
  const to = anchorPoint(content.to, composition);

  // Path length in pixels — straight-line distance for a single-segment
  // stroke; computed once per render from the two endpoints.
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.max(1, Math.sqrt(dx * dx + dy * dy));

  // Active window. Draw happens over the first `drawFraction` of it; then
  // the line sits fully drawn until exit.
  const activeStart = enterAtFrame;
  const activeEnd = Math.max(exitAtFrame, enterAtFrame + 1);
  const activeFrames = activeEnd - activeStart;
  const drawFraction = Math.min(1, Math.max(0, resolvedStyle.drawFraction ?? 0.55));
  const drawFrames = Math.max(1, Math.round(activeFrames * drawFraction));

  const drawProgress = interpolate(
    frame,
    [activeStart, activeStart + drawFrames],
    [0, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );
  const dashOffset = interpolate(drawProgress, [0, 1], [len, 0]);

  const strokeColor = resolvedStyle.strokeColor ?? "#FF3B30";
  const strokeWidth = resolvedStyle.strokeWidth ?? 14;
  const strokeCap = resolvedStyle.strokeCap ?? "round";
  const glowColor = resolvedStyle.glowColor ?? "#F5F7FA";
  const glowRadius = resolvedStyle.glowRadius ?? 6;
  const fullyDrawn = drawProgress >= 1;

  return (
    <div
      style={{
        ...resolvedPosition,
        width,
        height,
        opacity: envelope,
        position: "relative",
        overflow: "hidden",
        pointerEvents: "none",
      }}
    >
      <svg
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        height="100%"
        style={{ position: "absolute", inset: 0, overflow: "visible" }}
      >
        {/* Glow halo, blooming in once the line is fully drawn. */}
        {fullyDrawn && glowRadius > 0 ? (
          <line
            x1={from.x}
            y1={from.y}
            x2={to.x}
            y2={to.y}
            stroke={glowColor}
            strokeWidth={strokeWidth * 1.6}
            strokeLinecap={strokeCap}
            opacity={interpolate(
              frame,
              [activeStart + drawFrames, activeStart + drawFrames + 8],
              [0, 0.5],
              { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
            )}
            style={{ filter: `blur(${glowRadius}px)` }}
          />
        ) : null}
        <line
          x1={from.x}
          y1={from.y}
          x2={to.x}
          y2={to.y}
          stroke={strokeColor}
          strokeWidth={strokeWidth}
          strokeLinecap={strokeCap}
          strokeDasharray={len}
          strokeDashoffset={dashOffset}
        />
      </svg>
    </div>
  );
}
