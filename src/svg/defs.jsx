import React from "react";

/**
 * Defs — shared SVG <defs> registry (gradients, filters). Drop these as
 * children of <SvgStage> (sibling to the primitives that reference them by
 * id). Kept separate so an asset declares its defs once, then draws many.
 *
 * Convenience component: <LinearGradient id="g" from to angle stops.../>.
 * For anything bespoke, pass raw <defs> children directly.
 */

export function LinearGradient({
  id,
  from = "#3D7BFD",
  to = "#C04CFD",
  angle = 90,
  stops = [],
}) {
  const rad = (angle * Math.PI) / 180;
  const x2 = 0.5 + Math.cos(rad) / 2;
  const y2 = 0.5 + Math.sin(rad) / 2;
  const x1 = 0.5 - Math.cos(rad) / 2;
  const y1 = 0.5 - Math.sin(rad) / 2;
  const stopEls = stops.length
    ? stops.map((s, i) => <stop key={i} offset={s.offset} stopColor={s.color} stopOpacity={s.opacity ?? 1} />)
    : [
        <stop key="0" offset="0%" stopColor={from} />,
        <stop key="1" offset="100%" stopColor={to} />,
      ];
  return (
    <defs>
      <linearGradient id={id} x1={x1} y1={y1} x2={x2} y2={y2}>
        {stopEls}
      </linearGradient>
    </defs>
  );
}

/**
 * Glow — a reusable feGaussianBlur glow filter. `strength` is the stdDeviation
 * (px). Apply via style={{ filter: 'url(#<id>)' }} on any primitive.
 */
export function Glow({ id, strength = 6, color }) {
  return (
    <filter id={id} x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation={strength} result="blur" />
      {color ? <feFlood floodColor={color} result="flood" /> : null}
      {color ? (
        <feComposite in="flood" in2="blur" operator="in" result="colored" />
      ) : null}
      <feMerge>
        {color ? <feMergeNode in="colored" /> : <feMergeNode in="blur" />}
        <feMergeNode in="SourceGraphic" />
      </feMerge>
    </filter>
  );
}

export function Defs({ children }) {
  return <defs>{children}</defs>;
}

export default { LinearGradient, Glow, Defs };
