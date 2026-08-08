import React from "react";
import { SvgStage, Rect, LinearGradient, useRevealContext } from "../../../src/svg/index.jsx";

/**
 * SolidShape — migrated to the SVG substrate.
 *
 * Same manifest schema as before (shape / backgroundColorToken /
 * backgroundColor / borderRadius / revealMode / opacity / width / height),
 * so every existing scene that places a SolidShape renders unchanged in
 * structure — but now it's a real SVG <rect> with gradient + masked-wipe
 * support, not a flat CSS div. The wall the old version hit (no gradients,
 * no true mask reveals) is gone, and the spring/exit math moved into the
 * shared substrate (src/svg/useReveal.js) instead of living here.
 *
 * revealMode:
 *   "scale"  -> center-keyed scale-in (default; the old behavior)
 *   "fade"   -> opacity-only fade ((progress-gated), no movement
 *   "wipe"   -> masked left->right clip-path wipe reveal (the new move)
 *
 * Fill source, in priority order:
 *   1. resolvedStyle.backgroundColorToken resolved by resolve.js into
 *      resolvedStyle.backgroundColor  (a token like "accentGreen")
 *   2. resolvedStyle.gradient = { from, to, angle }  (raw hex literal)
 *   3. resolvedStyle.backgroundColor  (raw hex literal)
 *   4. currentColor fallback
 */
function ShapeBody({ shape, width, height, fill, fillKind, borderRadius, revealMode, opacity }) {
  // fillKind: "gradient" | "solid". For gradient we emit a <defs> and point the
  // rect's fill at it; for solid we use the hex directly.
  const gid = "ss-grad";
  let fillAttr = fill;
  let defs = null;
  if (fillKind === "gradient" && fill && typeof fill === "object") {
    defs = <LinearGradient id={gid} from={fill.from} to={fill.to} angle={fill.angle ?? 90} />;
    fillAttr = `url(#${gid})`;
  }

  // For circle/pill we collapse to a rect with a large rx (the SVG idiom).
  const rx =
    shape === "circle"
      ? Math.min(width, height) / 2
      : shape === "pill"
        ? Math.min(height / 2, width / 2)
        : borderRadius ?? 16;

  // Wipe reveal: clip via SVG clipPath inset reveal left->right.
  if (revealMode === "wipe") {
    return (
      <>
        {defs}
        <defs>
          <clipPath id="ss-wipe">
            <rect x={0} y={0} width={width} height={height} />
          </clipPath>
        </defs>
        <WipeRect width={width} height={height} rx={rx} fill={fillAttr} opacity={opacity} clipId="ss-wipe">
          {defs}
        </WipeRect>
      </>
    );
  }

  // scale / fade handled by <Rect> (center-keyed scale; opacity does the rest)
  return (
    <>
      {defs}
      <Rect x={0} y={0} width={width} height={height} rx={rx} fill={fillAttr} opacity={opacity} />
    </>
  );
}

function WipeRect({ width, height, rx, fill, opacity, clipId, children }) {
  const ctx = useRevealContext();
  const r = ctx.reveal;
  const revealedW = width * Math.max(0, Math.min(1, r));
  return (
    <>
      {children}
      <g clipPath={`url(#${clipId})`} opacity={opacity}>
        {/* the actual fill rect, masked by the wipe */}
        <rect x={0} y={0} width={revealedW} height={height} rx={rx} fill={fill} />
      </g>
    </>
  );
}

export function SolidShape({ resolvedPosition, resolvedStyle, content, timing }) {
  const width = Math.max(1, Number(resolvedStyle.width ?? 400));
  const height = Math.max(1, Number(resolvedStyle.height ?? 120));
  const shape = resolvedStyle.shape ?? "rect";
  const borderRadius = resolvedStyle.borderRadius ?? 16;
  const revealMode = resolvedStyle.revealMode ?? "scale";
  const opacity = resolvedStyle.opacity ?? 1;

  // Resolve fill. resolve.js puts the token-resolved color on
  // backgroundColor when backgroundColorToken was authored; a raw hex
  // backgroundColor also lands there. Gradient is a raw object bypass.
  const gradient = resolvedStyle.gradient;
  const baseColor = resolvedStyle.backgroundColor ?? "currentColor";
  const fillKind = gradient ? "gradient" : "solid";
  const fill = gradient ? gradient : baseColor;

  return (
    <SvgStage resolvedPosition={resolvedPosition} resolvedStyle={resolvedStyle} timing={timing} content={content}>
      <ShapeBody
        shape={shape}
        width={width}
        height={height}
        fill={fill}
        fillKind={fillKind}
        borderRadius={borderRadius}
        revealMode={revealMode}
        opacity={opacity}
      />
    </SvgStage>
  );
}

export default SolidShape;
