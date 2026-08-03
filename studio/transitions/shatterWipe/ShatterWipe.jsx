import React from "react";
import { AbsoluteFill, interpolate, random } from "remotion";

/**
 * Cuts the scene into a cols x rows grid via clip-path, then translates +
 * rotates each tile outward from center on exit / inward on entry, with a
 * deterministic per-tile stagger and jitter (via Remotion's seeded `random`,
 * so it's identical every render). Distinct from `default` (whole-frame
 * fade) and `slideContinuity` (single carried asset) — this one treats the
 * entire scene as debris.
 */
function ShatterWipeComponent({ children, presentationProgress, presentationDirection, cols = 6, rows = 4, throwDistance = 220 }) {
  const isEntering = presentationDirection === "entering";

  // scatterAmount: 0 = assembled/visible, 1 = fully scattered/invisible
  const scatterAmount = isEntering
    ? interpolate(presentationProgress, [0, 1], [1, 0])
    : interpolate(presentationProgress, [0, 1], [0, 1]);

  const tiles = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) tiles.push({ row, col });
  }

  return (
    <AbsoluteFill>
      {tiles.map(({ row, col }) => {
        const cellW = 100 / cols;
        const cellH = 100 / rows;
        const left = col * cellW;
        const top = row * cellH;

        // -1..1 direction vector from the frame's center to this tile's center
        const dirX = (left + cellW / 2 - 50) / 50;
        const dirY = (top + cellH / 2 - 50) / 50;
        const distance = Math.sqrt(dirX * dirX + dirY * dirY); // 0 (center) .. ~1.4 (corner)

        const seed = random(`shatter-${row}-${col}`);
        // tiles further from center start scattering slightly later, so the
        // shatter reads as radiating outward rather than uniform
        const localScatter = interpolate(scatterAmount, [distance * 0.35, 1], [0, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        });

        const translateX = dirX * localScatter * throwDistance;
        const translateY = dirY * localScatter * throwDistance + (seed - 0.5) * localScatter * 40;
        const rotate = (seed - 0.5) * localScatter * 60;
        const opacity = interpolate(localScatter, [0, 0.8, 1], [1, 1, 0]);

        return (
          <div
            key={`${row}-${col}`}
            style={{
              position: "absolute",
              inset: 0,
              clipPath: `inset(${top}% ${100 - (left + cellW)}% ${100 - (top + cellH)}% ${left}%)`,
              transform: `translate(${translateX}px, ${translateY}px) rotate(${rotate}deg)`,
              opacity,
            }}
          >
            {children}
          </div>
        );
      })}
    </AbsoluteFill>
  );
}

/** Factory: `<TransitionSeries.Transition presentation={shatterWipe({cols, rows, throwDistance})} .../>` */
export function shatterWipe(props = {}) {
  return { component: ShatterWipeComponent, props };
}
