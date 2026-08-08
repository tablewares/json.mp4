import React from "react";
import { useCurrentFrame, useVideoConfig, spring, interpolate } from "remotion";
import { ANCHOR_ALIGN } from "../../../../src/templating/anchor.js";

/**
 * Chained DrawLine strokes within a single asset — drop one asset on a
 * scene to draw a thick line from anchor A to anchor B, then a second from
 * B to C, etc. Built for the "image top-right -> line draws to center-left,
 * then bottom-left graphic -> second line draws and camera follows"
 * pattern: the scene's `camera` block can be authored with one action per
 * segment endpoint, using the same time fractions, so the camera tracks
 * the line tip across every stroke.
 *
 * Each segment is an anchor-spec pair `{from, to}` Optionally with its own
 * `drawFraction`. When none of the segments specify `drawFraction`, the
 * active window divides equally across all segments; when one or more do
 * specify it, those segments take that share of the window and the
 * remainder is split between the un-specified ones.
 *
 * The component reuses DrawLine's anchor-point math and SVG draw-in
 * pattern but composes N strokes back-to-back — one component, one anchor,
 * one timing contract, one place to author the whole multi-line beat.
 */
function anchorPoint(anchor, composition) {
  if (!anchor || !anchor.position) return { x: 0.5 * composition.width, y: 0.5 * composition.height };
  const align = ANCHOR_ALIGN[anchor.position];
  if (!align) {
    throw new Error(
      `LineDrawSequence: Unknown anchor position "${anchor.position}". Valid: ${Object.keys(ANCHOR_ALIGN).join(", ")}`
    );
  }
  const ox = (anchor.offsetXPercent ?? 0) / 100;
  const oy = (anchor.offsetYPercent ?? 0) / 100;
  return {
    x: align.x * composition.width + ox * composition.width,
    y: align.y * composition.height + oy * composition.height,
  };
}

export function LineDrawSequence({ resolvedPosition, resolvedStyle, content, timing }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { durationInFrames, enterAtFrame = 0, exitAtFrame = durationInFrames } = timing;

  // --- envelope ----------------------------------------------------------
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
  const width = resolvedStyle.width ?? 1920;
  const height = resolvedStyle.height ?? 1080;
  const composition = { width, height };

  const segments = content.segments ?? [];

  // --- segment timing ----------------------------------------------------
  // The active window is divided between segments. Per-segment `drawFraction`
  // — if specified on every segment — is honored as a share of the window
  // (clamped to sum to <= 1; remainder is unspent hold time at the end).
  // When no segment specifies a fraction, the window divides equally.
  const activeStart = enterAtFrame;
  const activeEnd = Math.max(exitAtFrame, enterAtFrame + 1);
  const activeFrames = activeEnd - activeStart;

  const allExplicit = segments.length > 0 && segments.every((s) => s.drawFraction != null);
  let segmentWindows; // array of {start, draw} frame counts per segment
  if (allExplicit) {
    const total = segments.reduce((acc, s) => acc + Math.min(1, Math.max(0, s.drawFraction)), 0) || 1;
    segmentWindows = segments.map((s) => ({
      start: 0, // patched cumulatively below
      draw: Math.round((Math.min(1, Math.max(0, s.drawFraction)) / total) * activeFrames),
    }));
  } else {
    const perSeg = activeFrames / Math.max(1, segments.length);
    segmentWindows = segments.map(() => ({ start: 0, draw: Math.round(perSeg) }));
  }
  // Cumulative starts.
  let acc = activeStart;
  for (let i = 0; i < segmentWindows.length; i += 1) {
    segmentWindows[i].start = acc;
    acc += segmentWindows[i].draw;
  }

  const strokeColor = resolvedStyle.strokeColor ?? "#FF3B30";
  const strokeWidth = resolvedStyle.strokeWidth ?? 14;
  const strokeCap = resolvedStyle.strokeCap ?? "round";
  const glowColor = resolvedStyle.glowColor ?? "#F5F7FA";
  const glowRadius = resolvedStyle.glowRadius ?? 6;

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
        {segments.map((seg, i) => {
          const from = anchorPoint(seg.from, composition);
          const to = anchorPoint(seg.to, composition);
          const dx = to.x - from.x;
          const dy = to.y - from.y;
          const len = Math.max(1, Math.sqrt(dx * dx + dy * dy));
          const win = segmentWindows[i];
          const segProgress = interpolate(
            frame,
            [win.start, win.start + Math.max(1, win.draw)],
            [0, 1],
            { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
          );
          const offset = interpolate(segProgress, [0, 1], [len, 0]);
          const fullyDrawn = segProgress >= 1;

          return (
            <g key={`seg-${i}`}>
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
                    [win.start + win.draw, win.start + win.draw + 8],
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
                strokeDashoffset={offset}
              />
            </g>
          );
        })}
      </svg>
    </div>
  );
}
