import React from "react";
import { useCurrentFrame, useVideoConfig, spring, interpolate } from "remotion";

/**
 * WavyLine — a self-drawing curved SVG path (default a vivid red) between
 * two endpoints.
 *
 * Authored three ways, all funnelled through the SAME anchor templating
 * resolver (src/templating/anchor.js `resolveAnchorPoint`):
 *
 *  1. Connector: contentOverride.fromAssetId + toAssetId. Pass 2 books
 *     each endpoint as `{ followAssetId: <id> }` and resolves it via
 *     `resolveAnchorPoint` — the exact same vocabulary `cameraAnchor`
 *     uses in camera.schema.json — so the connector case shares one
 *     resolver with the templated-endpoint case instead of being a
 *     separate path that bakes raw pixel centers.
 *
 *  2. Standalone, templated: contentOverride.points authored in the
 *     anchor vocabulary. Each item is one of:
 *       - { position, offsetXPercent, offsetYPercent }   named corner + composition-space % nudge
 *       - { followAssetId, offsetXPercent, offsetYPercent } follow an asset's center + % nudge
 *     Pass 2 resolves each item to composition-space pixels via the
 *     shared resolver before the renderer mounts this component.
 *
 *  3. Standalone, legacy: contentOverride.points authored directly as
 *     `[{x,y},{x,y}]` raw composition-space pixels. Pass-through only —
 *     kept so older manifests render byte-identically. New authoring
 *     should use the templated shapes above.
 *
 * Either way the component turns the two resolved endpoints into a
 * cubic-bezier `d` string by offsetting the control points perpendicular
 * to the straight segment by `curveAmount * segmentLength`, so the line
 * bows rather than being a flat diagonal. A signed `curveAmount` flips
 * the bow direction.
 *
 * Draw-in: stroke-dashoffset animates from the path's total length -> 0
 * over `drawDurationFraction` of the active window, then holds. The
 * spring entrance + opacity envelope matches the other studio assets.
 *
 * Contract received: resolvedPosition, resolvedStyle, content, timing.
 * WavyLine ignores resolvedPosition/Size for its own painting — the SVG
 * sits at composition origin and the path coordinates are the
 * composition-space pixels pass 2 already wrote into content.points. The
 * resolved box is only used for the bounding rect of the SVG so it covers
 * the whole composition.
 */
export function WavyLine({ resolvedStyle, content, timing }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { durationInFrames, enterAtFrame = 0, exitAtFrame = durationInFrames } = timing;

  // ---- endpoints ---------------------------------------------------------
  const pts = Array.isArray(content?.points) ? content.points : [];
  const a = pts[0] ?? { x: 0, y: 0 };
  const b = pts[1] ?? { x: 0, y: 0 };
  if (pts.length < 2) {
    // Nothing to draw yet (e.g., authored with fromAssetId/toAssetId but
    // pass 2 hasn't run — shouldn't happen in a rendered scene graph, but
    // guard so a standalone author/preview doesn't crash).
    return null;
  }

  // ---- curved path between the two points --------------------------------
  // Perpendicular unit vector to the straight a->b segment, scaled by
  // curveAmount * segment length. Two control points offset along it from
  // the 1/3 and 2/3 marks of the segment produce a symmetric bow.
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const segLen = Math.hypot(dx, dy) || 1;
  const perpX = -dy / segLen;
  const perpY = dx / segLen;
  const curveAmount = resolvedStyle.curveAmount ?? 0;
  const offset = curveAmount * segLen;
  const c1x = a.x + dx / 3 + perpX * offset;
  const c1y = a.y + dy / 3 + perpY * offset;
  const c2x = a.x + (2 * dx) / 3 + perpX * offset;
  const c2y = a.y + (2 * dy) / 3 + perpY * offset;
  const pathD = `M ${a.x} ${a.y} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${b.x} ${b.y}`;

  //---- entrance / exit envelope (matches PathFlow/AssetBoilerplate) ------
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
  const drawProgress = Math.min(1, framesSinceEnter / drawFrames); // 0 -> 1 across draw window then clamps at 1

  // ---- path length measurement (one-time, layout effect) -----------------
  const measureRef = React.useRef(null);
  const [totalLen, setTotalLen] = React.useState(0);
  React.useLayoutEffect(() => {
    const el = measureRef.current;
    if (!el) return;
    try {
      setTotalLen(el.getTotalLength());
    } catch {
      setTotalLen(0);
    }
  }, [pathD]);

  // stroke-dashoffset = totalLen*(1 - drawProgress) so the visible portion
  // grows linearly from a -> b during the draw window.
  const dashOffset = interpolate(drawProgress, [0, 1], [totalLen, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const dashArray = totalLen > 0 ? totalLen : 1;

  // ---- color resolution --------------------------------------------------
  const stroke =
    resolvedStyle.strokeColorToken
      ? resolvedStyle.strokeColorToken // token already resolved to a hex by styleRegistry at pass 1
      : resolvedStyle.strokeColor ?? "#EA3943";

  return (
    <svg
      width="100%"
      height="100%"
      viewBox={`0 0 ${resolvedStyle.width} ${resolvedStyle.height}`}
      style={{ position: "absolute", left: 0, top: 0, pointerEvents: "none", opacity: envelope }}
    >
      {/* Hidden path used purely to measure getTotalLength. */}
      <path ref={measureRef} d={pathD} fill="none" stroke="none" />
      <path
        d={pathD}
        fill="none"
        stroke={stroke}
        strokeWidth={resolvedStyle.strokeWidth ?? 6}
        strokeLinecap={resolvedStyle.strokeLinecap ?? "round"}
        strokeDasharray={dashArray}
        strokeDashoffset={dashOffset}
      />
    </svg>
  );
}

export default WavyLine;
