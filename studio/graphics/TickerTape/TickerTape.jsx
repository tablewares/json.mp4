import React from "react";
import { useCurrentFrame, useVideoConfig, spring, interpolate } from "remotion";

/**
 * TickerTape — a horizontally scrolling market ticker tape, the canonical
 * finance graphic. Renders content.tickers (each { symbol, price, change })
 * as one seamless marquee row that scrolls left for the asset's full timing
 * window. `change` (signed) colors each price green/red.
 *
 * Animations — all owned by the component and resolving within the timing
 * budget (framework rule: animations must resolve within the TTS window):
 *   - enter: a spring-driven left→right clip reveal, so the tape "unrolls"
 *     into place rather than just fading
 *   - idle: continuous leftward translate. The content is duplicated so the
 *     marquee loops seamlessly; speed = resolvedStyle.scrollPxPerSec, so it
 *     is fps-independent (px = (framesSinceEnter / fps) * scrollPxPerSec)
 *   - per-symbol pulse: each ticker with a non-zero change pops in ~6% on a
 *     short spring, staggered by index, then settles — a subtle "live data"
 *     beat
 *   - exit: opacity fade near the window tail
 *
 * Naming note for color fields: the framework's resolveAssetStyle treats any
 * key containing "color" as a color TOKEN and looks it up in the style
 * registry. The finance up/down/track/border colors are domain conventions,
 * not shared style-registry tokens, so the component keys them as raw hex
 * literals (`upFill`, `downFill`, `trackFill`, `borderLine`) to avoid spurious
 * token resolution. Scene authors set raw hexes too.
 */
const PULSE_STAGGER_FRAMES = 4;
const PULSE_STAGGER_CAP = 40;

export function TickerTape({ resolvedPosition, resolvedStyle, content, timing }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { durationInFrames, enterAtFrame = 0, exitAtFrame = durationInFrames } = timing;

  const tickers = Array.isArray(content.tickers) ? content.tickers : [];
  const trackHeight = resolvedStyle.trackHeight ?? 96;
  const glyphGap = resolvedStyle.glyphGap ?? 16;
  const symbolGap = resolvedStyle.symbolGap ?? 56;
  const scrollPxPerSec = resolvedStyle.scrollPxPerSec ?? 90;
  const showArrow = resolvedStyle.showChangeArrow ?? true;

  const enterProgress = spring({
    frame: frame - enterAtFrame,
    fps,
    config: resolvedStyle.easing ?? { damping: 16, mass: 0.7, stiffness: 110 },
  });
  const framesUntilExit = exitAtFrame - frame;
  const exitOpacity = interpolate(
    framesUntilExit,
    [0, Math.min(12, (exitAtFrame - enterAtFrame) * 0.15)],
    [0, 1],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );

  // Fade-in clip wipe: inset right→left; only runs over the enter spring.
  const revealPct = Math.min(1, enterProgress);
  const opacity = Math.min(enterProgress, exitOpacity);

  // Continuous scroll — fps-independent px offset.
  const scrollOffset = ((frame - enterAtFrame) / fps) * scrollPxPerSec;

  const renderRow = (startIndex) =>
    tickers.map((t, i) => {
      const sym = t.symbol ?? "???";
      const price = typeof t.price === "number" ? t.price.toFixed(2) : "0.00";
      const change = Number(t.change ?? 0);
      const up = change >= 0;
      const color = up ? resolvedStyle.upFill : resolvedStyle.downFill;
      const sign = up ? "▲" : "▼";
      const changeStr = `${up ? "+" : ""}${change.toFixed(2)}`;

      const popIndex = startIndex + i;
      const pulseProgress = spring({
        frame: frame - enterAtFrame - Math.min(PULSE_STAGGER_CAP, popIndex * PULSE_STAGGER_FRAMES),
        fps,
        config: { damping: 11, mass: 0.4, stiffness: 170 },
      });
      const pulseScale = interpolate(pulseProgress, [0, 0.55, 1], [0.82, 1.06, 1]);

      return (
        <span
          key={`${sym}-${popIndex}`}
          style={{
            display: "inline-flex",
            alignItems: "baseline",
            gap: `${glyphGap}px`,
            marginRight: `${symbolGap}px`,
            whiteSpace: "nowrap",
            transform: `scale(${pulseScale})`,
            transformOrigin: "left center",
          }}
        >
          <span
            style={{
              fontFamily: resolvedStyle.typography?.fontFamily,
              fontSize: resolvedStyle.typography?.fontSize,
              fontWeight: 800,
              color: resolvedStyle.typography?.color,
              letterSpacing: "0.02em",
            }}
          >
            {sym}
          </span>
          <span
            style={{
              fontFamily: resolvedStyle.typography?.fontFamily,
              fontSize: (resolvedStyle.typography?.fontSize ?? 36) * 0.92,
              fontWeight: 500,
              color,
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {price}
          </span>
          <span
            style={{
              fontFamily: resolvedStyle.typography?.fontFamily,
              fontSize: (resolvedStyle.typography?.fontSize ?? 36) * 0.78,
              fontWeight: 600,
              color,
              display: "inline-flex",
              alignItems: "center",
              gap: "0.18em",
            }}
          >
            {showArrow ? sign : ""}
            {changeStr}
          </span>
        </span>
      );
    });

  return (
    <div
      style={{
        ...resolvedPosition,
        width: resolvedStyle.width ?? 1600,
        height: trackHeight,
        overflow: "hidden",
        background: resolvedStyle.trackFill ?? "transparent",
        borderRadius: resolvedStyle.borderRadius ?? 16,
        border: resolvedStyle.borderLine ? `1px solid ${resolvedStyle.borderLine}` : "none",
        opacity,
        clipPath: `inset(0 ${(1 - revealPct) * 100}% 0 0)`,
        display: "flex",
        alignItems: "center",
      }}
    >
      <div
        style={{
          display: "inline-flex",
          alignItems: "center",
          paddingLeft: `${symbolGap}px`,
          whiteSpace: "nowrap",
          transform: `translateX(${-scrollOffset}px)`,
        }}
      >
        {/* Duplicate the row so the marquee loops seamlessly as the first
            copy scrolls off-screen. Two copies safely cover the timing
            window for any sane scrollPxPerSec. */}
        <span style={{ display: "inline-flex", paddingRight: `${symbolGap}px` }}>
          {renderRow(0)}
        </span>
        <span style={{ display: "inline-flex", paddingRight: `${symbolGap}px` }} aria-hidden>
          {renderRow(tickers.length)}
        </span>
      </div>
    </div>
  );
}

export default TickerTape;
