import React from "react";
import { useCurrentFrame, useVideoConfig, spring, interpolate } from "remotion";
import { buildWavyPathD } from "../../../src/templating/wavyPath.js";

/**
 * WavyLine — a self-drawing curved SVG path supporting point sequences.
 *
 * Style props:
 *  - curveAmount: {number} controls perpendicular bowing (default 0)
 *  - smoothCurve: {boolean} calculates smooth spline across 3+ points instead of piecewise (default false)
 */
export function WavyLine({ resolvedStyle, content, timing }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { durationInFrames, enterAtFrame = 0, exitAtFrame = durationInFrames } = timing;
  
  // ---- endpoints / point sequence ----------------------------------------
  const pts = Array.isArray(content?.points) ? content.points : [];
  if (pts.length < 2) {
    return null;
  }

  // ---- curved path calculation -------------------------------------------
  const curveAmount = resolvedStyle.curveAmount ?? 0;
  const smoothCurve = Boolean(resolvedStyle.smoothCurve);
  const pathD = React.useMemo(() => {
    if (content?._path?.d) return content._path.d;
    return buildWavyPathD(pts, curveAmount, smoothCurve);
  }, [content?._path?.d, pts, curveAmount, smoothCurve]);

  const resolvedLength = content?._path?.length ?? null;

  // ---- entrance / exit envelope ------------------------------------------
  const easingConfig = resolvedStyle.easing ?? { damping: 14, mass: 0.6, stiffness: 120 };
  const enterProgress = spring({ frame: frame - enterAtFrame, fps, config: easingConfig });
  const framesUntilExit = exitAtFrame - frame;
  const exitProgress = interpolate(
    framesUntilExit,
    [0, Math.min(15, Math.max(1, durationInFrames * 0.15))],
    [0, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );
  const envelope = Math.max(0, Math.min(enterProgress, exitProgress));

  // ---- draw-in via dashoffset --------------------------------------------
  const activeStart = enterAtFrame;
  const activeEnd = Math.max(exitAtFrame, enterAtFrame + 1);
  const activeFrames = activeEnd - activeStart;
  const drawFrac = Math.max(0, Math.min(1, resolvedStyle.drawDurationFraction ?? 0.5));
  const drawFrames = Math.max(1, Math.round(activeFrames * drawFrac));
  const framesSinceEnter = Math.max(0, frame - activeStart);
  const drawProgress = Math.min(1, framesSinceEnter / drawFrames);

  // ---- path length measurement -------------------------------------------
  const [measuredLen, setMeasuredLen] = React.useState(0);
  const measureRef = React.useRef(null);

  React.useLayoutEffect(() => {
    if (resolvedLength != null) return;
    const el = measureRef.current;
    if (!el) return;
    try {
      setMeasuredLen(el.getTotalLength());
    } catch {
      setMeasuredLen(0);
    }
  }, [pathD, resolvedLength]);

  const totalLen = resolvedLength ?? measuredLen;

  const dashOffset = interpolate(drawProgress, [0, 1], [totalLen, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const dashArray = totalLen > 0 ? totalLen : 1;

  // ---- color resolution --------------------------------------------------
  const stroke =
    resolvedStyle.strokeColorToken
      ? resolvedStyle.strokeColorToken
      : resolvedStyle.strokeColor ?? "#EA3943";

  return (
    <svg
      width="100%"
      height="100%"
      viewBox={`0 0 ${resolvedStyle.width} ${resolvedStyle.height}`}
      style={{ position: "absolute", left: 0, top: 0, pointerEvents: "none", opacity: envelope }}
    >
      <path ref={measureRef} d={pathD} fill="none" stroke="none" />
      <path
        d={pathD}
        fill="none"
        stroke={stroke}
        strokeWidth={resolvedStyle.strokeWidth ?? 6}
        strokeLinecap={resolvedStyle.strokeLinecap ?? "round"}
        strokeLinejoin={resolvedStyle.strokeLinejoin ?? "round"}
        strokeDasharray={dashArray}
        strokeDashoffset={dashOffset}
      />
    </svg>
  );
}

export default WavyLine;