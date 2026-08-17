import React from "react";
import { useCurrentFrame, useVideoConfig, spring, interpolate } from "remotion";
import { buildWavyPathD } from "../../../src/templating/wavyPath.js";
import { buildElbowPathD, directionAngle, oppositeDirection } from "./elbowPath.js";

/**
 * WavyLine — a self-drawing curved (or elbowed) SVG path supporting point
 * sequences, with optional arrowheads auto-oriented to the direction the
 * line is actually traveling at each end.
 *
 * Style props (existing):
 *  - curveAmount: {number} perpendicular bowing for the "wavy" variant (default 0)
 *  - smoothCurve: {boolean} smooth spline across 3+ points instead of piecewise (default false)
 *
 * Style props (new):
 *  - variant: "wavy" | "elbow" — "wavy" (default) is the existing bezier curve.
 *      "elbow" routes with straight, axis-aligned segments and 90-degree
 *      turns, stubbing straight out of each endpoint before turning.
 *  - arrowStart / arrowEnd: {boolean} draw an arrowhead at that end. Angle is
 *      derived automatically — tangent-sampled for "wavy", direction-derived
 *      for "elbow". No manual angle authoring needed.
 *  - arrowSize: {number} arrowhead length in px (default 14)
 *  - stubLength: {number} elbow-only — length of the straight run leaving each
 *      asset before the first turn (default 40)
 *  - cornerRadius: {number} elbow-only — fillets corners instead of hard turns (default 0)
 *  - routeStyle: "auto" | "horizontal-first" | "vertical-first" — elbow-only,
 *      forces which axis the stub direction is inferred on when fromDir/toDir
 *      aren't pre-resolved (default "auto")
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

  const variant = resolvedStyle.variant ?? "wavy";

  // ---- elbow routing (pure, static geometry from resolved pixel points) --
  const stubLength = resolvedStyle.stubLength ?? 40;
  const cornerRadius = resolvedStyle.cornerRadius ?? 0;
  const routeStyle = resolvedStyle.routeStyle ?? "auto";
  // Prefer a pre-resolved direction (e.g. once resolveRefs.js threads
  // fromEdge/toEdge through) over local inference from point position.
  const preResolvedFromDir = content?._path?.fromDir;
  const preResolvedToDir = content?._path?.toDir;

  const elbowResult = React.useMemo(() => {
    if (variant !== "elbow") return null;
    return buildElbowPathD(pts, {
      fromDir: preResolvedFromDir ?? "auto",
      toDir: preResolvedToDir ?? "auto",
      stubLength,
      cornerRadius,
      routeStyle,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [variant, pts, preResolvedFromDir, preResolvedToDir, stubLength, cornerRadius, routeStyle]);

  // ---- curved path calculation (wavy variant, unchanged) -----------------
  const curveAmount = resolvedStyle.curveAmount ?? 0;
  const smoothCurve = Boolean(resolvedStyle.smoothCurve);

  const pathD = React.useMemo(() => {
    if (content?._path?.d) return content._path.d;
    if (variant === "elbow") return elbowResult?.d ?? "";
    return buildWavyPathD(pts, curveAmount, smoothCurve);
  }, [content?._path?.d, variant, elbowResult, pts, curveAmount, smoothCurve]);

  const resolvedLength = content?._path?.length ?? null;

  // ---- entrance / exit envelope (unchanged) -------------------------------
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

  // ---- draw-in via dashoffset (unchanged) ---------------------------------
  const activeStart = enterAtFrame;
  const activeEnd = Math.max(exitAtFrame, enterAtFrame + 1);
  const activeFrames = activeEnd - activeStart;
  const drawFrac = Math.max(0, Math.min(1, resolvedStyle.drawDurationFraction ?? 0.5));
  const drawFrames = Math.max(1, Math.round(activeFrames * drawFrac));
  const framesSinceEnter = Math.max(0, frame - activeStart);
  const drawProgress = Math.min(1, framesSinceEnter / drawFrames);

  // ---- path length measurement (unchanged) --------------------------------
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

  // ---- arrowheads ----------------------------------------------------------
  const arrowStart = Boolean(resolvedStyle.arrowStart);
  const arrowEnd = Boolean(resolvedStyle.arrowEnd);
  const arrowSize = resolvedStyle.arrowSize ?? 14;

  // wavy: sample the tangent off the same hidden measurement <path> already
  // used for getTotalLength(), rather than adding new path-shape math to the
  // render component. This runs once whenever the path shape changes, same
  // cadence as the existing length-measurement effect — not per frame.
  const [wavyAngles, setWavyAngles] = React.useState({ start: 0, end: 0 });
  const wantsWavyAngles = variant === "wavy" && (arrowStart || arrowEnd);

  React.useLayoutEffect(() => {
    if (!wantsWavyAngles) return;
    const el = measureRef.current;
    if (!el) return;
    try {
      const len = resolvedLength ?? el.getTotalLength();
      if (!len) return;
      const eps = Math.max(0.5, Math.min(5, len * 0.02));
      const next = { start: 0, end: 0 };
      if (arrowStart) {
        const a = el.getPointAtLength(0);
        const b = el.getPointAtLength(Math.min(len, eps));
        // points backward, out of the source — opposite of initial travel
        next.start = (Math.atan2(a.y - b.y, a.x - b.x) * 180) / Math.PI;
      }
      if (arrowEnd) {
        const a = el.getPointAtLength(Math.max(0, len - eps));
        const b = el.getPointAtLength(len);
        // points forward, into the destination — direction of final travel
        next.end = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
      }
      setWavyAngles(next);
    } catch {
      // path not measurable yet; keep previous angles
    }
  }, [pathD, resolvedLength, wantsWavyAngles, arrowStart, arrowEnd]);

  const startAngleDeg =
    variant === "elbow" ? directionAngle(oppositeDirection(elbowResult?.fromDir ?? "right")) : wavyAngles.start;
  const endAngleDeg =
    variant === "elbow" ? directionAngle(oppositeDirection(elbowResult?.toDir ?? "left")) : wavyAngles.end;

  const startPoint = pts[0];
  const endPoint = pts[pts.length - 1];

  // arrive-arrow fades in over the last stretch of the draw-on so it lands
  // right as the stroke reaches the endpoint; the leave-arrow is present as
  // soon as the line is (it's already "reached" p0 at draw progress 0).
  const endArrowOpacity = interpolate(drawProgress, [0.85, 1], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  // ---- color resolution (unchanged) ---------------------------------------
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
      {arrowStart && startPoint && (
        <Arrowhead x={startPoint.x} y={startPoint.y} angleDeg={startAngleDeg} size={arrowSize} color={stroke} opacity={1} />
      )}
      {arrowEnd && endPoint && (
        <Arrowhead x={endPoint.x} y={endPoint.y} angleDeg={endAngleDeg} size={arrowSize} color={stroke} opacity={endArrowOpacity} />
      )}
    </svg>
  );
}

// Small triangle pointing along +x at angleDeg=0, rotated/translated onto
// its endpoint. Kept local since it's a few lines of pure render markup,
// not shared math — promote to its own module if a second asset needs it.
function Arrowhead({ x, y, angleDeg, size, color, opacity }) {
  const s = size;
  const points = `${s * 0.9},0 ${-s * 0.5},${s * 0.5} ${-s * 0.5},${-s * 0.5}`;
  return (
    <g transform={`translate(${x} ${y}) rotate(${angleDeg})`} opacity={opacity}>
      <polygon points={points} fill={color} />
    </g>
  );
}

export default WavyLine;
