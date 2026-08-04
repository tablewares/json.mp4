import React from "react";
import { useCurrentFrame, useVideoConfig, spring, interpolate } from "remotion";

/**
 * ListReveal — a vertical list where each row pops in on its own staggered
 * spring, the list analogue of KineticText's per-word reveal. Rows slide in
 * from a short horizontal offset with a fade, so the list reads as being
 * "delivered" line by line rather than appearing as a static block.
 *
 * Animations:
 *   - per-row enter: spring-driven translateX + opacity, staggered by index.
 *     The stagger budget auto-compresses (same pattern as KineticText /
 *     BarChartRace) so item count * stagger never runs past the asset's
 *     exit — a 20-item list on a short timing window still fully resolves.
 *   - exit: opacity fade near the window tail, applied to the whole list.
 *
 * markerFill is a raw hex literal (no "color" substring) so resolveAssetStyle
 * passes it through untouched rather than treating it as a style-registry
 * token — same convention as TickerTape's upFill/downFill.
 */
function normalizeItems(items) {
  if (!Array.isArray(items)) return [];
  return items.map((it) => (typeof it === "string" ? it : it?.text ?? ""));
}

function Marker({ markerStyle, index, markerFill, fontSize }) {
  if (markerStyle === "none") return null;
  const label = markerStyle === "number" ? `${index + 1}.` : markerStyle === "check" ? "✓" : "•";
  return (
    <span
      style={{
        display: "inline-block",
        minWidth: markerStyle === "number" ? fontSize * 1.1 : fontSize * 0.7,
        color: markerFill,
        fontWeight: 700,
        flexShrink: 0,
      }}
    >
      {label}
    </span>
  );
}

export function ListReveal({ resolvedPosition, resolvedStyle, content, timing }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { durationInFrames, enterAtFrame = 0, exitAtFrame = durationInFrames } = timing;

  const items = normalizeItems(content.items);
  const requestedStagger = resolvedStyle.staggerFrames ?? 6;
  const easingConfig = resolvedStyle.easing ?? { damping: 12, mass: 0.4, stiffness: 180 };
  const markerStyle = resolvedStyle.markerStyle ?? "bullet";
  const markerFill = resolvedStyle.markerFill ?? "#3D7BFD";
  const itemGap = resolvedStyle.itemGap ?? 20;
  const align = resolvedStyle.align ?? "left";
  const fontSize = resolvedStyle.typography?.fontSize ?? 34;

  const revealBudgetFrames = Math.max(1, (exitAtFrame - enterAtFrame) * 0.65);
  const effectiveStagger =
    items.length > 1 ? Math.min(requestedStagger, revealBudgetFrames / (items.length - 1)) : 0;

  const framesUntilExit = exitAtFrame - frame;
  const exitOpacity = interpolate(
    framesUntilExit,
    [0, Math.min(15, (exitAtFrame - enterAtFrame) * 0.15)],
    [0, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );

  const justify = align === "center" ? "center" : align === "right" ? "flex-end" : "flex-start";

  return (
    <div
      style={{
        ...resolvedPosition,
        width: resolvedStyle.width ?? 800,
        display: "flex",
        flexDirection: "column",
        gap: `${itemGap}px`,
        opacity: exitOpacity,
      }}
    >
      {items.map((text, i) => {
        const startFrame = enterAtFrame + i * effectiveStagger;
        const progress = spring({ frame: frame - startFrame, fps, config: easingConfig });
        const opacity = interpolate(progress, [0, 1], [0, 1], { extrapolateLeft: "clamp" });
        const translateX = interpolate(progress, [0, 1], [align === "right" ? 28 : -28, 0]);

        return (
          <div
            key={`${text}-${i}`}
            style={{
              display: "flex",
              justifyContent: justify,
              opacity,
              transform: `translateX(${translateX}px)`,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "baseline",
                gap: "0.5em",
                fontFamily: resolvedStyle.typography?.fontFamily,
                fontSize,
                fontWeight: resolvedStyle.typography?.fontWeight,
                lineHeight: resolvedStyle.typography?.lineHeight,
                color: resolvedStyle.typography?.color,
                textAlign: align,
              }}
            >
              <Marker markerStyle={markerStyle} index={i} markerFill={markerFill} fontSize={fontSize} />
              <span>{text}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default ListReveal;
