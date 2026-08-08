import React from "react";
import { useCurrentFrame, useVideoConfig, spring, interpolate } from "remotion";

/**
 * A neon marker stroke that sweeps across a text label, like a highlighter
 * dragged across the page. The label is rendered here (so the marker always
 * sits exactly above real glyphs), and a colored band — or, with
 * `styleOverride.underline`, a thin underline — animates horizontally across
 * it during the asset's active window.
 *
 * Pair this with a strictly-positioned TextBlock/KineticText on the SAME
 * anchor + offset: the marker lands over whatever's beneath. Anchored
 * exactly like AssetBoilerplate, so resolve.js's anchor math keeps both in
 * the same place.
 */
export function TextHighlight({ resolvedPosition, resolvedStyle, content, timing }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { durationInFrames, enterAtFrame = 0, exitAtFrame = durationInFrames } = timing;

  const text = content.text ?? "";

  // Entrance + exit envelope (matches AssetBoilerplate).
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

  // Sweep progress across [0,1] over the active window. Drawn after enter
  // so it always resolves before exit.
  const sweep = interpolate(
    frame,
    [enterAtFrame, exitAtFrame],
    [0, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
  );

  const width = resolvedStyle.width ?? 720;
  const height = resolvedStyle.height ?? 96;
  const markerColor = resolvedStyle.markerColor ?? "#FFE600";
  const markerHeight = resolvedStyle.markerHeight ?? 32;
  const markerOpacity = resolvedStyle.markerOpacity ?? 0.75;
  const markerBlur = resolvedStyle.markerBlur ?? 4;
  const underline = resolvedStyle.underline ?? false;
  const direction = resolvedStyle.direction ?? "right";
  const isVertical = direction === "top" || direction === "bottom";
  const reverse = direction === "left" || direction === "bottom";

  // Sweep geometry along the longer axis.
  const spanFull = isVertical ? height : width;
  const sweepLen = spanFull * sweep;

  // Position the label centered in the box.
  const fontSize = resolvedStyle.typography?.fontSize ?? 64;

  // Marker band geometry. Horizontal sweep ⇒ a vertical marker that grows
  // rightward; vertical sweep ⇒ horizontal marker that grows downward.
  const markerStyle = underline
    ? {
        // Thin underline at the text baseline.
        position: "absolute",
        left: reverse ? `${100 - sweep * 100}%` : 0,
        bottom: "10%",
        width: isVertical ? width : `${sweep * 100}%`,
        height: Math.max(3, resolvedStyle.barThickness ?? 4),
        background: markerColor,
        borderRadius: 2,
        opacity: envelope * (markerOpacity + 0.25),
      }
    : {
        position: "absolute",
        left: reverse ? `${100 - sweep * 100}%` : 0,
        top: "50%",
        transform: "translateY(-50%)",
        width: isVertical ? width : `${sweep * 100}%`,
        height: isVertical ? `${sweep * 100}%` : markerHeight,
        background: markerColor,
        opacity: envelope * markerOpacity,
        filter: markerBlur > 0 ? `blur(${markerBlur}px)` : undefined,
        mixBlendMode: "multiply",
        borderRadius: 2,
      };

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
        position: "relative",
      }}
    >
      <div
        style={{
          position: "relative",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          minWidth: "100%",
          minHeight: "100%",
        }}
      >
        {/* The text underneath: occupies the visual baseline of the box so the
            marker sweeps real glyphs, not white space. */}
        <span
          style={{
            position: "relative",
            zIndex: 2,
            fontFamily: resolvedStyle.typography?.fontFamily ?? "Inter, sans-serif",
            fontSize,
            fontWeight: resolvedStyle.typography?.fontWeight ?? 700,
            lineHeight: 1.1,
            color: resolvedStyle.typography?.color ?? "#0B0E14",
            textAlign: "center",
            whiteSpace: "nowrap",
          }}
        >
          {text}
        </span>
        {/* The marker band, sweeping over/under the text. mixBlendMode:
            multiply keeps the text legible through a colored highlight; for
            underline mode the band sits beneath the glyphs by index. */}
        <div style={{ ...markerStyle, zIndex: underline ? 0 : 1 }} />
      </div>
    </div>
  );
}
