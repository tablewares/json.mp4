import React from "react";
import { useCurrentFrame, useVideoConfig, spring, interpolate, Img, staticFile } from "remotion";

/**
 * Self-drawing route lines on an optional map background. One or more SVG
 * path strings animate themselves in via stroke-dashoffset: each route gets
 * a slice of `drawDurationFraction` of the active window, then a glow halo
 * blooms behind the drawn line for the remainder of the scene. Built for
 * the vox global-supply-chain scene.
 *
 * The base image (styleOverride.imageSrc or contentOverride.imageSrc) is
 * path-relative to public/, passed through Remotion's staticFile() so it's
 * bundled like any other asset.
 */
export function RouteDraw({ resolvedPosition, resolvedStyle, content, timing }) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const { durationInFrames, enterAtFrame = 0, exitAtFrame = durationInFrames } = timing;

  const routes = content.routes ?? [];
  const routeCount = Math.max(1, routes.length);

  // Entrance / exit envelope.
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

  // Active window. Each route draws over a sub-fraction of the draw window,
  // so all routes finish drawing before the asset's exit.
  const activeStart = enterAtFrame;
  const activeEnd = Math.max(exitAtFrame, enterAtFrame + 1);
  const activeFrames = activeEnd - activeStart;
  const drawFraction = resolvedStyle.drawDurationFraction ?? 0.55;
  const totalDrawFrames = Math.max(1, Math.round(activeFrames * drawFraction));
  const perRouteDraw = Math.max(1, Math.floor(totalDrawFrames / routeCount));

  const width = resolvedStyle.width ?? 1280;
  const height = resolvedStyle.height ?? 720;
  const strokeColor = resolvedStyle.strokeColor ?? "#16C784";
  const strokeWidth = resolvedStyle.strokeWidth ?? 6;
  const glowColor = resolvedStyle.glowColor ?? "#F5F7FA";
  const glowRadius = resolvedStyle.glowRadius ?? 8;
  const dashCap = resolvedStyle.dashCap ?? "round";
  const imageSrc = resolvedStyle.imageSrc ?? content.imageSrc ?? null;
  const texturePath = resolvedStyle.texturePath ?? null;

  // Path length measurement, same pattern as PathFlow: measure once on
  // mount, read the same nodes for stroke-dashoffset animation per frame.
  const measureSvgRef = React.useRef(null);
  const [lengths, setLengths] = React.useState(() => Array(routes.length).fill(0));

  React.useLayoutEffect(() => {
    const svg = measureSvgRef.current;
    if (!svg) return;
    const els = svg.querySelectorAll("path");
    const next = Array.from(els, (el) => {
      try {
        return el.getTotalLength();
      } catch {
        return 0;
      }
    });
    if (next.length !== routes.length || !next.every((n) => n > 0)) return;
    if (next.some((n, i) => n !== lengths[i])) {
      setLengths(next);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routes.length, (routes || []).join("|")]);

  // Per-route draw progress over [0,1].
  const routeDrawAt = (i) => {
    const start = activeStart + i * perRouteDraw;
    return interpolate(
      frame,
      [start, start + perRouteDraw],
      [0, 1],
      { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
    );
  };

  return (
    <div
      style={{
        ...resolvedPosition,
        width,
        height,
        opacity: envelope,
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* Optional base image (the map). */}
      {imageSrc ? (
        <Img
          src={staticFile(imageSrc)}
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }}
        />
      ) : null}

      {/* Optional texture overlay (e.g. paper grain) blended onto the base. */}
      {texturePath ? (
        <Img
          src={staticFile(texturePath)}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            mixBlendMode: "multiply",
            opacity: 0.5,
            pointerEvents: "none",
          }}
        />
      ) : null}

      {/* Measurement layer. */}
      <svg
        ref={measureSvgRef}
        aria-hidden
        viewBox={`0 0 ${width} ${height}`}
        style={{ position: "absolute", width: 0, height: 0, overflow: "hidden" }}
      >
        {routes.map((d, i) => (
          <path key={i} d={d} fill="none" />
        ))}
      </svg>

      <svg viewBox={`0 0 ${width} ${height}`} width="100%" height="100%" style={{ position: "absolute", inset: 0 }}>
        {routes.map((d, i) => {
          const len = lengths[i] || 0;
          const p = routeDrawAt(i);
          const offset = len ? interpolate(p, [0, 1], [len, 0]) : 0;
          const fullyDrawn = p >= 1;
          return (
            <g key={`route-${i}`}>
              {/* Glow halo behind the line; blooms in only after the line is done. */}
              {fullyDrawn && glowRadius > 0 ? (
                <path
                  d={d}
                  fill="none"
                  stroke={glowColor}
                  strokeWidth={strokeWidth * 1.6}
                  strokeLinecap={dashCap}
                  opacity={interpolate(
                    frame,
                    [activeStart + (i + 1) * perRouteDraw, activeStart + (i + 1) * perRouteDraw + 8],
                    [0, 0.55],
                    { extrapolateLeft: "clamp", extrapolateRight: "clamp" }
                  )}
                  style={{ filter: `blur(${glowRadius}px)` }}
                />
              ) : null}
              <path
                d={d}
                fill="none"
                stroke={strokeColor}
                strokeWidth={strokeWidth}
                strokeLinecap={dashCap}
                strokeDasharray={len || 1}
                strokeDashoffset={offset}
              />
            </g>
          );
        })}
      </svg>
    </div>
  );
}
