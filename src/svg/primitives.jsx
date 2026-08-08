import React from "react";
import { interpolate } from "remotion";
import { useRevealContext } from "./RevealContext.jsx";

/**
 * Bar / Rect primitive.
 *
 * Animates from a corner outward via `reveal`: the height (or width) is
 * interpolated from 0→fullHeight across reveal, and an opacity fade runs
 * in parallel — so a bar "draws up" rather than appearing. The grow axis is
 * `grow="up"` (default, grow toward y=0 from a baseline) or `"down"` /
 * `"right"` / `"left"`. Use <Bar> for chart bars; use <Rect> for filled
 * panels (no draw, a scale-in by default).
 *
 * Explicit `reveal` overrides context (for staggered bars). `reveal` stays
 * a plain 0..1 number — it's the contract value from useReveal.
 */
function growTransform(reveal, axis, x, y, w, h) {
  const t = Math.max(0, Math.min(1, reveal));
  if (axis === "up") {
    const hh = h * t;
    return { x, y: y + (h - hh), width: w, height: hh };
  }
  if (axis === "down") {
    return { x, y, width: w, height: h * t };
  }
  if (axis === "right") {
    return { x, y, width: w * t, height: h };
  }
  if (axis === "left") {
    const ww = w * t;
    return { x: x + (w - ww), y, width: ww, height: h };
  }
  return { x, y, width: w, height: h };
}

export function Bar({
  x = 0,
  y = 0,
  width,
  height,
  fill = "#3D7BFD",
  rx = 0,
  grow = "up",
  reveal,
  opacity = 1,
  ...rest
}) {
  const ctx = useRevealContext();
  const r = reveal ?? ctx.reveal;
  const box = growTransform(r, grow, x, y, width, height);
  const op = opacity * interpolate(r, [0, 0.15, 1], [0, 1, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return <rect x={box.x} y={box.y} width={box.width} height={box.height} rx={rx} fill={fill} opacity={op} {...rest} />;
}

/**
 * Rect — filled panel primitive. Scale-in from the center by default
 * (the classic "card land" move). Use <Bar> for directional draws.
 */
export function Rect({
  x = 0,
  y = 0,
  width,
  height,
  fill = "#161B26",
  stroke,
  strokeWidth = 0,
  rx = 0,
  reveal,
  opacity = 1,
  ...rest
}) {
  const ctx = useRevealContext();
  const r = reveal ?? ctx.reveal;
  // center-keyed scale
  const s = interpolate(r, [0, 1], [0.85, 1]);
  const cx = x + width / 2;
  const cy = y + height / 2;
  const op = opacity * interpolate(r, [0, 0.2, 1], [0, 1, 1]);
  return (
    <rect
      x={cx - (width * s) / 2}
      y={cy - (height * s) / 2}
      width={width * s}
      height={height * s}
      rx={rx}
      fill={fill}
      stroke={stroke}
      strokeWidth={strokeWidth}
      opacity={op}
      {...rest}
    />
  );
}

/**
 * Line — stroke with a draw-on reveal (stroke-dashoffset). A line that
 * traces itself is the single most "motion-graphics" move the old divs
 * literally could not do.
 */
export function Line({
  x1 = 0,
  y1 = 0,
  x2 = 0,
  y2 = 0,
  stroke = "#F5F7FA",
  strokeWidth = 2,
  strokeLinecap = "round",
  reveal,
  opacity = 1,
  ...rest
}) {
  const ctx = useRevealContext();
  const r = reveal ?? ctx.reveal;
  const length = Math.hypot(x2 - x1, y2 - y1) || 1;
  const offset = (1 - Math.min(1, r)) * length;
  return (
    <line
      x1={x1}
      y1={y1}
      x2={x2}
      y2={y2}
      stroke={stroke}
      strokeWidth={strokeWidth}
      strokeLinecap={strokeLinecap}
      strokeDasharray={length}
      strokeDashoffset={offset}
      opacity={opacity * Math.min(1, r * 2)}
      {...rest}
    />
  );
}

/**
 * Arc — a stroked arc sector that sweeps in (stroke-dashoffset from full → 0).
 * Used for donut/ring stat visuals. `startAngle`/`endAngle` in degrees, `sweep`
 * capped to reveal progress so the arc draws clockwise as reveal→1.
 */
export function Arc({
  cx,
  cy,
  r,
  startAngle = -90,
  endAngle = 270,
  stroke = "#3D7BFD",
  strokeWidth = 8,
  strokeLinecap = "round",
  reveal,
  opacity = 1,
  ...rest
}) {
  const ctx = useRevealContext();
  const rProg = reveal ?? ctx.reveal;
  const span = ((endAngle - startAngle + 360) % 360) || 360;
  const sweep = span * Math.max(0, Math.min(1, rProg));
  const end = startAngle + sweep;
  const rad = (d) => (d * Math.PI) / 180;
  const x1 = cx + r * Math.cos(rad(startAngle));
  const y1 = cy + r * Math.sin(rad(startAngle));
  const x2 = cx + r * Math.cos(rad(end));
  const y2 = cy + r * Math.sin(rad(end));
  const large = sweep > 180 ? 1 : 0;
  const d = `M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2}`;
  return <path d={d} fill="none" stroke={stroke} strokeWidth={strokeWidth} strokeLinecap={strokeLinecap} opacity={opacity * Math.min(1, rProg * 2)} {...rest} />;
}

/**
 * Dot — a filled circle that pops in with a slight overshoot (scale 0→1.1→1).
 * No draw axis; it's a marker/particle primitive. scale is center-keyed at (cx,cy).
 */
export function Dot({
  cx = 0,
  cy = 0,
  r = 4,
  fill = "#F5F7FA",
  reveal,
  opacity = 1,
  ...rest
}) {
  const ctx = useRevealContext();
  const rv = reveal ?? ctx.reveal;
  // tiny overshoot curve
  const s = interpolate(rv, [0, 0.7, 1], [0, 1.1, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return <circle cx={cx} cy={cy} r={Math.max(0, r * s)} fill={fill} opacity={opacity * Math.min(1, rv * 1.5)} {...rest} />;
}

/**
 * Text — SVG <text> with an optional staggering reveal. When stagger=true,
 * each word fades+rises with a per-word offset derived from ctx.frame via
 * staggerFrames; the stage-wide `reveal` gates the whole thing so the text
 * still leaves on exit.
 *
 * SVG <text> keeps word/letter choreography honest (each <tspan> is a real
 * positioned glyph), which the old div-based TextBlock/TextReveal couldn't
 * do without a pile of inline-block hacks.
 */
export function Text({
  x = 0,
  y = 0,
  text = "",
  fontFamily = "Inter, sans-serif",
  fontSize = 40,
  fontWeight = 600,
  fill = "#F5F7FA",
  anchor = "start",
  stagger = false,
  staggerFrames = 2,
  reveal,
  opacity = 1,
  ...rest
}) {
  const ctx = useRevealContext();
  const r = reveal ?? ctx.reveal;
  if (!stagger) {
    const op = opacity * interpolate(r, [0, 0.3, 1], [0, 1, 1]);
    const dy = interpolate(r, [0, 1], [12, 0]);
    return (
      <text
        x={x}
        y={y + dy}
        fontFamily={fontFamily}
        fontSize={fontSize}
        fontWeight={fontWeight}
        fill={fill}
        textAnchor={anchor}
        opacity={op}
        {...rest}
      >
        {text}
      </text>
    );
  }
  const words = String(text).split(" ");
  return (
    <text
      x={x}
      y={y}
      fontFamily={fontFamily}
      fontSize={fontSize}
      fontWeight={fontWeight}
      fill={fill}
      textAnchor={anchor}
      opacity={opacity * Math.min(1, r * 1.5)}
      {...rest}
    >
      {words.map((w, i) => {
        // per-word spring gated by stage frame, each offset by staggerFrames
        const localFrame = ctx.frame - (ctx.timing.enterAtFrame ?? 0) - i * staggerFrames;
        const wp = Math.max(0, Math.min(1, localFrame / 12)); // 12-frame rise
        return (
          <tspan key={i} opacity={wp} dy={i === 0 ? 0 : 0} dx={i === 0 ? 0 : fontSize * 0.28}>
            {w}
          </tspan>
        );
      })}
    </text>
  );
}

export default { Bar, Rect, Line, Arc, Dot, Text };
