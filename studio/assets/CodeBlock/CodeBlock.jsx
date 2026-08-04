import React from "react";
import { useCurrentFrame, useVideoConfig, spring, interpolate } from "remotion";

/**
 * CodeBlock — a monospace code panel that reveals content.code line by line,
 * like a terminal typing itself out. Optional mac-style window chrome
 * (traffic-light dots) and a language badge give it the "screen capture"
 * read that sells code as a finished artifact rather than a text dump.
 *
 * Animations:
 *   - per-line enter: spring-driven opacity + small translateY, staggered by
 *     index. Stagger auto-compresses (same auto-shrink pattern as
 *     KineticText/ListReveal) so a long file still fully reveals before the
 *     asset's exit.
 *   - exit: opacity fade near the window tail, applied to the whole panel.
 *
 * Color-field naming: backgroundFill/borderLine/textFill/lineNumberFill/
 * accentFill are raw hex literals (no "color" substring) so resolveAssetStyle
 * passes them through untouched instead of resolving them as style-registry
 * tokens — same convention as TickerTape/BarChartRace/SignalBloom.
 * monoFontFamily is a raw CSS font stack, not a typography token, since code
 * specifically needs a monospace face independent of the project's body font.
 */
const CHROME_DOTS = ["#FF5F57", "#FEBC2E", "#28C840"];

export function CodeBlock({ resolvedPosition, resolvedStyle, content, timing }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { durationInFrames, enterAtFrame = 0, exitAtFrame = durationInFrames } = timing;

  const lines = (content.code ?? "").split("\n");
  const highlightSet = new Set(Array.isArray(content.highlightLines) ? content.highlightLines : []);
  const requestedStagger = resolvedStyle.staggerFrames ?? 3;
  const easingConfig = resolvedStyle.easing ?? { damping: 18, mass: 0.6, stiffness: 140 };
  const fontSize = resolvedStyle.fontSizePx ?? 28;
  const lineHeight = resolvedStyle.lineHeightPx ?? 1.55;
  const showLineNumbers = resolvedStyle.showLineNumbers ?? true;
  const showChrome = resolvedStyle.showWindowChrome ?? true;
  const gutterWidth = String(lines.length).length * (fontSize * 0.62) + 24;

  const revealBudgetFrames = Math.max(1, (exitAtFrame - enterAtFrame) * 0.7);
  const effectiveStagger =
    lines.length > 1 ? Math.min(requestedStagger, revealBudgetFrames / (lines.length - 1)) : 0;

  const framesUntilExit = exitAtFrame - frame;
  const exitOpacity = interpolate(
    framesUntilExit,
    [0, Math.min(15, (exitAtFrame - enterAtFrame) * 0.15)],
    [0, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );
  const panelEnter = spring({
    frame: frame - enterAtFrame,
    fps,
    config: { damping: 20, mass: 0.6, stiffness: 100 },
  });
  const opacity = Math.min(panelEnter, exitOpacity);

  return (
    <div
      style={{
        ...resolvedPosition,
        width: resolvedStyle.width ?? 1100,
        height: resolvedStyle.height ?? 620,
        opacity,
        display: "flex",
        flexDirection: "column",
        background: resolvedStyle.backgroundFill ?? "#0D1117",
        border: resolvedStyle.borderLine && resolvedStyle.borderLine !== "transparent"
          ? `1px solid ${resolvedStyle.borderLine}`
          : "none",
        borderRadius: resolvedStyle.borderRadius ?? 20,
        overflow: "hidden",
        boxSizing: "border-box",
      }}
    >
      {showChrome && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "14px 20px",
            borderBottom: `1px solid ${resolvedStyle.borderLine ?? "#2A3142"}`,
            flexShrink: 0,
          }}
        >
          <div style={{ display: "flex", gap: 8 }}>
            {CHROME_DOTS.map((c) => (
              <span key={c} style={{ width: 12, height: 12, borderRadius: "50%", background: c }} />
            ))}
          </div>
          {content.language && (
            <span
              style={{
                fontFamily: resolvedStyle.badgeTypography?.fontFamily,
                fontSize: (resolvedStyle.badgeTypography?.fontSize ?? 28) * 0.75,
                fontWeight: resolvedStyle.badgeTypography?.fontWeight ?? 600,
                color: resolvedStyle.accentFill ?? "#3D7BFD",
                letterSpacing: "0.04em",
                textTransform: "uppercase",
              }}
            >
              {content.language}
            </span>
          )}
        </div>
      )}

      <div
        style={{
          flex: 1,
          padding: "24px 28px",
          overflow: "hidden",
          fontFamily: resolvedStyle.monoFontFamily ?? "'JetBrains Mono', monospace",
          fontSize,
          lineHeight,
        }}
      >
        {lines.map((line, i) => {
          const startFrame = enterAtFrame + i * effectiveStagger;
          const progress = spring({ frame: frame - startFrame, fps, config: easingConfig });
          const lineOpacity = interpolate(progress, [0, 1], [0, 1], { extrapolateLeft: "clamp" });
          const translateY = interpolate(progress, [0, 1], [10, 0]);
          const isHighlighted = highlightSet.has(i + 1);

          return (
            <div
              key={`ln-${i}`}
              style={{
                display: "flex",
                opacity: lineOpacity,
                transform: `translateY(${translateY}px)`,
                background: isHighlighted ? `${resolvedStyle.accentFill ?? "#3D7BFD"}22` : "transparent",
                borderLeft: isHighlighted ? `3px solid ${resolvedStyle.accentFill ?? "#3D7BFD"}` : "3px solid transparent",
              }}
            >
              {showLineNumbers && (
                <span
                  style={{
                    display: "inline-block",
                    width: gutterWidth,
                    flexShrink: 0,
                    textAlign: "right",
                    marginRight: 20,
                    color: resolvedStyle.lineNumberFill ?? "#4B5568",
                    userSelect: "none",
                  }}
                >
                  {i + 1}
                </span>
              )}
              <span
                style={{
                  color: resolvedStyle.textFill ?? "#E6EDF3",
                  whiteSpace: "pre",
                }}
              >
                {line.length ? line : "\u00A0"}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default CodeBlock;
