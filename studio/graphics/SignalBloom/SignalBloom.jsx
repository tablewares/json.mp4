import React from "react";
import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";

const TAU = Math.PI * 2;

function mulberry32(seed) {
  let t = seed >>> 0;
  return () => {
    t += 0x6D2B79F5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function buildNodes(count, seed) {
  const rand = mulberry32(seed);
  return Array.from({ length: count }, (_, i) => {
    const radius = 0.14 + Math.pow(rand(), 0.72) * 0.43;
    const angle = rand() * TAU;
    return {
      id: i,
      radius,
      angle,
      phase: rand() * TAU,
      speed: 0.55 + rand() * 0.9,
      size: 0.55 + rand() * 1.15,
      opacity: 0.35 + rand() * 0.65,
    };
  });
}

export function SignalBloom({
  resolvedPosition,
  resolvedStyle,
  content = {},
  timing,
}) {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const {
    durationInFrames,
    enterAtFrame = 0,
    exitAtFrame = durationInFrames,
  } = timing;

  const width = resolvedStyle.width ?? 1200;
  const height = resolvedStyle.height ?? 720;
  const nodeCount = Math.max(8, Math.round(resolvedStyle.nodeCount ?? 42));
  const seed = Number.isFinite(content.seed) ? content.seed : 17;
  const nodes = buildNodes(nodeCount, seed);

  const enter = spring({
    frame: frame - enterAtFrame,
    fps,
    config: resolvedStyle.easing ?? { damping: 18, mass: 0.7, stiffness: 95 },
  });

  const exitOpacity = interpolate(
    frame,
    [Math.max(enterAtFrame, exitAtFrame - 12), exitAtFrame],
    [1, 0],
    { extrapolateLeft: "clamp", extrapolateRight: "clamp" },
  );

  const opacity = enter * exitOpacity;
  const cx = width / 2;
  const cy = height / 2;
  const field = Math.min(width, height);
  const orbit = Number(resolvedStyle.orbitAmount ?? 18);
  const nodeRadius = Number(resolvedStyle.nodeRadius ?? 5);
  const lineWidth = Number(resolvedStyle.lineWidth ?? 1);

  const points = nodes.map((node) => {
    const t = (frame - enterAtFrame) / fps;
    const theta = node.angle + t * 0.075 * node.speed;
    const wobble = Math.sin(t * node.speed + node.phase) * orbit;
    const r = node.radius * field + wobble;
    return {
      ...node,
      x: cx + Math.cos(theta) * r,
      y: cy + Math.sin(theta) * r * 0.72,
    };
  });

  const maxLinkDistance = field * 0.18;
  const links = [];
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) {
      const dx = points[i].x - points[j].x;
      const dy = points[i].y - points[j].y;
      const d = Math.hypot(dx, dy);
      if (d < maxLinkDistance) {
        links.push({ a: points[i], b: points[j], d });
      }
    }
  }

  const pulseCount = Math.max(1, Math.round(resolvedStyle.pulseCount ?? 4));
  const pulseSpeed = Number(resolvedStyle.pulseSpeed ?? 0.65);

  return (
    <div
      style={{
        ...resolvedPosition,
        width,
        height,
        position: "relative",
        overflow: "hidden",
        borderRadius: resolvedStyle.borderRadius ?? 32,
        border: `1px solid ${resolvedStyle.borderLine ?? "transparent"}`,
        background: resolvedStyle.canvasFill ?? "#070A12",
        opacity,
      }}
    >
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
        <defs>
          <radialGradient id="signal-core">
            <stop offset="0%" stopColor={resolvedStyle.coreFill ?? "#FFFFFF"} stopOpacity="0.95" />
            <stop offset="25%" stopColor={resolvedStyle.pulseFill ?? "#FF5CF4"} stopOpacity="0.42" />
            <stop offset="100%" stopColor={resolvedStyle.pulseFill ?? "#FF5CF4"} stopOpacity="0" />
          </radialGradient>
          <filter id="signal-glow">
            <feGaussianBlur stdDeviation="7" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        <rect width={width} height={height} fill={resolvedStyle.canvasFill ?? "#070A12"} />

        <circle
          cx={cx}
          cy={cy}
          r={field * 0.18 + Math.sin(frame / 17) * 5}
          fill="url(#signal-core)"
          opacity="0.9"
        />

        {links.map((link, i) => (
          <line
            key={`link-${i}`}
            x1={link.a.x}
            y1={link.a.y}
            x2={link.b.x}
            y2={link.b.y}
            stroke={resolvedStyle.lineFill ?? "#33415C"}
            strokeWidth={lineWidth}
            opacity={0.08 + (1 - link.d / maxLinkDistance) * 0.28}
          />
        ))}

        {Array.from({ length: pulseCount }, (_, i) => {
          const p = ((frame - enterAtFrame) * pulseSpeed / fps + i / pulseCount) % 1;
          const r = p * field * 0.48;
          return (
            <circle
              key={`pulse-${i}`}
              cx={cx}
              cy={cy}
              r={r}
              fill="none"
              stroke={resolvedStyle.pulseFill ?? "#FF5CF4"}
              strokeWidth={2}
              opacity={(1 - p) * 0.22}
            />
          );
        })}

        {points.map((point) => {
          const breathe = 1 + Math.sin(frame / 8 * point.speed + point.phase) * 0.22;
          return (
            <g key={`node-${point.id}`}>
              <circle
                cx={point.x}
                cy={point.y}
                r={nodeRadius * point.size * breathe * 2.5}
                fill={resolvedStyle.nodeFill ?? "#7DF9FF"}
                opacity={0.08}
                filter="url(#signal-glow)"
              />
              <circle
                cx={point.x}
                cy={point.y}
                r={nodeRadius * point.size * breathe}
                fill={resolvedStyle.nodeFill ?? "#7DF9FF"}
                opacity={point.opacity}
              />
            </g>
          );
        })}

        <circle
          cx={cx}
          cy={cy}
          r={4 + Math.sin(frame / 5) * 1.5}
          fill={resolvedStyle.coreFill ?? "#FFFFFF"}
          filter="url(#signal-glow)"
        />
      </svg>

      {resolvedStyle.showLabels !== false && (
        <>
          <div
            style={{
              position: "absolute",
              top: 28,
              left: 32,
              fontFamily: resolvedStyle.typography?.fontFamily,
              fontSize: Math.max(12, (resolvedStyle.typography?.fontSize ?? 36) * 0.38),
              letterSpacing: 3,
              textTransform: "uppercase",
              color: resolvedStyle.nodeFill ?? "#7DF9FF",
              opacity: 0.8,
            }}
          >
            {content.title ?? "SIGNAL / BLOOM"}
          </div>
          <div
            style={{
              position: "absolute",
              right: 32,
              bottom: 28,
              fontFamily: resolvedStyle.typography?.fontFamily,
              fontSize: Math.max(11, (resolvedStyle.typography?.fontSize ?? 36) * 0.3),
              color: resolvedStyle.typography?.color ?? "#8B93A7",
              letterSpacing: 1.2,
            }}
          >
            {content.caption ?? `FIELD ${String(seed).padStart(2, "0")} · LIVE`}
          </div>
        </>
      )}
    </div>
  );
}

export default SignalBloom;
