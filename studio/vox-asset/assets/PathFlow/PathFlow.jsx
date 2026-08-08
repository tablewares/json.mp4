import React from "react";
import { useCurrentFrame, useVideoConfig, spring, interpolate } from "remotion";

/**
 * Particles sliding along one or more dashed SVG paths ("subway lines").
 * Used for vox-style motion-diagram beats like electrons travelling along a
 * transistor's conduction path.
 *
 * Two phases, both driven by the asset's active window
 * [enterAtFrame, exitAtFrame]:
 *
 *  1. DRAW-IN  (first `drawDurationFraction` of the window): each path's
 *     stroke-dashoffset animates from full length -> 0 so the dashed line
 *     draws itself onto the frame.
 *  2. FLOW     (remaining fraction): particles depart at `particleLagFrames`
 *     cadence and travel along the same path via getPointAtLength. When
 *     `loopParticles` is true they wrap and re-emit; otherwise each
 *     traverses the path once and parks at the far end.
 *
 * The contract is the same as AssetBoilerplate: pipeline2 hands this
 * component a resolved width/height/position and a contentOverride
 * (paths[], optional labels[]). It owns no layout math itself.
 *
 * Path length + per-particle positions are measured on live DOM nodes inside
 * a layout effect; the same nodes' getPointAtLength is then read on every
 * frame. Because pathData never changes for a given mount, the measured
 * values are constant across Remotion's frame-stepping render passes — this
 * stays deterministic.
 */
export function PathFlow({ resolvedPosition, resolvedStyle, content, timing }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { durationInFrames, enterAtFrame = 0, exitAtFrame = durationInFrames } = timing;

  const paths = content.paths ?? [];
  const labels = content.labels ?? [];
  const pathCount = paths.length;

  // --- entrance / exit envelope (matches AssetBoilerplate) ----------------
  const easingConfig = resolvedStyle.easing ?? { damping: 14, mass: 0.6, stiffness: 120 };
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

  // --- active window ------------------------------------------------------
  const activeStart = enterAtFrame;
  const activeEnd = Math.max(exitAtFrame, enterAtFrame + 1);
  const activeFrames = activeEnd - activeStart;
  const drawFrames = Math.max(
    1,
    Math.round(activeFrames * (resolvedStyle.drawDurationFraction ?? 0.4))
  );

  // --- path measurement (one-time, layout-effect) -------------------------
  // Render each path into a hidden <path>, measure getTotalLength once, then
  // also keep those nodes around as the source of getPointAtLength on every
  // subsequent frame. We use a single ref'd <svg> and look up children by
  // index; no document.getElementById, no per-frame allocation.
  const measureSvgRef = React.useRef(null);
  const [lengths, setLengths] = React.useState(() => Array(pathCount).fill(0));

  React.useLayoutEffect(() => {
    const svg = measureSvgRef.current;
    if (!svg) return;
    const els = svg.querySelectorAll("path");
    let next = Array.from(els, (el) => {
      try {
        return el.getTotalLength();
      } catch {
        return 0;
      }
    });
    if (next.length !== pathCount) return;
    // Only commit when every path actually has a non-zero length; re-renders
    // before SVG layout completes can yield 0, and committing those would
    // briefly make the draw-in animation run against 0.
    if (!next.every((n) => n > 0)) return;
    if (next.some((n, i) => n !== lengths[i])) {
      setLengths(next);
    }
    // lengths is intentionally excluded — we only want to measure when the
    // path set itself changes, not every time lengths updates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathCount, paths.join("|")]);

  // Per-frame point lookup against the same measuring nodes.
  const pointAt = (idx, progress) => {
    const svg = measureSvgRef.current;
    const len = lengths[idx];
    if (!svg || !len) return null;
    const el = svg.querySelectorAll("path")[idx];
    if (!el || !el.getPointAtLength) return null;
    try {
      return el.getPointAtLength(progress * len);
    } catch {
      return null;
    }
  };

  const width = resolvedStyle.width ?? 900;
  const height = resolvedStyle.height ?? 520;

  // --- particle scheduling -------------------------------------------------
  const perPath = Math.max(0, resolvedStyle.particleCount ?? 6);
  const lagFrames = Math.max(1, resolvedStyle.particleLagFrames ?? 6);
  const loop = resolvedStyle.loopParticles ?? true;
  const flowFrames = Math.max(1, activeFrames - drawFrames);
  // Travel time per particle, tied to active window so traversal always
  // finishes within the scene's budget when loopParticles is false.
  const baseTravel = Math.max(1, flowFrames * 0.6);

  const strokeColor = resolvedStyle.strokeColor ?? "#3D7BFD";
  const particleColor = resolvedStyle.particleColor ?? "#FFFFFF";
  const strokeWidth = resolvedStyle.strokeWidth ?? 4;
  const dashArray = resolvedStyle.dashArray ?? 14;
  const dashGap = resolvedStyle.dashGap ?? 10;
  const particleRadius = resolvedStyle.particleRadius ?? 7;

  return (
    <div
      style={{
        ...resolvedPosition,
        width,
        height,
        opacity: envelope,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {/* Measuring layer: keeps the authored pathData mounted so the live
          DOM nodes have real geometry to measure. Visually invisible. */}
      <svg
        ref={measureSvgRef}
        aria-hidden
        viewBox={`0 0 ${width} ${height}`}
        style={{ position: "absolute", width: 0, height: 0, overflow: "hidden" }}
      >
        {paths.map((d, i) => (
          <path key={i} d={d} fill="none" />
        ))}
      </svg>

      <svg viewBox={`0 0 ${width} ${height}`} width="100%" height="100%" style={{ overflow: "visible" }}>
        {/* The dashed subway lines. stroke-dashoffset draws each one in. */}
        {paths.map((d, i) => {
          const len = lengths[i] || 0;
          const p = interpolate(
            frame,
            [activeStart, activeStart + drawFrames],
            [0, 1],
            { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
          );
          const offset = len ? interpolate(p, [0, 1], [len, 0]) : 0;
          return (
            <path
              key={`line-${i}`}
              d={d}
              fill="none"
              stroke={strokeColor}
              strokeWidth={strokeWidth}
              strokeLinecap="round"
              strokeDasharray={`${dashArray} ${dashGap}`}
              strokeDashoffset={offset}
            />
          );
        })}

        {/* Optional per-path labels, rendered above each midpoint. */}
        {labels.map((label, i) => {
          const pt = lengths[i] ? pointAt(i, 0.5) : null;
          if (!pt) return null;
          return (
            <text
              key={`label-${i}`}
              x={pt.x}
              y={pt.y - 10}
              fill={strokeColor}
              fontFamily="Inter, sans-serif"
              fontSize={Math.max(11, strokeWidth * 2.4)}
              fontWeight={600}
              textAnchor="middle"
            >
              {label}
            </text>
          );
        })}

        {/* Particles flowing along each path. Will render nothing until
            lengths populate (first effect tick); after that positions are
            a pure function of (frame, length, lag, loop). */}
        {paths.map((_, i) =>
          Array.from({ length: perPath }).map((_, p) => {
            const depart = activeStart + drawFrames + p * lagFrames;
            if (frame < depart) return null;
            const elapsed = frame - depart;
            const progress = loop
              ? (elapsed % baseTravel) / baseTravel
              : Math.min(elapsed / baseTravel, 1);
            const pt = pointAt(i, progress);
            if (!pt) return null;
            return (
              <circle
                key={`p-${i}-${p}`}
                cx={pt.x}
                cy={pt.y}
                r={particleRadius}
                fill={particleColor}
                style={{ filter: "drop-shadow(0 0 6px rgba(255,230,0,0.45))" }}
              />
            );
          })
        )}
      </svg>
    </div>
  );
}
